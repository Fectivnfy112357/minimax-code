// Message projection — convert a wire `WebuiClientMessage` into the
// component-facing transcript items, plus the small diff/usage helpers the
// projection relies on.
//
// The split is deliberate: `projection/message-parts.ts` turns the same wire
// message into Desktop-style `parts[]`, and this module adapts those parts
// into the `WebuiTranscriptItem[]` shape the components already render. It
// also owns the `readMessageDiff` / `readMessageUsage` / `readUsageNumber`
// helpers because both projections consume them — moving them here keeps the
// reusable readers next to each other.

import {
  booleanValue,
  numberValue,
  recordValue,
  stringValue,
} from "../value-readers.js";
import type {
  WebuiClientMessage,
  WebuiMessageAttachment,
  WebuiTranscriptItem,
} from "../contracts.js";
import type { WebuiFileDiffInfoView, WebuiTurnDiffView } from "../../server/port.js";
import {
  projectMessageParts,
  type WebuiMessageForParts,
} from "./message-parts.js";

/**
 * Read the per-message diff view off a wire message, accepting either the
 * flat `message` shape the live stream sends or the persisted snake_case
 * `rawJson` shape the loader hands back. Returns undefined when none of the
 * recognised fields carries a usable diff.
 */
export function readMessageDiff(
  message: WebuiClientMessage,
): WebuiTurnDiffView | undefined {
  const raw = (() => {
    if (message.rawJson) {
      try {
        return recordValue(JSON.parse(message.rawJson));
      } catch {
        return undefined;
      }
    }
    return recordValue(message);
  })();
  const meta = message.meta ?? recordValue(raw?.meta);
  const rawFiles =
    message.fileChanges ??
    raw?.file_changes ??
    raw?.fileChanges ??
    meta?.file_changes ??
    meta?.fileChanges;
  const fileChanges = Array.isArray(rawFiles)
    ? rawFiles.flatMap((file): WebuiFileDiffInfoView[] => {
        const value = recordValue(file);
        if (!value || typeof value.file !== "string") return [];
        return [
          {
            file: value.file,
            additions: typeof value.additions === "number" ? value.additions : 0,
            deletions: typeof value.deletions === "number" ? value.deletions : 0,
            ...(typeof value.status === "string" ? { status: value.status } : {}),
          },
        ];
      })
    : undefined;
  const sourceMessageId =
    message.sourceMessageId ??
    stringValue(raw?.sourceMessageId) ??
    stringValue(meta?.sourceMessageId);
  const changeSetId =
    message.changeSetId ??
    stringValue(raw?.changeSetId) ??
    stringValue(meta?.changeSetId);
  const status =
    message.turnDiffStatus ??
    stringValue(raw?.turnDiffStatus) ??
    stringValue(meta?.turnDiffStatus);
  const revertedAt =
    message.revertedAt ??
    numberValue(raw?.revertedAt) ??
    numberValue(meta?.revertedAt);
  const canUndo =
    message.canUndo ??
    booleanValue(raw?.canUndo) ??
    booleanValue(meta?.canUndo);
  const canReapply =
    message.canReapply ??
    booleanValue(raw?.canReapply) ??
    booleanValue(meta?.canReapply);
  if (
    !fileChanges?.length &&
    !sourceMessageId &&
    !changeSetId &&
    !status
  )
    return undefined;
  return {
    ...(fileChanges?.length ? { fileChanges } : {}),
    ...(sourceMessageId ? { sourceMessageId } : {}),
    ...(changeSetId ? { changeSetId } : {}),
    ...(status ? { status } : {}),
    ...(revertedAt !== undefined ? { revertedAt } : {}),
    ...(canUndo !== undefined ? { canUndo } : {}),
    ...(canReapply !== undefined ? { canReapply } : {}),
  };
}

/**
 * Project the raw wire `attachments[]` into the component-facing
 * `MessageAttachment[]`. Returns undefined when the wire array is missing or
 * carries no usable entries, so callers can use truthiness to decide whether
 * to render the attachments row.
 */
export function projectMessageAttachments(
  attachments: readonly unknown[] | undefined,
): readonly WebuiMessageAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  const projected: WebuiMessageAttachment[] = [];
  for (const entry of attachments) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const id = stringValue(record.id) ?? stringValue(record.attachment_id) ?? `${projected.length}-`;
    const typeValue = stringValue(record.type) ?? stringValue(record.attachment_type);
    const type: WebuiMessageAttachment["type"] = typeValue === "file" ? "file" : "image";
    const fileName =
      stringValue(record.file_name) ??
      stringValue(record.fileName) ??
      stringValue(record.name) ??
      id;
    projected.push({
      id,
      type,
      file_name: fileName,
      ...(stringValue(record.file_path) ?? stringValue(record.filePath)
        ? {
            file_path:
              stringValue(record.file_path) ?? stringValue(record.filePath),
          }
        : {}),
      ...(stringValue(record.preview_url) ?? stringValue(record.previewUrl)
        ? {
            preview_url:
              stringValue(record.preview_url) ?? stringValue(record.previewUrl),
          }
        : {}),
      ...(stringValue(record.desktop_path) ?? stringValue(record.desktopPath)
        ? {
            desktop_path:
              stringValue(record.desktop_path) ?? stringValue(record.desktopPath),
          }
        : {}),
      ...(stringValue(record.mime_type) ?? stringValue(record.mimeType)
        ? {
            mime_type:
              stringValue(record.mime_type) ?? stringValue(record.mimeType),
          }
        : {}),
      ...(typeof record.file_size === "number"
        ? { file_size: record.file_size }
        : {}),
      ...(stringValue(record.src) ? { src: stringValue(record.src) } : {}),
    });
  }
  return projected.length > 0 ? projected : undefined;
}

/**
 * Derive the user's usage banner notice from the cloud-issued quota window.
 * Returns null when no notice is warranted so the caller can fall back to
 * the per-message usage indicator. Only one notice is returned — the most
 * restrictive signal wins — so the banner never duplicates.
 */
export function deriveConversationUsageNotice(
  quota: WebuiUsageQuotaResult | undefined,
): ConversationUsageNotice | null {
  if (!quota || quota.signedIn === false) return null;
  const view = quota.quota;
  if (!view) return null;
  const candidates: ConversationUsageNotice[] = [];
  if (!view.weekly.unlimited && (view.weekly.usedPercent ?? 0) >= 80) {
    candidates.push({
      kind: "weekly",
      messageKey: "weekly",
      resetAtMs: view.weekly.resetAtMs ?? null,
      actions: ["subscribe_plan", "upgrade_plan"],
      dismissable: true,
    });
  }
  if (!view.fiveHour.unlimited && (view.fiveHour.usedPercent ?? 0) >= 80) {
    candidates.push({
      kind: "five_hour",
      messageKey: "five_hour",
      resetAtMs: view.fiveHour.resetAtMs ?? null,
      actions: ["buy_credits"],
      dismissable: true,
    });
  }
  if (view.video && !view.video.unlimited) {
    const remaining =
      (view.video.totalCount ?? 0) - (view.video.usedCount ?? 0);
    if (remaining <= 0) {
      candidates.push({
        kind: "video",
        messageKey: "video",
        resetAtMs: view.video.resetAtMs ?? null,
        actions: ["buy_credits"],
        dismissable: true,
      });
    }
  }
  return candidates[0] ?? null;
}

/**
 * Convert a wire message into the components-facing transcript items. The
 * pure parts layer preserves Desktop's source order (thinking → text → tool
 * calls → synthetic). This projection re-orders them into the legacy
 * `thinkingItems → toolItems → answerItems → questionnaireItems` order the
 * transcript renderer has always rendered, so callers see a stable item
 * stream regardless of the wire format.
 */
export function projectWebuiMessage(
  message: WebuiClientMessage,
): WebuiTranscriptItem[] {
  const thinkingItems: WebuiTranscriptItem[] = [];
  const toolItems: WebuiTranscriptItem[] = [];
  const answerItems: WebuiTranscriptItem[] = [];
  const questionnaireItems: WebuiTranscriptItem[] = [];
  const attachments = projectMessageAttachments(message.attachments);
  const messageUsage = readMessageUsage(message);
  for (const part of projectMessageParts(message)) {
    const turn = message.turnId ? { turnId: message.turnId } : {};
    if (part.type === "thinking")
      thinkingItems.push({
        kind: "thinking",
        text: part.content,
        messageId: message.msgId,
        ...turn,
        ...(part.durationMs !== undefined ? { durationMs: part.durationMs } : {}),
        ...(message.actions ? { actions: message.actions } : {}),
        ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
        ...(attachments ? { attachments } : {}),
        ...(messageUsage ? { usage: messageUsage } : {}),
      });
    else if (part.type === "text")
      answerItems.push({
        kind: message.role === "user" ? "user" : "assistant",
        text: part.content,
        messageId: message.msgId,
        ...turn,
        ...(message.actions ? { actions: message.actions } : {}),
        ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
        ...(message.source === "thread-goal" || message.kind === "goal"
          ? { isGoal: true }
          : {}),
        ...(attachments ? { attachments } : {}),
        ...(messageUsage ? { usage: messageUsage } : {}),
      });
    else if (part.type === "tool_call")
      toolItems.push({
        kind: "tool",
        tools: [part.toolCall],
        messageId: message.msgId,
        ...turn,
        ...(messageUsage ? { usage: messageUsage } : {}),
      });
    else if (part.type === "questionnaire_response")
      questionnaireItems.push({
        kind: "questionnaire_response",
        messageId: message.msgId,
        ...turn,
        summary: part.summary,
        ...(message.timestamp !== undefined ? { timestamp: message.timestamp } : {}),
      });
  }
  const output = [...thinkingItems, ...toolItems, ...answerItems, ...questionnaireItems];
  const diff = readMessageDiff(message);
  if (diff && output.length > 0) {
    const last = output.length - 1;
    const lastItem = output[last];
    if (
      lastItem &&
      (lastItem.kind === "user" ||
        lastItem.kind === "assistant" ||
        lastItem.kind === "thinking" ||
        lastItem.kind === "tool")
    )
      output[last] = { ...lastItem, diff };
  }
  return output;
}

/**
 * Read the per-message usage block — prefers the live wire frame's
 * camelCase `usage` object, falls back to the persisted snake_case `rawJson`
 * so the same projection works for history and live updates.
 */
export function readMessageUsage(
  message: WebuiClientMessage,
): Record<string, unknown> | undefined {
  const direct = (message as { usage?: unknown }).usage;
  if (direct && typeof direct === "object" && !Array.isArray(direct))
    return direct as Record<string, unknown>;
  if (typeof message.rawJson === "string") {
    try {
      const raw = JSON.parse(message.rawJson) as { usage?: unknown };
      if (raw.usage && typeof raw.usage === "object" && !Array.isArray(raw.usage))
        return raw.usage as Record<string, unknown>;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Numeric fields on the runtime `usage` payload — accept both the camelCase
 * keys the live wire frame ships and the snake_case keys the persisted
 * `data_json` carries.
 */
export function readUsageNumber(
  usage: Record<string, unknown> | undefined,
  ...keys: readonly string[]
): number | undefined {
  if (!usage) return undefined;
  for (const key of keys) {
    const value = usage[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
  }
  return undefined;
}

/* Local types referenced by `deriveConversationUsageNotice`. */

export interface WebuiUsageQuotaResult {
  readonly signedIn?: boolean;
  readonly quota?: {
    readonly weekly: {
      readonly unlimited?: boolean;
      readonly usedPercent?: number;
      readonly resetAtMs?: number | null;
    };
    readonly fiveHour: {
      readonly unlimited?: boolean;
      readonly usedPercent?: number;
      readonly resetAtMs?: number | null;
    };
    readonly video?: {
      readonly unlimited?: boolean;
      readonly totalCount?: number;
      readonly usedCount?: number;
      readonly resetAtMs?: number | null;
    };
  };
}

export type ConversationUsageActionKind =
  | "subscribe_plan"
  | "upgrade_plan"
  | "buy_credits";

export interface ConversationUsageNotice {
  readonly kind: "weekly" | "five_hour" | "video";
  readonly messageKey: "weekly" | "five_hour" | "video";
  readonly resetAtMs: number | null;
  readonly actions: readonly ConversationUsageActionKind[];
  readonly dismissable: boolean;
}