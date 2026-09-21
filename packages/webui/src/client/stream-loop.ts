// The composer send/resume loop, extracted from the React component so a
// test can drive it through the WebSocket-drop and `resume_overflow` paths
// without standing up a DOM. Two failure signals share the same control
// flow — both ultimately mean "the current subscription is dead; start a
// new one" — and only the cursor used to resume (or the need to reload
// authoritative history) differs.
//
// `runWebuiStreamLoop` resolves once the user's turn has reached a final
// state (steady-state `[DONE]`, refusal, or a non-resumable failure). The
// returned promise never rejects; all failures surface through the sink's
// `refuse` callback.

import type {
  WebuiClientMessageLoader,
  WebuiClientMessageSender,
  WebuiClientSessionResumer,
} from "./app.js";
import { projectWebuiMessage } from "./app.js";
import type { WebuiStreamMessage, WebuiStreamState } from "./stream.js";
import type { WebuiStreamFrame } from "../server/port.js";

export interface WebuiStreamLoopDeps {
  readonly sendMessage?: WebuiClientMessageSender;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiClientMessageLoader;
}

export interface WebuiStreamLoopArgs {
  readonly sessionId: string;
  readonly message: string;
}

export interface WebuiStreamLoopSink {
  /** Push a single frame through the reducer; called for every frame. */
  readonly applyFrame: (frame: WebuiStreamFrame) => void;
  /** Replace the phase without touching the rest of the state. */
  readonly setPhase: (phase: WebuiStreamState["phase"]) => void;
  /** Replace the transcript without touching the rest of the state. */
  readonly setMessages: (messages: readonly WebuiStreamMessage[]) => void;
  /** Record an unrecoverable failure with a user-visible reason. */
  readonly refuse: (reason: string) => void;
}

/**
 * Result of a single `runWebuiStreamLoop` invocation. The sink-driven
 * assertions in the test suite observe the `phases` and `callLog` arrays
 * to confirm the loop picked the right path; the `cursorsSeen` list
 * captures every cursor-bearing frame so the resume path can be asserted
 * to use the most recent one.
 */
export interface WebuiStreamLoopOutcome {
  readonly phases: readonly WebuiStreamState["phase"][];
  readonly refusals: readonly string[];
  readonly cursorsSeen: readonly string[];
  readonly resumeCalls: readonly {
    readonly afterCursor?: string;
    readonly hadCursor: boolean;
  }[];
}

/**
 * Drives the composer send/resume loop. The two retry cases are unified:
 * a socket drop sets `nextAction = "resume"` and the next iteration calls
 * `resumeSession({ id, afterCursor })`; a `resume_overflow` frame sets
 * `nextAction = "resync"` and the next iteration reloads history via
 * `getMessages` and starts a fresh subscription with no cursor. Either
 * case loops until `[DONE]` arrives without another failure signal.
 */
export async function runWebuiStreamLoop(
  deps: WebuiStreamLoopDeps,
  args: WebuiStreamLoopArgs,
  sink: WebuiStreamLoopSink,
): Promise<WebuiStreamLoopOutcome> {
  const { sendMessage, resumeSession, loadMessages } = deps;
  const { sessionId, message } = args;

  const phases: WebuiStreamState["phase"][] = [];
  const refusals: string[] = [];
  const cursorsSeen: string[] = [];
  const resumeCalls: { afterCursor?: string; hadCursor: boolean }[] = [];

  let cursor: string | undefined;
  let nextAction: "resume" | "resync" | undefined;
  let sent = false;

  const captureFrame = (frame: WebuiStreamFrame): void => {
    if (frame.cursor !== undefined) {
      cursor = frame.cursor;
      cursorsSeen.push(frame.cursor);
    }
    // The reducer turns `{type:"resume_overflow"}` into a `reconnecting`
    // phase + `resumeRequired` flag, but the loop also needs to know
    // *which* failure signal fired so it can pick the right recovery
    // path. Read the JSON body here and translate.
    const dataJson = String(frame.dataJson ?? "");
    if (dataJson.length > 0) {
      try {
        const parsed = JSON.parse(dataJson) as { type?: unknown } | undefined;
        if (
          parsed &&
          typeof parsed === "object" &&
          parsed.type === "resume_overflow"
        ) {
          nextAction = "resync";
        }
      } catch {
        // Not JSON or empty; the reducer already ignores bad payloads.
      }
    }
    sink.applyFrame(frame);
  };

  sink.setPhase("streaming");
  phases.push("streaming");

  const setPhaseObserved = (phase: WebuiStreamState["phase"]): void => {
    sink.setPhase(phase);
    phases.push(phase);
  };

  try {
    while (true) {
      if (nextAction === "resync") {
        nextAction = undefined;
        if (!resumeSession) {
          const reason = "resumeSession transport is unavailable";
          setPhaseObserved("refused");
          sink.refuse(reason);
          refusals.push(reason);
          return { phases, refusals, cursorsSeen, resumeCalls };
        }
        // The server told us our view has fallen too far behind. Reload
        // authoritative history through the existing `getMessages`
        // operation and then establish a fresh subscription with no
        // cursor so the server replays from the latest persisted point.
        setPhaseObserved("reconnecting");
        if (loadMessages) {
          const page = await loadMessages({ id: sessionId });
          sink.setMessages(
            (page.messages ?? []).flatMap(projectWebuiMessage).map(
              (item): WebuiStreamMessage => ({
                id: item.messageId,
                answer: "text" in item ? item.text : "",
                thinking: item.kind === "thinking" ? item.text : "",
              }),
            ),
          );
        }
        cursor = undefined;
        resumeCalls.push({ hadCursor: false });
        await resumeSession({ id: sessionId }, captureFrame);
        // `resumeSession` resolves on `[DONE]`. If another overflow was
        // signalled mid-stream, the next iteration will reload again;
        // otherwise fall through and let the next loop iteration exit.
        if (!nextAction) break;
        continue;
      }
      if (nextAction === "resume") {
        nextAction = undefined;
        if (!cursor || !resumeSession) {
          const reason =
            !cursor && !resumeSession
              ? "Cannot resume: no cursor observed before the drop and resumeSession transport is unavailable"
              : !cursor
                ? "Cannot resume: no cursor observed before the drop"
                : "Cannot resume: resumeSession transport is unavailable";
          setPhaseObserved("refused");
          sink.refuse(reason);
          refusals.push(reason);
          return { phases, refusals, cursorsSeen, resumeCalls };
        }
        setPhaseObserved("reconnecting");
        resumeCalls.push({ afterCursor: cursor, hadCursor: true });
        await resumeSession(
          { id: sessionId, afterCursor: cursor },
          captureFrame,
        );
        if (!nextAction) break;
        continue;
      }
      if (!sent) {
        sent = true;
        if (!sendMessage) {
          const reason = "sendMessage transport is unavailable";
          setPhaseObserved("refused");
          sink.refuse(reason);
          refusals.push(reason);
          return { phases, refusals, cursorsSeen, resumeCalls };
        }
        try {
          await sendMessage(
            { id: sessionId, content: message },
            captureFrame,
          );
        } catch (error) {
          // Mid-stream socket drop. Schedule a resume and let the loop
          // decide on the next iteration whether the cursor we observed
          // is enough to carry on. A rejection without a cursor is not
          // recoverable — surface it as a refusal instead of looping
          // forever.
          const reason = error instanceof Error ? error.message : String(error);
          if (!cursor) {
            setPhaseObserved("refused");
            sink.refuse(reason);
            refusals.push(reason);
            return { phases, refusals, cursorsSeen, resumeCalls };
          }
          nextAction = "resume";
          continue;
        }
        // `sendMessage` resolves only on `[DONE]`. If the stream also
        // signalled `resume_overflow`, the next iteration will reload
        // via `loadMessages` and start a fresh subscription. A bare
        // `[DONE]` with no failure signal exits the loop normally.
        if (nextAction) continue;
        break;
      }
      break;
    }
    sink.setPhase("done");
    phases.push("done");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    setPhaseObserved("refused");
    sink.refuse(reason);
    refusals.push(reason);
  }
  return { phases, refusals, cursorsSeen, resumeCalls };
}