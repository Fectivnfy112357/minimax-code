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

/** Pure reduction of the mixed session stream. Unknown or malformed payloads are ignored safely. */
export function reduceWebuiStreamFrame(
  state: WebuiStreamState,
  frame: WebuiStreamFrame,
): WebuiStreamState {
  // Cursor discipline: the cursor rides only on the last mapped frame of a
  // source-frame group, so a cursor-bearing frame is the last frame of its
  // group. We only advance `state.cursor` when the frame itself carries one;
  // recording it per frame would land a resume mid-group, because the cursor
  // would advance before the rest of the group's frames were applied.
  let next: WebuiStreamState =
    frame.cursor !== undefined && frame.cursor !== state.cursor
      ? { ...state, cursor: frame.cursor }
      : state;
  if (frame.messageActionDeltas)
    next = {
      ...next,
      actionDeltas: [...next.actionDeltas, ...frame.messageActionDeltas],
    };
  const payload = frame.dataJson?.trim();
  if (!payload) return next;
  if (payload === "[DONE]") return { ...next, phase: "done" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return next;
  }
  const event = record(parsed);
  if (!event) return next;
  const type = event.type;
  if (type === "resume_overflow") {
    // The harness signals that this client has fallen too far behind the
    // server's authoritative history. The shell observes `resumeRequired`
    // and re-establishes a fresh subscription after `getMessages`.
    return { ...next, phase: "reconnecting", resumeRequired: true };
  }
  if (type === 10 || type === "heartbeat")
    return { ...next, phase: "streaming" };
  if (type === 2 || type === "agent_message") {
    const message = record(event.agent_message) ?? record(event.agentMessage);
    if (!message) return next;
    const messages = Array.isArray(message.messages)
      ? message.messages.reduce(
          (all, item) =>
            record(item) ? upsertMessage(all, record(item)!, false) : all,
          next.messages,
        )
      : upsertMessage(next.messages, message, false);
    return { ...next, phase: "streaming", messages };
  }
  if (type === 6 || type === "agent_message_chunk") {
    const message =
      record(event.agent_message_chunk) ?? record(event.agentMessageChunk);
    return message
      ? {
          ...next,
          phase: "streaming",
          messages: upsertMessage(next.messages, message, true),
        }
      : next;
  }
  if (type === "session_status" || type === 3 || type === 4) {
    const status = record(event.session_status);
    return {
      ...next,
      phase: "streaming",
      status: text(status ?? event, ["type", "status"]) || undefined,
    };
  }
  if (
    type === "runtime-event" ||
    type === "action-required" ||
    typeof type === "string"
  )
    return {
      ...next,
      phase: "streaming",
      runtimeEvents: [...next.runtimeEvents, event],
    };
  return next;
}
