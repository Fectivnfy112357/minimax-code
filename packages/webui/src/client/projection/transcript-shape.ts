/**
 * Transcript shape catalog + turn-view adapters.
 *
 * SessionTranscript has two adapter paths:
 *
 *   1. **Historical** — `loadMessages({ id })` → `WebuiClientMessagePage`
 *      (`contracts.ts`). The server returns fully-materialised records; each
 *      record carries every field the runtime has ever written for the
 *      message (timestamp, usage, fileChanges, forkOrigin, etc.).
 *
 *   2. **Live** — `stream.messages` (`stream.ts`). Each frame appends or
 *      replaces a partial record; the renderer holds the latest snapshot
 *      until the turn lands and the historical adapter takes over.
 *
 * Both paths reduce to the same leaf-renderer shape (`MessageItem`), but
 * the field sets they carry differ: the live path has no `usage` /
 * `fileChanges` / `forkOrigin` until the corresponding frames arrive, and
 * the historical path has no `streaming` flag — the live path is what marks
 * the boundary between the two adapters.
 *
 * This module is now the **production wiring** for that boundary, not just
 * documentation. The shared `WebuiTurnView` type captures the minimum set
 * of fields both adapters must surface to the leaf renderer. Two pure
 * adapter functions (`projectHistoricalTurnView` and
 * `projectLiveTurnView`) read the wire shapes and produce the normalised
 * view; the consumers in `SessionTranscript.tsx`, `SessionComposer.tsx`,
 * and `MessageItem.tsx` import them directly.
 *
 * `WEBUI_HISTORICAL_FIELD_TABLE`, `WEBUI_LIVE_FIELD_TABLE`, and
 * `WEBUI_FIELD_OWNERSHIP_TABLE` are kept as readonly documentation tables;
 * the runtime field-ownership truth lives in the two adapters.
 */

import type {
  WebuiClientMessage,
  WebuiMessageAttachment,
  WebuiTransport,
  WebuiTranscriptItem,
  WebuiTranscriptProcessSegment,
} from "../contracts.js";
import type { WebuiStreamMessage } from "../stream.js";
import type { WebuiTurnDiffView } from "../../server/port.js";
import type { WebuiMessageActionCapabilities } from "../components/MessageActions.js";
import {
  projectMessageAttachments,
  readMessageDiff,
  projectWebuiMessage,
  readUsageNumber,
} from "./message-projection.js";

// ── Field table documentation (readonly; pinned by tests) ────────────

export interface WebuiHistoricalFieldRow {
  readonly field: keyof WebuiClientMessage | "derived";
  readonly projectedTo: string;
  readonly projection: "verbatim" | "reshape" | "join" | "derive";
  readonly notes: string;
}

export interface WebuiLiveFieldRow {
  readonly field: keyof WebuiStreamMessage | "derived";
  readonly projectedTo: string;
  readonly projection: "verbatim" | "reshape" | "join" | "derive";
  readonly notes: string;
}

export interface WebuiFieldOwnershipRow {
  readonly field: string;
  readonly owner: "historical" | "live" | "shared";
  readonly notes: string;
}

export const WEBUI_HISTORICAL_FIELD_TABLE: readonly WebuiHistoricalFieldRow[] =
  [
    { field: "msgId", projectedTo: "messageId", projection: "verbatim", notes: "Server-assigned message id; React key + data-message-id." },
    { field: "parentMsgId", projectedTo: "(parent chain)", projection: "derive", notes: "Used by message-projection.ts to stitch branches; not surfaced to MessageItem directly." },
    { field: "turnId", projectedTo: "turnId", projection: "verbatim", notes: "Assistant-group key; absent on pure user bubbles." },
    { field: "queryKey", projectedTo: "(query-key — indexing only)", projection: "reshape", notes: "Server-side ordering key; not rendered." },
    { field: "timestamp", projectedTo: "timestamp", projection: "verbatim", notes: "formatWebuiMessageTimestamp(timestamp) in the bubble footer." },
    { field: "msgContent", projectedTo: "userText / answers[*]", projection: "reshape", notes: "Stripped of <questionnaire-response> XML by message-parts; the rest becomes text parts." },
    { field: "msgType", projectedTo: "(unused by leaf renderer)", projection: "reshape", notes: "Server-side kind enum; projection ignores." },
    { field: "role", projectedTo: "role", projection: "verbatim", notes: "'user' | 'assistant' — drives bubble alignment." },
    { field: "thinkingContent", projectedTo: "thinking", projection: "reshape", notes: "Joined across thinking parts by projectMessageParts." },
    { field: "thinkingDurationMs", projectedTo: "thinkingDurationMs", projection: "verbatim", notes: "First thinking part's duration; drives the 已思考 N 秒 row." },
    { field: "toolCalls", projectedTo: "tools[*]", projection: "reshape", notes: "Each tool call becomes one tool-call item under the assistant group." },
    { field: "attachments", projectedTo: "attachments", projection: "verbatim", notes: "Passthrough to MessageItem; ordered by message-parts projector." },
    { field: "usage", projectedTo: "totalRequestDurationMs / totalOutputTokens / wallClockDurationMs", projection: "reshape", notes: "messageUsage reader pulls request_duration_ms + output_tokens; wall clock derives from group span." },
    { field: "source", projectedTo: "isGoal (when source === 'thread-goal' || kind === 'goal')", projection: "derive", notes: "Right-aligned goal banner instead of plain user bubble." },
    { field: "kind", projectedTo: "isGoal (when kind === 'goal')", projection: "derive", notes: "Same flag as `source === 'thread-goal'`; either suffices." },
    { field: "actions", projectedTo: "actions", projection: "verbatim", notes: "fork / rewind / edit capability flags forwarded to MessageItem." },
    { field: "fileChanges", projectedTo: "initialDiff", projection: "reshape", notes: "Last (most recent) file diff in the message wins; matches Desktop's 'newest diff' rule." },
    { field: "forkOrigin", projectedTo: "(metadata only)", projection: "reshape", notes: "Server-side fork lineage; not surfaced." },
    { field: "communicationInfosJson", projectedTo: "(metadata only)", projection: "reshape", notes: "Server-side communication log; not surfaced." },
  ] as const;

export const WEBUI_LIVE_FIELD_TABLE: readonly WebuiLiveFieldRow[] = [
  { field: "id", projectedTo: "messageId / streamMessageId", projection: "verbatim", notes: "Server-assigned message id; same id reappears on the historical record after the turn lands." },
  { field: "answer", projectedTo: "userText / answers[*] (live)", projection: "verbatim", notes: "In-flight text the composer renders inside the right-aligned bubble." },
  { field: "thinking", projectedTo: "thinking (live)", projection: "verbatim", notes: "In-flight thinking; replaced by the historical record on land." },
  { field: "timestamp", projectedTo: "timestamp (live)", projection: "verbatim", notes: "Optional in-flight timestamp." },
  { field: "isGoal", projectedTo: "isGoal", projection: "verbatim", notes: "Right-aligned goal banner flag." },
  { field: "toolCalls", projectedTo: "tools (live)", projection: "verbatim", notes: "In-flight tool calls; carried through the turn." },
  { field: "usage", projectedTo: "totalRequestDurationMs / totalOutputTokens (live)", projection: "reshape", notes: "Per-message usage reported on agent_message frames." },
  { field: "role", projectedTo: "role", projection: "verbatim", notes: "'user' replays from the server as the in-flight user bubble." },
  { field: "derived", projectedTo: "streaming / messageRootId", projection: "derive", notes: "Driven by stream.phase; not a field on WebuiStreamMessage itself." },
] as const;

export const WEBUI_FIELD_OWNERSHIP_TABLE: readonly WebuiFieldOwnershipRow[] = [
  { field: "messageId", owner: "shared", notes: "Server-assigned id; both adapters must agree (the contract on land)." },
  { field: "role", owner: "shared", notes: "'user' / 'assistant' — both paths surface it." },
  { field: "text (msgContent / answer)", owner: "shared", notes: "The transcript text; live stream replaces historical until the turn lands." },
  { field: "thinking", owner: "shared", notes: "Live stream carries the in-flight text; historical carries the recorded text." },
  { field: "tools", owner: "shared", notes: "Tool calls ride both paths (live frames + historical record)." },
  { field: "attachments", owner: "shared", notes: "Live may carry fewer attachments than the final historical record." },
  { field: "timestamp", owner: "shared", notes: "Both paths surface it; historical is authoritative after land." },
  { field: "isGoal", owner: "shared", notes: "Right-aligned goal banner; both adapters must agree." },
  { field: "usage", owner: "shared", notes: "Live reports per-message usage on agent_message; historical carries the final usage." },
  { field: "actions", owner: "historical", notes: "fork / rewind / edit capabilities are only persisted in the historical message." },
  { field: "initialDiff", owner: "historical", notes: "fileChanges only persist in the historical message; live never carries diffs." },
  { field: "streaming", owner: "live", notes: "Only the live adapter sets `streaming: true`; historical is always `false`." },
  { field: "streamMessageId / messageRootId", owner: "live", notes: "In-flight data attrs; never present on the historical record." },
] as const;

// ── Shared leaf renderer input contract ──────────────────────────────

/**
 * Capability subset the leaf renderer passes through to its action
 * handlers. Kept verbatim from `MessageItem` so adapters don't have to
 * shape it differently — runtime-bindable, not data-derived.
 */
export type WebuiTurnViewCapabilities = Pick<
  WebuiTransport,
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionForkOptions"
  | "forkSession"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
>;

/**
 * The minimum normalised turn view. Both adapter paths produce this shape;
 * `MessageItem` reads it through the `view` prop and treats legacy
 * individual props as fallback. Fields the live path can never carry
 * (`actions`, `initialDiff`) are typed optional; the historical adapter
 * fills them, the live adapter leaves them undefined.
 *
 * `source` is the only field both adapters must set — it tells the leaf
 * renderer which path produced the view and which provenance attrs
 * (`streaming` / `messageRootId` / `streamMessageId`) apply.
 */
export interface WebuiTurnView {
  readonly source: "historical" | "live";
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly actions?: WebuiMessageActionCapabilities;
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly userText?: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers?: readonly string[];
  readonly attachments?: readonly WebuiMessageAttachment[];
  readonly streaming?: boolean;
  readonly streamMessageId?: string;
  readonly messageRootId?: string;
  readonly processSegments?: readonly WebuiTranscriptProcessSegment[];
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  readonly wallClockDurationMs?: number;
}

// ── Adapters ─────────────────────────────────────────────────────────

/**
 * Project a single persisted `WebuiClientMessage` into the leaf renderer's
 * input view. Pulls the user / thinking / tool / answer parts through the
 * existing `projectWebuiMessage` (so part ordering and synthetic-message
 * rules stay in one place), then folds the per-message `usage` into
 * `totalRequestDurationMs` / `totalOutputTokens` the leaf renderer
 * expects, and pulls the last `WebuiTurnDiffView` for `initialDiff`.
 *
 * `sessionId` is provided by the caller (the transcript projection owns the
 * session scope; the adapter is per-message).
 */
export function projectHistoricalTurnView(
  message: WebuiClientMessage,
  sessionId: string,
): WebuiTurnView {
  const items: WebuiTranscriptItem[] = projectWebuiMessage(message);
  const userItems = items.filter(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
      item.kind === "user",
  );
  const thinkingItems = items.filter(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
      item.kind === "thinking",
  );
  const assistantItems = items.filter(
    (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
      item.kind === "assistant",
  );
  const tools = items
    .filter(
      (item): item is Extract<WebuiTranscriptItem, { kind: "tool" }> =>
        item.kind === "tool",
    )
    .flatMap((item) => item.tools);
  const lastDiff = [...items]
    .reverse()
    .find(
      (item): item is Extract<WebuiTranscriptItem, { diff?: WebuiTurnDiffView }> =>
        "diff" in item,
    )?.diff;
  const fallbackDiff = readMessageDiff(message);
  const initialDiff = lastDiff ?? fallbackDiff;
  const firstItem = items[0];
  const actions =
    firstItem && "actions" in firstItem ? firstItem.actions : undefined;
  const timestamp =
    firstItem && "timestamp" in firstItem ? firstItem.timestamp : undefined;
  const isGoal = assistantItems.some((item) => item.isGoal) ||
    userItems.some((item) => item.isGoal) ||
    message.source === "thread-goal" ||
    message.kind === "goal";
  const attachments = projectMessageAttachments(message.attachments);
  const role: "user" | "assistant" = userItems.length > 0 &&
    assistantItems.length === 0
    ? "user"
    : "assistant";
  const turnId = message.turnId;
  // `wallClockDurationMs` lives on the group (sum-of-frame span); the
  // per-message adapter has no group span, so leave undefined and let the
  // group-level projector fill it when SessionTranscript collapses turns.
  const totalRequestDurationMs = readUsageNumber(
    message.usage,
    "requestDurationMs",
    "request_duration_ms",
  );
  const totalOutputTokens = readUsageNumber(
    message.usage,
    "outputTokens",
    "output_tokens",
  );
  return {
    source: "historical",
    messageId: message.msgId,
    role,
    sessionId,
    ...(turnId ? { turnId } : {}),
    ...(actions ? { actions } : {}),
    ...(timestamp !== undefined ? { timestamp } : {}),
    ...(isGoal ? { isGoal: true } : {}),
    ...(userItems[0]?.text !== undefined
      ? { userText: userItems[0].text }
      : {}),
    ...(thinkingItems.length > 0
      ? { thinking: thinkingItems.map((item) => item.text).join("\n\n") }
      : {}),
    ...(thinkingItems[0]?.durationMs !== undefined
      ? { thinkingDurationMs: thinkingItems[0].durationMs }
      : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(assistantItems.length > 0
      ? { answers: assistantItems.map((item) => item.text) }
      : {}),
    ...(attachments ? { attachments } : {}),
    ...(initialDiff ? { initialDiff } : {}),
    ...(typeof totalRequestDurationMs === "number"
      ? { totalRequestDurationMs }
      : {}),
    ...(typeof totalOutputTokens === "number" ? { totalOutputTokens } : {}),
  };
}

/**
 * Project the in-flight live stream into one assistant-turn view. A single
 * `WebuiStreamMessage` is one frame — the live column renders the whole
 * turn as one body, so this adapter joins all non-user frames into one
 * `WebuiTurnView`. The first non-empty user frame is kept separately so the
 * caller can render the right-aligned pending bubble.
 *
 * Returns `undefined` when there are no assistant frames (the live column
 * is empty — caller renders the streaming loader instead).
 */
export function projectLiveTurnView(
  messages: readonly WebuiStreamMessage[],
  args: {
    readonly sessionId?: string;
    readonly streaming: boolean;
    readonly processingStartedAtMs?: number;
  },
): WebuiTurnView | undefined {
  const assistant = messages.filter((message) => message.role !== "user");
  if (assistant.length === 0) return undefined;
  const last = assistant[assistant.length - 1];
  if (!last) return undefined;
  const thinking = assistant
    .map((message) => message.thinking)
    .filter((value) => value.trim())
    .join("\n\n");
  const tools = assistant.flatMap((message) => message.toolCalls ?? []);
  const answers = assistant
    .map((message) => message.answer)
    .filter((value) => value.trim());
  const totalRequestDurationMs = assistant.reduce((sum, message) => {
    const value = readUsageNumber(
      message.usage,
      "requestDurationMs",
      "request_duration_ms",
    );
    return typeof value === "number" && Number.isFinite(value)
      ? sum + value
      : sum;
  }, 0);
  const totalOutputTokens = assistant.reduce((sum, message) => {
    const value = readUsageNumber(
      message.usage,
      "outputTokens",
      "output_tokens",
    );
    return typeof value === "number" && Number.isFinite(value)
      ? sum + value
      : sum;
  }, 0);
  const processSegments = assistant
    .map((message) => ({
      messageId: message.id,
      ...(message.thinking.trim() ? { thinking: message.thinking } : {}),
      ...(message.toolCalls?.length ? { tools: message.toolCalls } : {}),
    }))
    .filter((segment) => segment.thinking || segment.tools?.length);
  const view: WebuiTurnView = {
    source: "live",
    messageId: last.id,
    role: "assistant",
    ...(args.sessionId ? { sessionId: args.sessionId } : {}),
    assistantMessageId: last.id,
    streamMessageId: "merged",
    messageRootId: "merged",
    streaming: args.streaming,
    ...(args.processingStartedAtMs !== undefined
      ? { processingStartedAtMs: args.processingStartedAtMs }
      : {}),
    ...(thinking ? { thinking } : {}),
    ...(tools.length > 0 ? { tools } : {}),
    ...(answers.length > 0 ? { answers } : {}),
    ...(processSegments.length > 0 ? { processSegments } : {}),
    ...(totalRequestDurationMs > 0 ? { totalRequestDurationMs } : {}),
    ...(totalOutputTokens > 0 ? { totalOutputTokens } : {}),
  };
  return view;
}

/**
 * Project the pending user frame into the user-bubble view. Returns
 * `undefined` when there is no pending user bubble.
 */
export function projectLiveUserView(
  messages: readonly WebuiStreamMessage[],
): WebuiTurnView | undefined {
  const user = messages.find((message) => message.role === "user");
  if (!user) return undefined;
  return {
    source: "live",
    messageId: user.id,
    role: "user",
    streamMessageId: user.id,
    ...(user.timestamp !== undefined ? { timestamp: user.timestamp } : {}),
    ...(user.isGoal ? { isGoal: true } : {}),
    userText: user.answer,
  };
}