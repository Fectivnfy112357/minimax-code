import type { WebuiStreamFrame } from "../server/port.js";

export interface WebuiStreamMessage {
  readonly id: string;
  readonly answer: string;
  readonly thinking: string;
}

export interface WebuiStreamState {
  readonly phase:
    | "idle"
    | "streaming"
    | "done"
    | "refused"
    | "error"
    | "reconnecting";
  readonly messages: readonly WebuiStreamMessage[];
  readonly runtimeEvents: readonly Record<string, unknown>[];
  readonly actionDeltas: readonly Record<string, unknown>[];
  readonly status?: string;
  readonly refusal?: string;
  /**
   * Stream cursor of the last fully-applied frame group. The cursor rides only
   * on the last mapped frame of each source-frame group, so it advances only
   * on cursor-bearing frames. Holding the cursor in the reducer means a
   * reconnect can resume from exactly where the rendered transcript left off
   * without ever landing mid-group.
   */
  readonly cursor?: string;
  /**
   * True when the server emitted `resume_overflow`: the client's view has
   * fallen too far behind and must reload authoritative history through
   * `getMessages` before establishing a new subscription.
   */
  readonly resumeRequired: boolean;
}

export const initialWebuiStreamState: WebuiStreamState = {
  phase: "idle",
  messages: [],
  runtimeEvents: [],
  actionDeltas: [],
  resumeRequired: false,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: Record<string, unknown>, keys: readonly string[]): string {
  for (const key of keys)
    if (typeof value[key] === "string") return value[key] as string;
  return "";
}

function messageId(value: Record<string, unknown>): string {
  return text(value, ["msg_id", "msgId", "id"]);
}

function upsertMessage(
  messages: readonly WebuiStreamMessage[],
  value: Record<string, unknown>,
  chunk: boolean,
): readonly WebuiStreamMessage[] {
  const id = messageId(value) || `anonymous-${messages.length}`;
  const answer = text(value, ["msg_content", "msgContent", "content"]);
  const thinking = text(value, [
    "thinking_content",
    "thinkingContent",
    "thinking",
  ]);
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0) return [...messages, { id, answer, thinking }];
  if (
    !chunk &&
    messages[index]!.answer === answer &&
    messages[index]!.thinking === thinking
  )
    return messages;
  const next = [...messages];
  next[index] = {
    id,
    answer: chunk
      ? messages[index]!.answer + answer
      : answer || messages[index]!.answer,
    thinking: chunk
      ? messages[index]!.thinking + thinking
      : thinking || messages[index]!.thinking,
  };
  return next;
}

/**
 * Snapshot of a state transition the reducer applies. `applyFrameData`
 * uses these as fence posts so a test can observe the cursor only ever
 * advancing after `data-applied`.
 */
export type ReduceCheckpoint =
  | "enter"
  | "after-action-deltas"
  | "after-data"
  | "after-cursor";

export interface ReduceOptions {
  /**
   * Optional probe that receives every committed snapshot at each
   * checkpoint. Production callers leave this unset (the reducer stays a
   * pure synchronous function); the cursor-ordering test opts in to
   * confirm the cursor advances only after the frame's data change has
   * landed. The probe is read-only — it must not mutate the snapshot.
   */
  readonly probe?: (snapshot: WebuiStreamState, checkpoint: ReduceCheckpoint) => void;
}

/** Pure reduction of the mixed session stream. Unknown or malformed payloads are ignored safely. */
export function reduceWebuiStreamFrame(
  state: WebuiStreamState,
  frame: WebuiStreamFrame,
  options?: ReduceOptions,
): WebuiStreamState {
  options?.probe?.(state, "enter");

  // Step 1 — apply every non-cursor effect from this frame. The cursor
  // rides on the LAST mapped frame of a source-frame group, so recording
  // it here would land a resume mid-group. We defer cursor application
  // until after the data change for the same frame is committed, so the
  // cursor only advances after the group's state change is fully
  // applied.
  let next: WebuiStreamState = state;
  if (frame.messageActionDeltas)
    next = {
      ...next,
      actionDeltas: [...next.actionDeltas, ...frame.messageActionDeltas],
    };
  options?.probe?.(next, "after-action-deltas");

  const payload = frame.dataJson?.trim();
  if (!payload) {
    options?.probe?.(next, "after-data");
  } else if (payload === "[DONE]") {
    next = { ...next, phase: "done" };
    options?.probe?.(next, "after-data");
  } else {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      options?.probe?.(next, "after-data");
      parsed = undefined;
    }
    const event = record(parsed);
    if (event) {
      const type = event.type;
      if (type === "resume_overflow") {
        // The harness signals that this client has fallen too far behind
        // the server's authoritative history. The shell observes
        // `resumeRequired` and re-establishes a fresh subscription after
        // `getMessages`.
        next = { ...next, phase: "reconnecting", resumeRequired: true };
      } else if (type === 10 || type === "heartbeat") {
        next = { ...next, phase: "streaming" };
      } else if (type === 2 || type === "agent_message") {
        const message =
          record(event.agent_message) ?? record(event.agentMessage);
        if (message) {
          const messages = Array.isArray(message.messages)
            ? message.messages.reduce(
                (all, item) =>
                  record(item)
                    ? upsertMessage(all, record(item)!, false)
                    : all,
                next.messages,
              )
            : upsertMessage(next.messages, message, false);
          next = { ...next, phase: "streaming", messages };
        }
      } else if (type === 6 || type === "agent_message_chunk") {
        const message =
          record(event.agent_message_chunk) ?? record(event.agentMessageChunk);
        if (message) {
          next = {
            ...next,
            phase: "streaming",
            messages: upsertMessage(next.messages, message, true),
          };
        }
      } else if (type === "session_status" || type === 3 || type === 4) {
        const status = record(event.session_status);
        next = {
          ...next,
          phase: "streaming",
          status: text(status ?? event, ["type", "status"]) || undefined,
        };
      } else if (
        type === "runtime-event" ||
        type === "action-required" ||
        typeof type === "string"
      ) {
        next = {
          ...next,
          phase: "streaming",
          runtimeEvents: [...next.runtimeEvents, event],
        };
      }
    }
    options?.probe?.(next, "after-data");
  }

  // Step 2 — record the cursor. It is applied LAST so the cursor only
  // ever advances after the frame's data change has been applied to
  // state. The previous behaviour recorded the cursor at the top of the
  // function, which meant a per-frame snapshot could observe the cursor
  // advancing before the rest of the group's state was applied — a
  // final-state assertion would still pass, but a frame-by-frame
  // observation would catch the bug.
  if (frame.cursor !== undefined && frame.cursor !== next.cursor) {
    next = { ...next, cursor: frame.cursor };
  }
  options?.probe?.(next, "after-cursor");
  return next;
}
