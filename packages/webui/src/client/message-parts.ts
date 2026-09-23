/**
 * Desktop-compatible message projection.
 *
 * The runtime sends message fields, not the Desktop renderer's `parts[]`
 * projection. Keep this module pure so history, live stream tests, and future
 * renderers all consume the same ordering and synthetic-message rules.
 */

export interface WebuiMessageForParts {
  readonly msgId: string;
  readonly turnId?: string;
  readonly queryKey?: string;
  readonly role?: string;
  readonly msgContent?: string;
  readonly thinkingContent?: string;
  readonly thinkingDurationMs?: number;
  readonly toolCalls?: readonly Record<string, unknown>[];
  readonly communicationInfosJson?: unknown;
}

export interface WebuiAgentJoinedPart {
  readonly agentName?: string;
  readonly sessionId?: string;
  readonly parentSessionId?: string;
  readonly title?: string;
}

export interface WebuiDelegationPart {
  readonly fromAgent?: string;
  readonly toAgent?: string;
  readonly content?: string;
  readonly [key: string]: unknown;
}

export type WebuiMessagePart =
  | {
      readonly id: string;
      readonly type: "thinking";
      readonly content: string;
      readonly durationMs?: number;
    }
  | { readonly id: string; readonly type: "text"; readonly content: string }
  | {
      readonly id: string;
      readonly type: "tool_call";
      readonly toolCall: Record<string, unknown>;
    }
  | {
      readonly id: string;
      readonly type: "agent_joined";
      readonly agent: WebuiAgentJoinedPart;
    }
  | {
      readonly id: string;
      readonly type: "delegation";
      readonly message: WebuiDelegationPart;
    };

export interface WebuiTurnMessageGroup {
  readonly key: string;
  readonly messages: readonly WebuiMessageForParts[];
  readonly parts: readonly WebuiMessagePart[];
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(
  value: Record<string, unknown> | undefined,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    if (typeof value?.[key] === "string" && value[key].trim())
      return value[key] as string;
  }
  return undefined;
}

function parseCommunicationInfos(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value === "string") {
    try {
      return parseCommunicationInfos(JSON.parse(value));
    } catch {
      return [];
    }
  }
  if (Array.isArray(value))
    return value.flatMap((item) => parseCommunicationInfos(item));
  const item = record(value);
  if (!item) return [];
  const nested = item.events ?? item.infos ?? item.communicationInfos;
  if (nested !== undefined) return parseCommunicationInfos(nested);
  return [item];
}

function eventType(info: Record<string, unknown>): string | undefined {
  const generic = record(info.generic);
  return stringValue(info, "eventType", "event_type", "type") ??
    stringValue(generic, "eventType", "event_type", "type");
}

function eventData(info: Record<string, unknown>): Record<string, unknown> | undefined {
  return record(info.data) ?? record(record(info.generic)?.data) ?? info;
}

function projectSyntheticParts(
  message: WebuiMessageForParts,
): WebuiMessagePart[] {
  const parts: WebuiMessagePart[] = [];
  for (const info of parseCommunicationInfos(message.communicationInfosJson)) {
    const type = eventType(info);
    const data = eventData(info);
    if (type === "session.spawned") {
      const agent: WebuiAgentJoinedPart = {
        ...(stringValue(data, "agentName", "agent_name")
          ? { agentName: stringValue(data, "agentName", "agent_name") }
          : {}),
        ...(stringValue(data, "sessionId", "session_id")
          ? { sessionId: stringValue(data, "sessionId", "session_id") }
          : {}),
        ...(stringValue(data, "parentSessionId", "parent_session_id")
          ? { parentSessionId: stringValue(data, "parentSessionId", "parent_session_id") }
          : {}),
        ...(stringValue(data, "title") ? { title: stringValue(data, "title") } : {}),
      };
      parts.push({
        id: `agent-joined-${message.msgId}`,
        type: "agent_joined",
        agent,
      });
    } else if (type === "communication.message" || type === "delegation.message") {
      parts.push({
        id: `delegation-${message.msgId}`,
        type: "delegation",
        message: data ?? {},
      });
    }
  }
  return parts;
}

/** Build parts in the exact Desktop order: thinking, text, then tool calls. */
export function projectMessageParts(
  message: WebuiMessageForParts,
): readonly WebuiMessagePart[] {
  const parts: WebuiMessagePart[] = [];
  if (message.thinkingContent?.trim()) {
    parts.push({
      id: "thinking",
      type: "thinking",
      content: message.thinkingContent,
      ...(typeof message.thinkingDurationMs === "number"
        ? { durationMs: message.thinkingDurationMs }
        : {}),
    });
  }
  if (message.msgContent?.trim()) {
    parts.push({
      id: "text",
      type: "text",
      content: message.msgContent,
    });
  }
  for (const [index, toolCall] of (message.toolCalls ?? []).entries()) {
    const toolId =
      typeof toolCall.id === "string" && toolCall.id.trim()
        ? toolCall.id
        : `tool-${index}`;
    parts.push({ id: toolId, type: "tool_call", toolCall });
  }
  return [...parts, ...projectSyntheticParts(message)];
}

function turnKey(message: WebuiMessageForParts): string {
  if (message.turnId) return `turn:${message.turnId}`;
  if (message.queryKey) return `query:${message.queryKey}`;
  return `message:${message.msgId}`;
}

function remapConflictingPartIds(
  parts: readonly WebuiMessagePart[],
  usedIds: Set<string>,
  messageId: string,
): WebuiMessagePart[] {
  return parts.map((part) => {
    if (!usedIds.has(part.id)) {
      usedIds.add(part.id);
      return part;
    }
    const id = `${messageId}::${part.id}`;
    usedIds.add(id);
    return { ...part, id };
  });
}

/**
 * Merge adjacent messages from one turn/query into one render unit.
 *
 * A repeated message id is legal when the runtime emits several parts for the
 * same logical message. Desktop makes those React keys unique by appending the
 * part id; this projection applies the same rule to the merged unit.
 */
export function groupTurnMessages(
  messages: readonly WebuiMessageForParts[],
): readonly WebuiTurnMessageGroup[] {
  const groups: WebuiTurnMessageGroup[] = [];
  for (const message of messages) {
    const key = turnKey(message);
    const current = groups.at(-1);
    if (!current || current.key !== key) {
      groups.push({
        key,
        messages: [message],
        parts: projectMessageParts(message),
      });
      continue;
    }
    const usedIds = new Set(current.parts.map((part) => part.id));
    const nextParts = remapConflictingPartIds(
      projectMessageParts(message),
      usedIds,
      message.msgId,
    );
    groups[groups.length - 1] = {
      ...current,
      messages: [...current.messages, message],
      parts: [...current.parts, ...nextParts],
    };
  }
  return groups;
}
