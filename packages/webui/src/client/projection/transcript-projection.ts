// Transcript projection — group transcript items into the render blocks, plus
// the small event-payload parsers the effect protocol needs.
//
// `groupWebuiTranscriptItems` is the renderer-facing helper: the components
// iterate the resulting groups (one per user bubble, one per assistant
// turn). `eventSessionId` / `pendingPermissionFromEvent` /
// `questionnaireFromEvent` / `replacePermission` are the runtime-event side
// of the same module — the effect reducer (see
// `projection/effect-reducer.ts`) consumes their outputs to drive its
// commands.

import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
  WebuiRuntimeEvent,
} from "../../server/port.js";
import type {
  WebuiTranscriptItem,
  WebuiTranscriptActivityPart,
  WebuiTranscriptProcessSegment,
  WebuiClientMessage,
  WebuiQueryCollapseView,
} from "../contracts.js";
import { readUsageNumber } from "./message-projection.js";

/** A render block: one user bubble, or one assistant turn. The transcript
 * renderer iterates these groups; per-block fields tell it how long the turn
 *  took and how many output tokens it used. */
export interface WebuiTranscriptGroup {
  readonly messageId: string;
  readonly turnId?: string;
  readonly items: WebuiTranscriptItem[];
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  readonly forceExpanded?: boolean;
  /** Wall-clock turn duration derived from message timestamps: the oldest
   *  `user` timestamp in the same turn (across group boundaries) to the
   *  newest `assistant` timestamp. */
  readonly wallClockDurationMs?: number;
}

export interface WebuiMessageQueryDuration {
  readonly queryKey: string;
  readonly durationMs: number;
  readonly forceExpanded?: boolean;
}

/** Map persisted query timing to the messages that belong to that query. */
export function projectWebuiQueryDurations(
  messages: readonly Pick<WebuiClientMessage, "msgId" | "queryKey">[],
  views: readonly WebuiQueryCollapseView[],
): ReadonlyMap<string, WebuiMessageQueryDuration> {
  const durationByQuery = new Map<string, WebuiMessageQueryDuration>();
  for (const view of views) {
    const { processingStartedAtMs: start, processingFinishedAtMs: end } = view;
    if (
      typeof view.queryKey === "string" && view.queryKey.length > 0 &&
      typeof start === "number" && Number.isFinite(start) &&
      typeof end === "number" && Number.isFinite(end) && end >= start
    ) durationByQuery.set(view.queryKey, {
      queryKey: view.queryKey,
      durationMs: end - start,
      ...(view.forceExpanded === true ? { forceExpanded: true } : {}),
    });
  }
  const out = new Map<string, WebuiMessageQueryDuration>();
  for (const message of messages) {
    if (!message.queryKey) continue;
    const queryDuration = durationByQuery.get(message.queryKey);
    if (queryDuration) out.set(message.msgId, queryDuration);
  }
  return out;
}

/** Preserve the per-message activity segments that Desktop renders as rows. */
export function projectWebuiProcessSegments(
  items: readonly WebuiTranscriptItem[],
): readonly WebuiTranscriptProcessSegment[] {
  const segments: WebuiTranscriptProcessSegment[] = [];
  const byMessageId = new Map<string, WebuiTranscriptProcessSegment>();
  for (const item of items) {
    if (item.kind !== "thinking" && item.kind !== "tool" && item.kind !== "assistant" && !("activityType" in item)) continue;
    const current = byMessageId.get(item.messageId) ?? {
      messageId: item.messageId,
    };
    let parts: readonly WebuiTranscriptActivityPart[];
    if (item.kind === "thinking") parts = [{ type: "thinking", text: item.text, ...(item.durationMs !== undefined ? { durationMs: item.durationMs } : {}) }];
    else if (item.kind === "tool") parts = item.tools.map((tool) => ({ type: "tool", tool }));
    else if (item.kind === "assistant") parts = [{ type: "text", text: item.text }];
    else {
      const activity = item as Extract<WebuiTranscriptItem, { activityType: string }>;
      if (activity.activityType === "delegation") parts = [{ type: "delegation", message: activity.detail ?? {} }];
      else if (activity.activityType === "agent_joined") parts = [{ type: "agent_joined", agent: activity.detail ?? {} }];
      else if (activity.activityType === "cognitive") parts = [{ type: "cognitive", text: activity.text ?? "" }];
      else parts = [{ type: "compaction", text: activity.text ?? "" }];
    }
    const next: WebuiTranscriptProcessSegment = item.kind === "thinking"
      ? {
          ...current,
          thinking: item.text,
          ...(item.durationMs !== undefined
            ? { thinkingDurationMs: item.durationMs }
            : {}),
        }
      : item.kind === "tool"
      ? {
          ...current,
          tools: [...(current.tools ?? []), ...(item as Extract<WebuiTranscriptItem, { kind: "tool" }>).tools],
        }
      : current;
    const withParts = { ...next, activityParts: [...(current.activityParts ?? []), ...parts] };
    if (!byMessageId.has(item.messageId)) segments.push(withParts);
    else {
      const index = segments.findIndex(
        (segment) => segment.messageId === item.messageId,
      );
      if (index >= 0) segments[index] = withParts;
    }
    byMessageId.set(item.messageId, withParts);
  }
  // Once a group has process activity, keep text-only assistant messages too:
  // Desktop treats earlier replies as archived process content while the
  // final reply remains outside the disclosure. Dropping text-only segments
  // here makes that boundary impossible to project in the renderer.
  return segments.some((segment) => segment.activityParts?.some((part) => part.type !== "text"))
    ? segments
    : [];
}

/**
 * Group transcript items into renderer blocks. A user line always opens its
 * own block; the assistant's following tool/answer items for the same
 * `messageId` merge into the same block. Wall-clock duration is computed
 * across group boundaries (the user's prompt timestamp → the assistant's
 * last timestamp) so the header reads "共执行 N 分 M 秒".
 *
 * `usage.outputTokens` is counted once per messageId, not once per item —
 * `projectWebuiMessage` emits one item per part (thinking / tool / text) and
 * every part carries the same `usage` blob.
 */
export function groupWebuiTranscriptItems(
  items: readonly WebuiTranscriptItem[],
  queryDurationByMessageId: ReadonlyMap<string, WebuiMessageQueryDuration> = new Map(),
): readonly WebuiTranscriptGroup[] {
  type Group = {
    messageId: string;
    turnId?: string;
    items: WebuiTranscriptItem[];
    totalRequestDurationMs?: number;
    totalOutputTokens?: number;
    forceExpanded?: boolean;
    assistantMaxTimestamp?: number;
    queryDurations?: Map<string, WebuiMessageQueryDuration>;
  };
  // The user and assistant blocks live in different groups (the renderer
  // opens its own block for every user line). To compute a wall-clock span
  // across the user prompt and the assistant reply, remember the smallest
  // user timestamp we have seen per turn key, then look it up when the
  // matching assistant block lands. Keyed by turnId when present, falling
  // back to queryKey and finally messageId for unkeyed cases.
  const userStartByTurn = new Map<string, number>();
  const turnKeyFor = (item: WebuiTranscriptItem): string =>
    item.turnId ?? item.messageId;
  for (const item of items) {
    if (
      item.kind === "user" &&
      typeof item.timestamp === "number" &&
      Number.isFinite(item.timestamp)
    ) {
      const key = turnKeyFor(item);
      const current = userStartByTurn.get(key);
      if (current === undefined || item.timestamp < current) {
        userStartByTurn.set(key, item.timestamp);
      }
    }
  }
  const countedMessages = new Set<string>();
  const out: Group[] = [];
  const addUsage = (group: Group, item: WebuiTranscriptItem): void => {
    if (item.kind === "user" || item.kind === "questionnaire_response" || item.kind === "activity") return;
    if (typeof item.timestamp === "number" && Number.isFinite(item.timestamp)) {
      group.assistantMaxTimestamp = Math.max(
        group.assistantMaxTimestamp ?? Number.NEGATIVE_INFINITY,
        item.timestamp,
      );
    }
    if (countedMessages.has(item.messageId)) return;
    countedMessages.add(item.messageId);
    const queryDuration = queryDurationByMessageId.get(item.messageId);
    if (queryDuration) {
      group.queryDurations ??= new Map();
      group.queryDurations.set(queryDuration.queryKey, queryDuration);
      if (queryDuration.forceExpanded) group.forceExpanded = true;
    }
    const usage = item.usage;
    const tokens = readUsageNumber(usage, "outputTokens", "output_tokens");
    if (typeof tokens === "number") {
      group.totalOutputTokens = (group.totalOutputTokens ?? 0) + tokens;
    }
    const duration = readUsageNumber(
      usage,
      "requestDurationMs",
      "request_duration_ms",
    );
    if (typeof duration === "number") {
      group.totalRequestDurationMs =
        (group.totalRequestDurationMs ?? 0) + duration;
    }
  };
  for (const item of items) {
    const last = out[out.length - 1];
    const lastIsUser = last?.items[0]?.kind === "user";
    const joinsOpenBlock =
      last &&
      ((!lastIsUser && item.kind !== "user") ||
        last.messageId === item.messageId);
    if (joinsOpenBlock && last) {
      last.items.push(item);
      if (!last.turnId && item.turnId) last.turnId = item.turnId;
      addUsage(last, item);
    } else {
      const group: Group = {
        messageId: item.messageId,
        ...(item.turnId ? { turnId: item.turnId } : {}),
        items: [item],
      };
      countedMessages.clear();
      addUsage(group, item);
      out.push(group);
    }
  }
  return out.map((group) => {
    const { assistantMaxTimestamp, queryDurations, ...rest } = group;
    if (queryDurations?.size) {
      const queryViews = [...queryDurations.values()];
      rest.totalRequestDurationMs = queryViews.reduce((sum, view) => sum + view.durationMs, 0);
      if (queryViews.some((view) => view.forceExpanded)) rest.forceExpanded = true;
    }
    const userStart = userStartByTurn.get(group.turnId ?? group.messageId);
    if (
      typeof userStart === "number" &&
      typeof assistantMaxTimestamp === "number" &&
      assistantMaxTimestamp > userStart
    ) {
      const wallClockDurationMs = assistantMaxTimestamp - userStart;
      // Only surface the duration when it is meaningful (≥ 1s). A single
      // timestamp or sub-second gap would otherwise render as "共执行 0 秒".
      if (wallClockDurationMs >= 1000) {
        return { ...rest, wallClockDurationMs };
      }
    }
    return rest;
  });
}

/**
 * Extract the session id a runtime event targets, accepting both camelCase
 * and snake_case spellings. The effect protocol uses this to filter out
 * events that belong to a different session before they reach the state
 * mutators.
 */
export function eventSessionId(event: WebuiRuntimeEvent): string | undefined {
  const value = event.payload.sessionId ?? event.payload.session_id;
  return typeof value === "string" ? value : undefined;
}

/**
 * Parse a `permission.ask` event into the pending-permission view model the
 * UI stores. Returns undefined when the payload is missing any required
 * field — callers (including the effect reducer) treat that as "ignore".
 */
export function pendingPermissionFromEvent(
  event: WebuiRuntimeEvent,
): WebuiPendingPermission | undefined {
  const payload = event.payload;
  if (
    typeof payload.requestId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.agentName !== "string" ||
    typeof payload.toolName !== "string" ||
    !Array.isArray(payload.ruleContents) ||
    !payload.ruleContents.every((item) => typeof item === "string") ||
    typeof payload.reason !== "string" ||
    typeof payload.allowAlwaysSupported !== "boolean" ||
    typeof payload.createdAt !== "number"
  )
    return undefined;
  return {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    agentName: payload.agentName,
    toolName: payload.toolName,
    ruleContents: payload.ruleContents,
    ...(typeof payload.toolInput === "string"
      ? { toolInput: payload.toolInput }
      : {}),
    ...(typeof payload.toolDescription === "string"
      ? { toolDescription: payload.toolDescription }
      : {}),
    reason: payload.reason,
    allowAlwaysSupported: payload.allowAlwaysSupported,
    createdAt: payload.createdAt,
  };
}

/**
 * Parse a `questionnaire.ask` event into the questionnaire view model. The
 * wire frame carries the request under `payload.request`, with a couple of
 * required shape checks the runtime contract requires us to validate.
 */
export function questionnaireFromEvent(
  event: WebuiRuntimeEvent,
): WebuiQuestionnaireRequest | undefined {
  const value = event.payload.request;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const request = value as Partial<WebuiQuestionnaireRequest>;
  if (
    typeof request.id !== "string" ||
    typeof request.schemaVersion !== "number" ||
    !Array.isArray(request.steps)
  )
    return undefined;
  return request as WebuiQuestionnaireRequest;
}

/**
 * Replace-or-append a permission entry. The reducer uses this to land the
 * `permission.ask` payload: any existing entry with the same `requestId` is
 * dropped, then the new entry is appended. Order is preserved so the
 * panel's existing tests (which assert the order) keep working.
 */
export function replacePermission(
  current: readonly WebuiPendingPermission[],
  next: WebuiPendingPermission,
): readonly WebuiPendingPermission[] {
  return [
    ...current.filter((permission) => permission.requestId !== next.requestId),
    next,
  ];
}
