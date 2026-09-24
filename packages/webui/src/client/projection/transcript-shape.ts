/**
 * Transcript shape catalog.
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
 * `WEBUI_HISTORICAL_FIELD_TABLE` and `WEBUI_LIVE_FIELD_TABLE` enumerate the
 * fields each adapter owns. `WEBUI_FIELD_OWNERSHIP_TABLE` is the union: it
 * pins which fields are exclusive to one path, which are shared, and which
 * are derived. These tables are pure documentation — the runtime shapes
 * remain the source of truth, the tables just pin the contracts the new leaf
 * renderer tests assert against.
 *
 * No runtime behaviour change: this module adds comments and field tables;
 * the existing `projectWebuiMessage` and `stream.messages` consumers are
 * untouched.
 */

import type { WebuiClientMessage, WebuiMessageAttachment } from "../contracts.js";
import type { WebuiStreamMessage } from "../stream.js";

/**
 * One row of the historical field table. `source` is the wire field the
 * runtime owns; `projectedTo` is the prop key the leaf renderer (MessageItem)
 * reads; `projection` describes how the adapter folds the wire shape into
 * the prop value (verbatim / re-shape / join / derive-from-peer).
 */
export interface WebuiHistoricalFieldRow {
  readonly field: keyof WebuiClientMessage | "derived";
  readonly projectedTo: string;
  readonly projection: "verbatim" | "reshape" | "join" | "derive";
  readonly notes: string;
}

/**
 * One row of the live field table. Same shape as the historical table but
 * the `source` is from `WebuiStreamMessage`.
 */
export interface WebuiLiveFieldRow {
  readonly field: keyof WebuiStreamMessage | "derived";
  readonly projectedTo: string;
  readonly projection: "verbatim" | "reshape" | "join" | "derive";
  readonly notes: string;
}

/**
 * One row of the ownership table. `owner` says which adapter is the
 * canonical writer; `shared` flags fields both paths may carry (typically
 * the user bubble, which both the historical record and the live replay
 * surface).
 */
export interface WebuiFieldOwnershipRow {
  readonly field: string;
  readonly owner: "historical" | "live" | "shared";
  readonly notes: string;
}

/**
 * Historical field table. Read by the leaf renderer tests as the contract
 * the historical adapter must satisfy.
 *
 * The historical record is the source of truth for everything except the
 * `streaming` / `streamMessageId` / `messageRootId` props the live path
 * owns — those three only exist in the in-flight renderer.
 */
export const WEBUI_HISTORICAL_FIELD_TABLE: readonly WebuiHistoricalFieldRow[] =
  [
    {
      field: "msgId",
      projectedTo: "messageId",
      projection: "verbatim",
      notes: "Server-assigned message id; React key + data-message-id.",
    },
    {
      field: "parentMsgId",
      projectedTo: "(parent chain)",
      projection: "derive",
      notes:
        "Used by message-projection.ts to stitch branches; not surfaced to MessageItem directly.",
    },
    {
      field: "turnId",
      projectedTo: "turnId",
      projection: "verbatim",
      notes: "Assistant-group key; absent on pure user bubbles.",
    },
    {
      field: "queryKey",
      projectedTo: "(query-key — indexing only)",
      projection: "reshape",
      notes: "Server-side ordering key; not rendered.",
    },
    {
      field: "timestamp",
      projectedTo: "timestamp",
      projection: "verbatim",
      notes: "formatWebuiMessageTimestamp(timestamp) in the bubble footer.",
    },
    {
      field: "msgContent",
      projectedTo: "userText / answers[*]",
      projection: "reshape",
      notes:
        "Stripped of <questionnaire-response> XML by message-parts; the rest becomes text parts.",
    },
    {
      field: "msgType",
      projectedTo: "(unused by leaf renderer)",
      projection: "reshape",
      notes: "Server-side kind enum; projection ignores.",
    },
    {
      field: "role",
      projectedTo: "role",
      projection: "verbatim",
      notes: "'user' | 'assistant' — drives bubble alignment.",
    },
    {
      field: "thinkingContent",
      projectedTo: "thinking",
      projection: "reshape",
      notes: "Joined across thinking parts by projectMessageParts.",
    },
    {
      field: "thinkingDurationMs",
      projectedTo: "thinkingDurationMs",
      projection: "verbatim",
      notes: "First thinking part's duration; drives the 已思考 N 秒 row.",
    },
    {
      field: "toolCalls",
      projectedTo: "tools[*]",
      projection: "reshape",
      notes: "Each tool call becomes one tool-call item under the assistant group.",
    },
    {
      field: "attachments",
      projectedTo: "attachments",
      projection: "verbatim",
      notes: "Passthrough to MessageItem; ordered by message-parts projector.",
    },
    {
      field: "usage",
      projectedTo: "totalRequestDurationMs / totalOutputTokens / wallClockDurationMs",
      projection: "reshape",
      notes:
        "messageUsage reader pulls request_duration_ms + output_tokens; wall clock derives from group span.",
    },
    {
      field: "source",
      projectedTo: "isGoal (when source === 'thread-goal' || kind === 'goal')",
      projection: "derive",
      notes: "Right-aligned goal banner instead of plain user bubble.",
    },
    {
      field: "kind",
      projectedTo: "isGoal (when kind === 'goal')",
      projection: "derive",
      notes: "Same flag as `source === 'thread-goal'`; either suffices.",
    },
    {
      field: "actions",
      projectedTo: "actions",
      projection: "verbatim",
      notes: "fork / rewind / edit capability flags forwarded to MessageItem.",
    },
    {
      field: "fileChanges",
      projectedTo: "initialDiff",
      projection: "reshape",
      notes:
        "Last (most recent) file diff in the message wins; matches Desktop's 'newest diff' rule.",
    },
    {
      field: "forkOrigin",
      projectedTo: "(metadata only)",
      projection: "reshape",
      notes: "Server-side fork lineage; not surfaced.",
    },
    {
      field: "communicationInfosJson",
      projectedTo: "(metadata only)",
      projection: "reshape",
      notes: "Server-side communication log; not surfaced.",
    },
  ] as const;

/**
 * Live field table. The live record is sparser than the historical one;
 * only fields that ride on the wire frames are present until the turn
 * lands.
 */
export const WEBUI_LIVE_FIELD_TABLE: readonly WebuiLiveFieldRow[] = [
  {
    field: "id",
    projectedTo: "messageId / streamMessageId",
    projection: "verbatim",
    notes:
      "Server-assigned message id; same id reappears on the historical record after the turn lands.",
    },
  {
    field: "answer",
    projectedTo: "userText / answers[*] (live)",
    projection: "verbatim",
    notes:
      "In-flight text the composer renders inside the right-aligned bubble.",
    },
  {
    field: "thinking",
    projectedTo: "thinking (live)",
    projection: "verbatim",
    notes: "In-flight thinking; replaced by the historical record on land.",
  },
  {
    field: "timestamp",
    projectedTo: "timestamp (live)",
    projection: "verbatim",
    notes: "Optional in-flight timestamp.",
  },
  {
    field: "isGoal",
    projectedTo: "isGoal",
    projection: "verbatim",
    notes: "Right-aligned goal banner flag.",
  },
  {
    field: "toolCalls",
    projectedTo: "tools (live)",
    projection: "verbatim",
    notes: "In-flight tool calls; carried through the turn.",
  },
  {
    field: "usage",
    projectedTo: "totalRequestDurationMs / totalOutputTokens (live)",
    projection: "reshape",
    notes: "Per-message usage reported on agent_message frames.",
  },
  {
    field: "role",
    projectedTo: "role",
    projection: "verbatim",
    notes: "'user' replays from the server as the in-flight user bubble.",
  },
  {
    field: "derived",
    projectedTo: "streaming / messageRootId",
    projection: "derive",
    notes:
      "Driven by stream.phase; not a field on WebuiStreamMessage itself.",
  },
] as const;

/**
 * Ownership table. Pin which fields are exclusive to one adapter and
 * which both paths carry.
 */
export const WEBUI_FIELD_OWNERSHIP_TABLE: readonly WebuiFieldOwnershipRow[] = [
  {
    field: "messageId",
    owner: "shared",
    notes: "Server-assigned id; both adapters must agree (the contract on land).",
  },
  {
    field: "role",
    owner: "shared",
    notes: "'user' / 'assistant' — both paths surface it.",
  },
  {
    field: "text (msgContent / answer)",
    owner: "shared",
    notes: "The transcript text; live stream replaces historical until the turn lands.",
  },
  {
    field: "thinking",
    owner: "shared",
    notes: "Live stream carries the in-flight text; historical carries the recorded text.",
  },
  {
    field: "tools",
    owner: "shared",
    notes: "Tool calls ride both paths (live frames + historical record).",
  },
  {
    field: "attachments",
    owner: "shared",
    notes: "Live may carry fewer attachments than the final historical record.",
  },
  {
    field: "timestamp",
    owner: "shared",
    notes: "Both paths surface it; historical is authoritative after land.",
  },
  {
    field: "isGoal",
    owner: "shared",
    notes: "Right-aligned goal banner; both adapters must agree.",
  },
  {
    field: "usage",
    owner: "shared",
    notes: "Live reports per-message usage on agent_message; historical carries the final usage.",
  },
  {
    field: "actions",
    owner: "historical",
    notes: "fork / rewind / edit capabilities are only persisted in the historical message.",
  },
  {
    field: "initialDiff",
    owner: "historical",
    notes: "fileChanges only persist in the historical message; live never carries diffs.",
  },
  {
    field: "streaming",
    owner: "live",
    notes: "Only the live adapter sets `streaming: true`; historical is always `false`.",
  },
  {
    field: "streamMessageId / messageRootId",
    owner: "live",
    notes: "In-flight data attrs; never present on the historical record.",
  },
] as const;

/**
 * The minimum turn shape both adapters must surface to the leaf renderer.
 * Used by the leaf renderer tests to assert both adapters agree on the
 * contract.
 *
 * This is documentation, not a runtime type alias — the actual props
 * `MessageItem` reads come from the historical record and the live stream
 * with their respective field tables above. The shape here is the
 * intersection of the two adapters' visible fields, plus the markers that
 * distinguish them (`streaming`, `source: "live" | "historical"`).
 */
export interface WebuiMinimumTurnShape {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly attachments?: readonly WebuiMessageAttachment[];
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly usage?: Record<string, unknown>;
  readonly actions?: WebuiClientMessage["actions"];
  readonly streaming?: boolean;
  readonly source: "historical" | "live";
}