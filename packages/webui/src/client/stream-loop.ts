// The composer send/resume loop, extracted from the React component so a
// test can drive it through the WebSocket-drop and `resume_overflow` paths
// without standing up a DOM. Two failure signals share the same control
// flow — both ultimately mean "the current subscription is dead; start a
// new one" — and only the cursor used to resume (or the need to reload
// authoritative history) differs.
//
// `runWebuiStreamLoop` resolves once the user's turn has reached a final
// state (steady-state `[DONE]`, refusal, or a non-resumable failure). The
// returned promise never rejects: sink callback failures are contained
// by `safeSink` and reported through the sink's `refuse` callback (with a
// `console.error` fallback when every callback is broken). This matches
// the React shell's `try/finally` shape at `app.tsx`, which does not
// catch and would otherwise lose a sink-originated rejection.

import type {
  WebuiClientMessageLoader,
  WebuiClientMessageSender,
  WebuiClientSessionResumer,
} from "./app.js";
import { projectWebuiMessage } from "./app.js";
import {
  recogniseWebuiStreamPayload,
  reduceWebuiStreamFrame,
  type WebuiStreamMessage,
  type WebuiStreamState,
} from "./stream.js";
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
  /**
   * Record an unrecoverable failure with a user-visible reason. The
   * second argument is set when the reducer had already accepted at
   * least one frame before the failure, so the user-visible
   * transcript may be incomplete; the shell renders an additional
   * message in that case.
   */
  readonly refuse: (reason: string, options?: { transcriptIncomplete?: boolean }) => void;
}

/**
 * Snapshot of the first sink callback failure, kept so the loop can
 * commit a refusal (or the fallback diagnostic) and skip the normal
 * `done` commit. The label names the callback that failed; the error
 * is the throw value, normalised to an `Error`.
 */
interface SinkFailure {
  readonly label: "applyFrame" | "setPhase" | "setMessages" | "refuse";
  readonly error: Error;
}

function describeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Wrap a sink so a callback throwing never escapes the loop's promise
 * contract. The first failure is recorded and the wrapped callbacks
 * become no-ops afterwards, so a half-broken sink does not cascade
 * further exceptions and does not let the loop commit a normal `done`
 * state. `reportSinkFailure` lets the loop surface the failure once
 * after the loop body finishes — calling `sink.refuse` directly,
 * bypassing the disable guard, and falling back to `console.error`
 * when the raw refuse callback also throws.
 */
function safeSink(
  sink: WebuiStreamLoopSink,
  framesAcceptedBeforeFailureRef: { value: number },
): {
  readonly safe: WebuiStreamLoopSink;
  readonly firstFailure: () => SinkFailure | undefined;
  readonly reportSinkFailure: () => boolean;
} {
  let first: SinkFailure | undefined;
  const wrap =
    <Args extends unknown[]>(
      fn: (...args: Args) => void,
      label: SinkFailure["label"],
    ): ((...args: Args) => void) =>
    (...args) => {
      if (first !== undefined) return;
      try {
        fn(...args);
      } catch (error) {
        first = { label, error: describeError(error) };
      }
    };
  return {
    safe: {
      applyFrame: wrap(sink.applyFrame, "applyFrame"),
      setPhase: wrap(sink.setPhase, "setPhase"),
      setMessages: wrap(sink.setMessages, "setMessages"),
      refuse: wrap(sink.refuse, "refuse"),
    },
    firstFailure: () => first,
    reportSinkFailure: () => {
      // Direct, non-wrapped call to sink.refuse. If refuse itself was
      // the failing callback we expect this to throw; the caller
      // catches and falls back to console.error. The second argument
      // carries `transcriptIncomplete` when frames had been accepted
      // before the failure — the shell uses that flag to render a
      // user-visible "transcript may be incomplete" message alongside
      // the refusal.
      if (!first) return true;
      const reason = `Sink callback "${first.label}" failed: ${first.error.message}`;
      try {
        sink.refuse(reason, {
          transcriptIncomplete: framesAcceptedBeforeFailureRef.value > 0,
        });
        return true;
      } catch {
        try {
          // eslint-disable-next-line no-console
          console.error("[webui] sink refusal failed; diagnostic only:", reason, first.error);
        } catch {
          // Even console.error can throw in extreme environments. Give
          // up — the failure has been observed at least once at this
          // point.
        }
        return false;
      }
    },
  };
}

/**
 * Build the React-shell binding for `runWebuiStreamLoop`. The shell's
 * submit handler in `app.tsx` calls this once per submit and feeds the
 * resulting sink into the loop. Tests exercise this helper directly
 * with a recording state reducer — see
 * `webui-shell.test.ts > "binds the composer sink to the React state
 * reducer correctly"`. That test is the strongest evidence available
 * that a misrouted callback (for example, dropping `applyFrame` or
 * putting `refuse` into `setPhase`) would be caught by a failing
 * assertion: it walks each callback through a synthetic state and
 * asserts the resulting reducer transitions.
 */
export function buildWebuiStreamLoopSink(
  setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void,
): WebuiStreamLoopSink {
  return {
    applyFrame: (frame) =>
      setStream((current) => reduceWebuiStreamFrame(current, frame)),
    setPhase: (phase) => setStream((current) => ({ ...current, phase })),
    setMessages: (messages) =>
      setStream((current) => ({ ...current, messages })),
    refuse: (reason, options) =>
      setStream((current) => ({
        ...current,
        phase: "refused",
        refusal: reason,
        transcriptIncomplete: options?.transcriptIncomplete ?? false,
      })),
  };
}

/**
 * Drives the composer send/resume loop. The two retry cases are unified:
 * a socket drop sets `nextAction = "resume"` and the next iteration calls
 * `resumeSession({ id, afterCursor })`; a `resume_overflow` frame sets
 * `nextAction = "resync"` and the next iteration reloads history via
 * `getMessages` and starts a fresh subscription with no cursor. Either
 * case loops until `[DONE]` arrives without another failure signal.
 *
 * The returned promise resolves once the loop reaches a final state. It
 * never rejects — sink callback failures are contained by `safeSink`
 * above, and transport/load errors are caught and surfaced through
 * `sink.refuse`.
 */
export async function runWebuiStreamLoop(
  deps: WebuiStreamLoopDeps,
  args: WebuiStreamLoopArgs,
  sink: WebuiStreamLoopSink,
): Promise<void> {
  const { sendMessage, resumeSession, loadMessages } = deps;
  const { sessionId, message } = args;
  // Count frames the reducer accepted before any sink failure was
  // recorded. `transcriptIncomplete` is part of the R16 contract: when
  // a sink failure ends the turn, the visible transcript may be stale.
  // Frames accepted before the failure are the ones the user already
  // saw, so the flag is set only when the counter is non-zero. We
  // hold the count in a wrapper object so the closure captured by
  // `safeSink` can read the live value when the failure report runs.
  const framesAcceptedBeforeFailureRef = { value: 0 };
  const guarded = safeSink(sink, framesAcceptedBeforeFailureRef);
  const safe = guarded.safe;

  let cursor: string | undefined;
  let nextAction: "resume" | "resync" | undefined;
  let sent = false;

  const captureFrame = (frame: WebuiStreamFrame): void => {
    if (frame.cursor !== undefined) cursor = frame.cursor;
    // The reducer recognises `{type:"resume_overflow"}` and surfaces it
    // through the `reconnecting` phase + `resumeRequired` flag, but the
    // loop also needs to know *which* failure signal fired so it can
    // pick the right recovery path. The shared `recognise…` helper is
    // what the reducer and this loop both use to interpret the JSON
    // body, so a future envelope change touches one site.
    if (recogniseWebuiStreamPayload(frame.dataJson).kind === "resume_overflow") {
      nextAction = "resync";
    }
    // The wrapper catches any throw and records the first failure;
    // subsequent calls become no-ops. We only count a frame when the
    // wrapper was not already disabled at entry — that is the case
    // where the frame actually reached the reducer.
    const wasDisabled = guarded.firstFailure() !== undefined;
    safe.applyFrame(frame);
    if (!wasDisabled && guarded.firstFailure() === undefined) {
      framesAcceptedBeforeFailureRef.value += 1;
    }
  };

  /**
   * Finalization helper called on every early-return path. When the
   * loop is about to exit, this checks whether a sink callback has
   * failed and either surfaces the failure through
   * `guarded.reportSinkFailure()` (which bypasses the disabled
   * wrapper and falls back to `console.error`) or commits a normal
   * refusal with the given reason. The shared helper is non-
   * recursive: it does not call the wrapped sink directly, only the
   * raw sink via `guarded` or the `sink` parameter.
   */
  const finalizeOnExit = (reason: string): void => {
    if (guarded.firstFailure() !== undefined) {
      guarded.reportSinkFailure();
      return;
    }
    // No sink failure recorded yet; commit the normal refusal path.
    // The raw `sink.refuse` is used here on purpose — the loop is
    // about to return, so the wrapper's disable rule does not need to
    // guard against a cascade. If even this raw refuse throws, fall
    // back to `console.error` rather than letting the promise reject.
    try {
      sink.refuse(reason);
    } catch (rawRefuseError) {
      try {
        // eslint-disable-next-line no-console
        console.error("[webui] early-exit refusal failed:", reason, rawRefuseError);
      } catch {
        // Give up; console.error can throw in extreme environments.
      }
    }
  };

  try {
    safe.setPhase("streaming");
    while (true) {
      if (nextAction === "resync") {
        nextAction = undefined;
        if (!resumeSession) {
          finalizeOnExit("resumeSession transport is unavailable");
          return;
        }
        // The server told us our view has fallen too far behind. Reload
        // authoritative history through the existing `getMessages`
        // operation and then establish a fresh subscription with no
        // cursor so the server replays from the latest persisted point.
        safe.setPhase("reconnecting");
        if (loadMessages) {
          try {
            const page = await loadMessages({ id: sessionId });
            safe.setMessages(
              (page.messages ?? []).flatMap(projectWebuiMessage).map(
                (item): WebuiStreamMessage => ({
                  id: item.messageId,
                  answer: "text" in item ? item.text : "",
                  thinking: item.kind === "thinking" ? item.text : "",
                }),
              ),
            );
          } catch (error) {
            const reason =
              error instanceof Error ? error.message : String(error);
            finalizeOnExit(reason);
            return;
          }
        }
        cursor = undefined;
        await resumeSession({ id: sessionId }, captureFrame);
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
          finalizeOnExit(reason);
          return;
        }
        safe.setPhase("reconnecting");
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
          finalizeOnExit("sendMessage transport is unavailable");
          return;
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
            finalizeOnExit(reason);
            return;
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
    // The normal completion path commits `phase: "done"` only when no
    // sink callback has failed during the loop. If a failure was
    // recorded, the loop refuses the turn and surfaces the failure
    // through `guarded.reportSinkFailure`, which falls back to
    // `console.error` if every sink callback is broken. The never-
    // reject promise contract is preserved on every path.
    if (guarded.firstFailure() === undefined) {
      safe.setPhase("done");
    } else {
      guarded.reportSinkFailure();
    }
  } catch (error) {
    // Transport/load errors that escape the per-iteration try blocks
    // land here. The never-reject guarantee is honoured: the promise
    // resolves with `safe.refuse` called, not rejected. If a sink
    // callback already failed, prefer the recorded failure over the
    // transport error so we don't lose the diagnostic.
    if (guarded.firstFailure() === undefined) {
      const reason = error instanceof Error ? error.message : String(error);
      finalizeOnExit(reason);
    } else {
      guarded.reportSinkFailure();
    }
  }
}