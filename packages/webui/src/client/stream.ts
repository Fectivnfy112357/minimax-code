import type { WebuiStreamFrame } from "../server/port.js";
import type { WebuiTerminalFrame } from "../server/port.js";
import {
  initialWebuiWorkspaceProgress,
  reduceWebuiWorkspaceProgressEvent,
  type WebuiWorkspaceProgressState,
} from "./workspace-progress.js";

export interface WebuiTerminalStreamState {
  readonly outputByTerminal: Readonly<Record<string, string>>;
  readonly exited: Readonly<Record<string, boolean>>;
}

export const initialWebuiTerminalStreamState: WebuiTerminalStreamState = { outputByTerminal: {}, exited: {} };

export function reduceWebuiTerminalFrame(state: WebuiTerminalStreamState, frame: WebuiTerminalFrame): WebuiTerminalStreamState {
  return {
    outputByTerminal: { ...state.outputByTerminal, [frame.terminalId]: `${state.outputByTerminal[frame.terminalId] ?? ""}${frame.data}` },
    exited: frame.exited ? { ...state.exited, [frame.terminalId]: true } : state.exited,
  };
}

export interface WebuiStreamMessage {
  readonly id: string;
  readonly answer: string;
  readonly thinking: string;
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly toolCalls?: readonly Record<string, unknown>[];
  /** The server replays the user's own line as a `msg-user-*` frame; it
   * renders as the right-aligned bubble instead of an assistant body. */
  readonly role?: "user";
}

export interface WebuiStreamState {
  /** Turn start for the live 已执行 N 秒 row and the thinking counter. */
  readonly processingStartedAtMs?: number;
  readonly phase:
    | "idle"
    | "streaming"
    | "waiting"
    | "done"
    | "refused"
    | "error"
    | "reconnecting";
  readonly messages: readonly WebuiStreamMessage[];
  readonly runtimeEvents: readonly Record<string, unknown>[];
  readonly actionDeltas: readonly Record<string, unknown>[];
  /** The session-scoped Todo/Subagent projection fed by Desktop-compatible events. */
  readonly workspaceProgress: WebuiWorkspaceProgressState;
  /** The server-owned projection snapshot carried by the current stream. */
  readonly projection?: unknown;
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
  /**
   * True when the loop ended in `refused` because a sink callback
   * failed after frames had already been accepted by the reducer.
   * The user-visible transcript may be incomplete — the frames the
   * shell rendered before the failure are authoritative, but later
   * frames from the same turn never reached the UI. The shell
   * renders a user-visible message alongside the refusal when this
   * flag is set. It is only set on the recoverable path (when the
   * raw refuse callback still works); the unrecoverable path (every
   * callback broken) is necessarily silent beyond `console.error`.
   */
  readonly transcriptIncomplete: boolean;
}

export const initialWebuiStreamState: WebuiStreamState = {
  phase: "idle",
  messages: [],
  runtimeEvents: [],
  actionDeltas: [],
  workspaceProgress: initialWebuiWorkspaceProgress,
  resumeRequired: false,
  transcriptIncomplete: false,
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

function toolCalls(value: Record<string, unknown>): readonly Record<string, unknown>[] | undefined {
  const raw = value.tool_calls ?? value.toolCalls;
  if (!Array.isArray(raw)) return undefined;
  const calls = raw.filter(record);
  return calls.length > 0 ? calls : undefined;
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
  const calls = toolCalls(value);
  const index = messages.findIndex((message) => message.id === id);
  if (index < 0)
    return [
      ...messages,
      {
        id,
        answer,
        thinking,
        ...(calls ? { toolCalls: calls } : {}),
        ...(id.startsWith("msg-user-") ? ({ role: "user" } as const) : {}),
      },
    ];
  if (
    !chunk &&
    !calls &&
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
    ...(calls || messages[index]!.toolCalls
      ? { toolCalls: calls ?? messages[index]!.toolCalls }
      : {}),
    ...(messages[index]!.role ? { role: messages[index]!.role } : {}),
    ...(messages[index]!.timestamp !== undefined
      ? { timestamp: messages[index]!.timestamp }
      : {}),
    ...(messages[index]!.isGoal ? { isGoal: true } : {}),
  };
  return next;
}

/**
 * Recognised wire-frame payload kinds. The two consumers — the reducer
 * (state machine) and the loop's `captureFrame` (failure-signal
 * detection) — used to parse the same payload twice. Centralising the
 * recognition here lets both sides agree on what a `{type:…}` body
 * means without parsing the JSON twice, and keeps future envelope
 * additions in one place.
 */
export type WebuiStreamPayloadKind =
  | "empty"
  | "done"
  | "resume_overflow"
  | "heartbeat"
  | "agent_message"
  | "agent_message_chunk"
  | "session_status"
  | "generic_event";

export interface WebuiStreamPayloadRecognised {
  readonly kind: WebuiStreamPayloadKind;
  readonly event?: Record<string, unknown>;
}

const NO_PAYLOAD: WebuiStreamPayloadRecognised = { kind: "empty" };

/**
 * Recognise a frame's `dataJson` body. Returns the empty-payload kind
 * for whitespace or missing bodies, the done kind for `[DONE]`, the
 * overflow kind for `{type:"resume_overflow"}`, and an event record
 * otherwise (the reducer already had exhaustive branches; this function
 * only surfaces what the reducer and the loop need to share — the
 * overflow kind is the only one the loop branches on, everything else
 * falls through to the reducer).
 */
export function recogniseWebuiStreamPayload(
  dataJson: string | undefined,
): WebuiStreamPayloadRecognised {
  const payload = dataJson?.trim();
  if (!payload) return NO_PAYLOAD;
  if (payload === "[DONE]") return { kind: "done" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { kind: "generic_event" };
  }
  const event = record(parsed);
  if (!event) return { kind: "generic_event" };
  if (event.type === "resume_overflow") return { kind: "resume_overflow" };
  return { kind: "generic_event", event };
}

/**
 * Apply every non-cursor effect from a single frame. The cursor rides on
 * the LAST mapped frame of a source-frame group, so this function must
 * run BEFORE any cursor application — see `applyFrameCursor` below and
 * the test in `webui-stream.test-instrumentation.test.ts` (test-only).
 */
export function applyFrameData(
  state: WebuiStreamState,
  frame: WebuiStreamFrame,
): WebuiStreamState {
  let next: WebuiStreamState = state;
  if (frame.messageActionDeltas)
    next = {
      ...next,
      actionDeltas: [...next.actionDeltas, ...frame.messageActionDeltas],
    };
  if (frame.projection !== undefined)
    next = { ...next, projection: frame.projection };
  const recognised = recogniseWebuiStreamPayload(frame.dataJson);
  if (recognised.kind === "empty") return next;
  if (recognised.kind === "done") return { ...next, phase: "done" };
  if (recognised.kind === "resume_overflow") {
    // The harness signals that this client has fallen too far behind
    // the server's authoritative history. The shell observes
    // `resumeRequired` and re-establishes a fresh subscription after
    // `getMessages`.
    return { ...next, phase: "reconnecting", resumeRequired: true };
  }
  // `generic_event` — same exhaustive dispatch the reducer had. The
  // reducer and the loop used to parse this payload twice; this is the
  // single parse site. If the payload did not parse (or did not parse
  // to an object) `recognised.event` is undefined and we leave the
  // state unchanged, mirroring the previous guard against bad bodies.
  const event = recognised.event;
  if (!event) return next;
  const workspaceProgress = reduceWebuiWorkspaceProgressEvent(
    next.workspaceProgress,
    event,
  );
  next = { ...next, workspaceProgress };
  const type = event.type;
  if (type === 10 || type === "heartbeat") {
    return { ...next, phase: "streaming" };
  }
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

/**
 * Record the cursor on a state snapshot. The reducer applies this LAST,
 * after `applyFrameData`, so the cursor only ever advances after the
 * frame's data change has been applied. The previous behaviour
 * committed the cursor at the top of the reducer and left a window
 * where the cursor advanced without its corresponding state change.
 */
export function applyFrameCursor(
  state: WebuiStreamState,
  frame: WebuiStreamFrame,
): WebuiStreamState {
  if (frame.cursor === undefined || frame.cursor === state.cursor) return state;
  return { ...state, cursor: frame.cursor };
}

/**
 * Pure reduction of the mixed session stream. Unknown or malformed
 * payloads are ignored safely.
 *
 * The third argument is typed against `ReduceOptions` from
 * `stream-instrumentation.ts`. Production callers MUST NOT supply it;
 * the type lives in a test-only module on purpose so that any caller
 * who wants to set a probe must reach into the test surface to do so.
 * The probe fires once after the data step and once after the cursor
 * step; the cursor-ordering test asserts that the post-data snapshot
 * has not yet advanced the cursor.
 */
export function reduceWebuiStreamFrame(
  state: WebuiStreamState,
  frame: WebuiStreamFrame,
  options?: import("./stream-instrumentation.js").ReduceOptions,
): WebuiStreamState {
  const next = applyFrameData(state, frame);
  options?.probe?.(next, "after-data");
  const withCursor = applyFrameCursor(next, frame);
  options?.probe?.(withCursor, "after-cursor");
  return withCursor;
}
