// Tool call projection — derive the user-facing labels and stats from the
// raw tool-call records the wire hands the client.
//
// The wire shape is loose: the runtime uses both camelCase and snake_case
// keys, and either `result` / `output` / `error` may carry the rendered
// output. These readers normalise the variety so the React layer can just
// render what it gets. The view-model stat (`webuiActivitySummary`) decides
// what header to draw for the activity group.

/** Best-effort extraction of the rendered tool result. Accepts the runtime's
 *  multiple key spellings and JSON-serialises object payloads so the panel
 *  always has something to show. */
export function toolCallResultText(
  tool: Record<string, unknown>,
): string | undefined {
  const value =
    tool.tool_call_result_data ??
    tool.toolCallResultData ??
    tool.result ??
    tool.output ??
    tool.error;
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return undefined;
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

/** Normalised tool name — accepts both camelCase and snake_case spellings
 *  and falls back to `"tool"` so the renderer never has to special-case a
 *  missing name. */
export function toolCallName(tool: Record<string, unknown>): string {
  const value =
    tool.tool_call_name ??
    tool.toolCallName ??
    tool.tool_name ??
    tool.toolName ??
    tool.name;
  return typeof value === "string" && value.trim() ? value.trim() : "tool";
}

/** User-facing label for the tool row. Maps the common English tool names
 *  to the Chinese copy Desktop uses; for anything else it falls back to a
 *  normalised display of the raw name. */
export function toolCallLabel(tool: Record<string, unknown>): string {
  const name = toolCallName(tool);
  const normalized = name.toLowerCase();
  const labels: Readonly<Record<string, string>> = {
    bash: "执行命令",
    shell: "执行命令",
    execute: "执行命令",
    execute_command: "执行命令",
    read: "读取文件",
    read_file: "读取文件",
    write: "写入文件",
    write_file: "写入文件",
    edit: "编辑文件",
    edit_file: "编辑文件",
    str_replace: "编辑文件",
    grep: "搜索文件",
    find: "查找文件",
    ls: "列出文件",
    web: "访问网页",
    web_search: "搜索网页",
    webfetch: "访问网页",
    web_fetch: "访问网页",
    task: "调用子代理",
  };
  return labels[normalized] ?? name.replace(/[_-]+/gu, " ");
}

/** Pretty-printed JSON of the tool input arguments, or the raw string when
 *  the input was passed as a string. */
export function toolCallInputText(
  tool: Record<string, unknown>,
): string | undefined {
  const value =
    tool.tool_call_args ??
    tool.toolCallArgs ??
    tool.tool_call_args_json ??
    tool.toolCallArgsJson ??
    tool.input ??
    tool.args;
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return undefined;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

const WEBUI_EDIT_TOOL_LABELS: ReadonlySet<string> = new Set([
  "写入文件",
  "编辑文件",
]);

/** True when the tool is one of the file-mutating edit/write tools. Used to
 *  decide whether the renderer should show the desktop-style diff stat
 *  card or the simple tool-row fallback. */
export function isWebuiEditTool(tool: Record<string, unknown>): boolean {
  return WEBUI_EDIT_TOOL_LABELS.has(toolCallLabel(tool));
}

/** Best-effort file name + `+N/-N` stat for an edit tool, derived from the
 *  tool input and result. Used to populate the fallback diff card when the
 *  authoritative diff facade is unavailable. */
export function webuiEditFileStat(tool: Record<string, unknown>): {
  readonly name?: string;
  readonly added: number;
  readonly deleted: number;
} {
  const input = toolCallInputText(tool) ?? "";
  const result = toolCallResultText(tool) ?? "";
  let path: unknown;
  try {
    const parsed: unknown = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      const record = parsed as Record<string, unknown>;
      path = record.file_path ?? record.filePath ?? record.path ?? record.file;
    }
  } catch {
    if (/^[\w./~-]+\.[\w]+$/u.test(input.trim())) path = input.trim();
  }
  const name =
    typeof path === "string" && path.trim()
      ? (path.split(/[\\/]/u).pop() ?? path.trim())
      : undefined;
  let added = 0;
  let deleted = 0;
  for (const line of result.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) deleted += 1;
  }
  return { ...(name ? { name } : {}), added, deleted };
}

/** Summary label for the activity-group header. Picks one of the
 *  Chinese-phrased headers based on what every tool in the group is
 *  doing, so e.g. three `bash` calls render as "执行 3 条命令". */
export function webuiActivitySummary(
  tools: readonly Record<string, unknown>[],
): string {
  const labels = tools.map(toolCallLabel);
  if (labels.every((label) => label === "执行命令")) return `执行 ${tools.length} 条命令`;
  if (labels.every((label) => label === "读取文件")) return `查看 ${tools.length} 个文件`;
  if (labels.every((label) => label === "编辑文件" || label === "写入文件"))
    return `编辑 ${tools.length} 个文件`;
  return `执行 ${tools.length} 个操作`;
}