import type { WebuiStreamFrame } from "../server/port.js";

export interface WebuiStreamMessage {
  readonly id: string;
  readonly answer: string;
  readonly thinking: string;
}

export interface WebuiStreamState {
  readonly phase: "idle" | "streaming" | "done" | "refused" | "error";
  readonly messages: readonly WebuiStreamMessage[];
  readonly runtimeEvents: readonly Record<string, unknown>[];
  readonly actionDeltas: readonly Record<string, unknown>[];
  readonly status?: string;
  readonly refusal?: string;
}

export const initialWebuiStreamState: WebuiStreamState = {
  phase: "idle",
  messages: [],
  runtimeEvents: [],
  actionDeltas: [],
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
  if (frame.messageActionDeltas)
    return {
      ...state,
      actionDeltas: [...state.actionDeltas, ...frame.messageActionDeltas],
    };
  const payload = frame.dataJson?.trim();
  if (!payload) return state;
  if (payload === "[DONE]") return { ...state, phase: "done" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return state;
  }
  const event = record(parsed);
  if (!event) return state;
  const type = event.type;
  if (type === 10 || type === "heartbeat")
    return { ...state, phase: "streaming" };
  if (type === 2 || type === "agent_message") {
    const message = record(event.agent_message) ?? record(event.agentMessage);
    if (!message) return state;
    const messages = Array.isArray(message.messages)
      ? message.messages.reduce(
          (all, item) =>
            record(item) ? upsertMessage(all, record(item)!, false) : all,
          state.messages,
        )
      : upsertMessage(state.messages, message, false);
    return { ...state, phase: "streaming", messages };
  }
  if (type === 6 || type === "agent_message_chunk") {
    const message =
      record(event.agent_message_chunk) ?? record(event.agentMessageChunk);
    return message
      ? {
          ...state,
          phase: "streaming",
          messages: upsertMessage(state.messages, message, true),
        }
      : state;
  }
  if (type === "session_status" || type === 3 || type === 4) {
    const status = record(event.session_status);
    return {
      ...state,
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
      ...state,
      phase: "streaming",
      runtimeEvents: [...state.runtimeEvents, event],
    };
  return state;
}
