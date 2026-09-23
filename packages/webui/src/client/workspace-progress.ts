import type { WebuiClientMessage } from "./app.js";

export type WebuiWorkspaceTodoStatus =
  | "pending"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface WebuiWorkspaceTodo {
  readonly content: string;
  readonly status: WebuiWorkspaceTodoStatus;
  readonly priority?: "high" | "medium" | "low";
}

export type WebuiWorkspaceSubagentStatus =
  | "running"
  | "completed"
  | "error";

export interface WebuiWorkspaceSubagent {
  readonly sessionId: string;
  readonly agentName: string;
  readonly title?: string;
  readonly status: WebuiWorkspaceSubagentStatus;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly parentSessionId?: string;
}

export interface WebuiWorkspaceProgressState {
  readonly todos: readonly WebuiWorkspaceTodo[];
  readonly subagents: readonly WebuiWorkspaceSubagent[];
  readonly hasTodoSnapshot: boolean;
  readonly hasSubagentSnapshot: boolean;
}

export const initialWebuiWorkspaceProgress: WebuiWorkspaceProgressState = {
  todos: [],
  subagents: [],
  hasTodoSnapshot: false,
  hasSubagentSnapshot: false,
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return undefined;
}

function numberValue(
  value: Record<string, unknown> | undefined,
  keys: readonly string[],
): number | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "number" && Number.isFinite(candidate))
      return candidate;
  }
  return undefined;
}

function normalizeTodos(value: unknown): WebuiWorkspaceTodo[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((candidate) => {
    const todo = record(candidate);
    const content = stringValue(todo, ["content"]);
    const status = todo?.status;
    if (
      !content ||
      (status !== "pending" &&
        status !== "in_progress" &&
        status !== "completed" &&
        status !== "cancelled")
    )
      return [];
    const priority = todo?.priority;
    return [
      {
        content,
        status,
        ...(priority === "high" || priority === "medium" || priority === "low"
          ? { priority }
          : {}),
      },
    ];
  });
}

export function webuiWorkspaceSubagentStatus(
  value: unknown,
): WebuiWorkspaceSubagentStatus {
  const objectValue = record(value);
  if (objectValue) {
    return webuiWorkspaceSubagentStatus(
      objectValue.statusType ?? objectValue.status ?? objectValue.type,
    );
  }
  if (value === 1 || value === "running" || value === "started")
    return "running";
  if (
    value === 2 ||
    value === 3 ||
    value === "error" ||
    value === "failed" ||
    value === "aborted" ||
    value === "cancelled"
  )
    return "error";
  return "completed";
}

function eventStatus(value: Record<string, unknown>): WebuiWorkspaceSubagentStatus {
  return webuiWorkspaceSubagentStatus(
    value.status ?? value.statusType ?? record(value.session_status)?.status,
  );
}

function upsertSubagent(
  subagents: readonly WebuiWorkspaceSubagent[],
  next: WebuiWorkspaceSubagent,
): readonly WebuiWorkspaceSubagent[] {
  const index = subagents.findIndex(
    (subagent) => subagent.sessionId === next.sessionId,
  );
  if (index < 0) return [...subagents, next];
  const updated = [...subagents];
  updated[index] = { ...updated[index], ...next };
  return updated;
}

function eventType(value: Record<string, unknown>): string | undefined {
  const generic = record(value.generic);
  return stringValue(generic, ["eventType", "event_type"])
    ?? stringValue(value, ["eventType", "event_type", "type"]);
}

function eventData(value: Record<string, unknown>): Record<string, unknown> {
  const generic = record(value.generic);
  return record(generic?.data) ?? record(value.data) ?? value;
}

function subagentFromEvent(
  value: Record<string, unknown>,
  fallbackParentSessionId?: string,
): WebuiWorkspaceSubagent | undefined {
  const data = eventData(value);
  const sessionId = stringValue(data, [
    "sessionId",
    "session_id",
    "childSessionId",
    "child_session_id",
  ]);
  const agentName = stringValue(data, [
    "agentName",
    "agent_name",
    "childAgentName",
    "child_agent_name",
  ]);
  if (!sessionId || !agentName) return undefined;
  const parentSessionId = stringValue(data, [
    "parentSessionId",
    "parent_session_id",
  ]) ?? fallbackParentSessionId;
  const status = eventStatus(data);
  return {
    sessionId,
    agentName,
    ...(stringValue(data, ["title"]) ? { title: stringValue(data, ["title"]) } : {}),
    status,
    ...(numberValue(data, ["createdAt", "created_at", "joinedAt", "joined_at"]) !== undefined
      ? { createdAt: numberValue(data, ["createdAt", "created_at", "joinedAt", "joined_at"]) }
      : {}),
    ...(numberValue(data, ["updatedAt", "updated_at"]) !== undefined
      ? { updatedAt: numberValue(data, ["updatedAt", "updated_at"]) }
      : {}),
    ...(parentSessionId ? { parentSessionId } : {}),
  };
}

/**
 * Reduce one raw Desktop-compatible event into WebUI's session-scoped
 * projection. The input is deliberately structural because stream frames
 * contain both protocol-shaped and legacy event-shaped payloads.
 */
export function reduceWebuiWorkspaceProgressEvent(
  state: WebuiWorkspaceProgressState,
  value: Record<string, unknown>,
  sessionId?: string,
): WebuiWorkspaceProgressState {
  const type = eventType(value);
  if (type === "todo_updated") {
    const todos = normalizeTodos(value.todos ?? eventData(value).todos);
    return todos ? { ...state, todos, hasTodoSnapshot: true } : state;
  }
  if (type === "session.spawned") {
    const subagent = subagentFromEvent(value, sessionId);
    return subagent
      ? {
          ...state,
          subagents: upsertSubagent(state.subagents, subagent),
          hasSubagentSnapshot: true,
        }
      : state;
  }
  if (
    type === "session.status_updated" ||
    type === "session.finish" ||
    type === "session.error" ||
    type === "session.abort" ||
    type === "session.aborted"
  ) {
    const data = eventData(value);
    const childSessionId = stringValue(data, ["sessionId", "session_id"]);
    if (!childSessionId) return state;
    const existing = state.subagents.find(
      (subagent) => subagent.sessionId === childSessionId,
    );
    if (!existing) return state;
    return {
        ...state,
        subagents: upsertSubagent(state.subagents, {
        ...existing,
        status:
          type === "session.finish"
            ? "completed"
            : type === "session.error" || type === "session.abort" || type === "session.aborted"
              ? "error"
              : eventStatus(data),
        }),
        hasSubagentSnapshot: true,
      };
  }
  if (type === "session_status" || type === "session.status") {
    const data = eventData(value);
    const childSessionId = stringValue(data, ["sessionId", "session_id"]);
    const existing = childSessionId
      ? state.subagents.find((subagent) => subagent.sessionId === childSessionId)
      : undefined;
    return existing
      ? {
          ...state,
          subagents: upsertSubagent(state.subagents, {
            ...existing,
            status: eventStatus(data),
          }),
          hasSubagentSnapshot: true,
        }
      : state;
  }
  return state;
}

function parseHistoryEvent(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  try {
    return record(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function historyEvents(message: WebuiClientMessage): Record<string, unknown>[] {
  const result: Record<string, unknown>[] = [];
  for (const candidate of [
    message.msgContent,
    (message as unknown as Record<string, unknown>).msg_content,
    (message as unknown as Record<string, unknown>).content,
  ]) {
    const parsed = parseHistoryEvent(candidate);
    if (parsed && eventType(parsed)) result.push(parsed);
  }
  return result;
}

/** Rebuild the last known Desktop-compatible state when opening a session. */
export function projectWebuiWorkspaceHistory(
  messages: readonly WebuiClientMessage[],
  sessionId?: string,
): WebuiWorkspaceProgressState {
  let state = initialWebuiWorkspaceProgress;
  for (const message of messages) {
    for (const call of message.toolCalls ?? []) {
      const name = String(call.name ?? call.toolName ?? "").toLowerCase();
      if (name !== "todowrite" && name !== "todo_write") continue;
      const input = record(call.input ?? call.arguments);
      const todos = normalizeTodos(input?.todos);
      if (todos) state = { ...state, todos, hasTodoSnapshot: true };
    }
    for (const event of historyEvents(message))
      state = reduceWebuiWorkspaceProgressEvent(state, event, sessionId);
  }
  return state;
}
