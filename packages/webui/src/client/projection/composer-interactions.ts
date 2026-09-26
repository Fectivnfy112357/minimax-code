export interface WebuiMentionRange {
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export function findWebuiMentionRange(
  value: string,
  caret: number,
): WebuiMentionRange | undefined {
  const beforeCaret = value.slice(0, caret);
  const match = /(?:^|\s)@([^\s@]*)$/u.exec(beforeCaret);
  if (!match) return undefined;
  const start = beforeCaret.length - match[1]!.length - 1;
  return { start, end: caret, query: match[1]! };
}

export function insertWebuiMention(
  value: string,
  range: WebuiMentionRange,
  insertion: string,
): { readonly value: string; readonly caret: number } {
  const before = value.slice(0, range.start);
  const after = value.slice(range.end);
  const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
  const text = `${prefix}${insertion} `;
  return {
    value: `${before}${text}${after}`,
    caret: before.length + text.length,
  };
}

export const WEBUI_MAX_ATTACHMENT_COUNT = 10;
// Attachments travel as data URLs over the local WebSocket. Keep the decoded
// aggregate below its 100 MiB frame limit after base64 expansion.
export const WEBUI_MAX_ATTACHMENT_TOTAL_BYTES = 70 * 1024 * 1024;

export function webuiAttachmentLimitError(
  current: readonly { readonly sizeBytes: number }[],
  incoming: readonly { readonly sizeBytes: number }[],
): string | undefined {
  if (current.length + incoming.length > WEBUI_MAX_ATTACHMENT_COUNT)
    return `最多添加 ${WEBUI_MAX_ATTACHMENT_COUNT} 个文件`;
  const total = [...current, ...incoming].reduce(
    (sum, item) => sum + item.sizeBytes,
    0,
  );
  if (total > WEBUI_MAX_ATTACHMENT_TOTAL_BYTES)
    return "附件总大小不能超过 70 MB";
  return undefined;
}
