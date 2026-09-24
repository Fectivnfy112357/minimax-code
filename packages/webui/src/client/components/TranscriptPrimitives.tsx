// Pure-presentation transcript primitives — leaves of the component tree.
//
// W3 tier 1 lift: these components were moved out of `app.tsx` in W3. The
// transcript structure and data attributes remain stable; the live thinking
// marker is intentionally shared with ActivityIndicator so streaming never
// renders a second, static animation implementation.
//
// Re-exported from `app.tsx` so existing consumers (tests, importers)
// keep their current import path during the W3 wave. `WebuiToolRow`
// stays private — it was a non-exported helper in `app.tsx`, used only
// by `WebuiToolResults`.

import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator } from "./ActivityIndicator.js";
import {
  WebuiIconChevronDown,
  WebuiIconDiffFile,
  WebuiIconDiffSummary,
} from "../icons.js";
import { WebuiMarkdown } from "../markdown.js";
import {
  isWebuiEditTool,
  toolCallInputText,
  toolCallName,
  toolCallIconCategory,
  toolCallLabel,
  toolCallResultText,
  toolCallErrorText,
  toolCallStatus,
  toolCallStatusLabel,
  toolCallResourcePath,
  webuiActivitySummary,
  webuiEditFileStat,
} from "../projection/tool-projection.js";

function WebuiToolRow({
  tool,
  index,
}: {
  readonly tool: Record<string, unknown>;
  readonly index: number;
}): ReactElement {
  const input = toolCallInputText(tool);
  const result = toolCallResultText(tool);
  const error = toolCallErrorText(tool);
  const status = toolCallStatus(tool);
  const statusLabel = status === "completed" ? undefined : toolCallStatusLabel(status);
  const resourcePath = toolCallResourcePath(tool);
  const pathSegments = resourcePath?.replaceAll("\\", "/").split("/").filter(Boolean) ?? [];
  const resourceLabel = pathSegments[pathSegments.length - 1] ?? resourcePath;
  return (
    <details
      key={`tool-call-${toolCallName(tool)}-${index}`}
      className="webui-tool-row"
      data-webui-tool-call={toolCallName(tool)}
      data-webui-tool-status={status}
    >
      <summary className="webui-tool-row-summary">
        <span className={`webui-tool-icon webui-tool-icon--${toolCallIconCategory(tool)}`} aria-hidden="true">
          <WebuiToolIcon category={toolCallIconCategory(tool)} />
        </span>
        <span className="webui-tool-label">
          {toolCallLabel(tool)}
          {statusLabel ? ` · ${statusLabel}` : ""}
        </span>
        {resourcePath ? <span className="webui-tool-resource-path" title={resourcePath}>{resourceLabel}</span> : null}
        {!resourcePath ? <WebuiIconChevronDown className="webui-tool-chevron" /> : null}
      </summary>
      {status === "running" && !input && !result && !error ? (
        <div className="webui-tool-detail" data-webui-tool-result="true">运行中…</div>
      ) : input || result || error ? (
        <div className="webui-tool-detail" data-webui-tool-result="true">
          {input !== undefined ? <WebuiToolDetailSection label="输入" value={input} /> : null}
          {result !== undefined ? <WebuiToolDetailSection label="结果" value={result} /> : null}
          {error !== undefined ? <WebuiToolDetailSection label="错误" value={error} error /> : status === "error" ? <WebuiToolDetailSection label="错误" value="执行失败" error /> : null}
        </div>
      ) : null}
    </details>
  );
}

function WebuiToolDetailSection({
  label,
  value,
  error = false,
}: {
  readonly label: string;
  readonly value: string;
  readonly error?: boolean;
}): ReactElement {
  return (
    <section className="webui-tool-detail-section">
      <div className={error ? "webui-tool-detail-label is-error" : "webui-tool-detail-label"}>{label}</div>
      <pre>{value.length > 2000 ? `${value.slice(0, 2000)}...` : value}</pre>
    </section>
  );
}

function WebuiToolIcon({ category }: { readonly category: ReturnType<typeof toolCallIconCategory> | "combine" }): ReactElement {
  const paths: Readonly<Record<typeof category, ReactElement>> = {
    command: <><path d="m3.5 4.5 4 3.5-4 3.5" /><path d="M9 12h4.5" /></>,
    file: <><path d="M4.5 2.5h5l3 3v8h-8z" /><path d="M9.5 2.5v3h3" /><path d="M6.5 8h4M6.5 10.5h4" /></>,
    code: <><path d="M4.5 2.5h5l3 3v4" /><path d="M9.5 2.5v3h3" /><path d="m7 12 4.8-4.8 1.8 1.8L8.8 13.8 6.5 14z" /></>,
    search: <><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3 3" /></>,
    web: <><circle cx="8" cy="8" r="6" /><path d="M2.5 8h11M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12" /></>,
    browser: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M2 6h12M4 4.5h.01M6 4.5h.01" /></>,
    logo: <><path d="M8 1.5 14.5 5v6L8 14.5 1.5 11V5z" /><path d="m5.5 8 1.5 1.5L10.5 6" /></>,
    memory: <><path d="M4 3.5h8v9H4z" /><path d="M6 6h4M6 8h4M6 10h2" /></>,
    image: <><rect x="2" y="2.5" width="12" height="11" rx="1.5" /><circle cx="5.5" cy="6" r="1" /><path d="m3 11 3-3 2.5 2 2-2 2.5 3" /></>,
    video: <><rect x="1.5" y="3" width="9" height="10" rx="1.5" /><path d="m10.5 6 4-2v8l-4-2z" /></>,
    music: <><path d="M9 11V3l5-1v8" /><circle cx="6.5" cy="11.5" r="2" /><circle cx="11.5" cy="9.5" r="2" /></>,
    tool: <><path d="M9.5 3a4 4 0 0 0-5.2 5.2L2.5 10l3.5 3.5 1.8-1.8A4 4 0 0 0 13 6.5l-2.5 2.2-2.2-2.2z" /></>,
    task: <><rect x="3" y="2.5" width="10" height="11" rx="1.5" /><path d="m5 6 1 1 2-2M9 6h2M5 10h6" /></>,
    bot: <><rect x="2.5" y="4" width="11" height="8.5" rx="2" /><path d="M8 1.5v2.5M5.5 7.5h.01M10.5 7.5h.01M5.5 10h5" /></>,
    goal: <><circle cx="8" cy="8" r="6" /><circle cx="8" cy="8" r="3" /><circle cx="8" cy="8" r=".5" /></>,
    thinking: <><path d="M5 11.5a4.5 4.5 0 1 1 6 0c-.8.6-1 1-1 1.5H6c0-.5-.2-.9-1-1.5z" /><path d="M6 15h4" /></>,
    combine: <><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="1" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="1" /><rect x="9" y="9" width="4.5" height="4.5" rx="1" /></>,
  };
  return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[category]}</svg>;
}

/** Tool rows remain the fallback only when the runtime diff facade is absent. */
export function WebuiToolResults({
  tools,
  authoritativeDiffAvailable = false,
}: {
  readonly tools: readonly Record<string, unknown>[];
  readonly authoritativeDiffAvailable?: boolean;
}): ReactElement | null {
  const [expanded, setExpanded] = useState(false);
  const edits = tools.filter(isWebuiEditTool);
  const others = tools.filter((tool) => !isWebuiEditTool(tool));
  const renderRows = (rows: readonly Record<string, unknown>[]) =>
    rows.map((tool, index) => (
      <WebuiToolRow
        key={`tool-call-${toolCallName(tool)}-${index}`}
        tool={tool}
        index={index}
      />
    ));
  if (edits.length === 0) {
    return (
      <div className="webui-tool-list" data-webui-tool-list="true">
        {renderRows(tools)}
      </div>
    );
  }
  if (authoritativeDiffAvailable) {
    return (
      <div className="webui-tool-list" data-webui-tool-list="true">
        {renderRows(others)}
      </div>
    );
  }
  const stats = edits.map(webuiEditFileStat);
  const totalAdded = stats.reduce((sum, stat) => sum + stat.added, 0);
  const totalDeleted = stats.reduce((sum, stat) => sum + stat.deleted, 0);
  const shown = expanded ? stats : stats.slice(0, 3);
  return (
    <div className="webui-diff-card" data-webui-diff-card="true">
      <div className="webui-diff-header">
        <div className="webui-diff-summary">
          <span className="webui-diff-icon" aria-hidden="true"><WebuiIconDiffSummary /></span>
          <span className="webui-diff-header-content">
            <span className="webui-diff-header-title" data-webui-diff-title="true">
              {`已编辑 ${edits.length} 个文件`}
            </span>
            {totalAdded > 0 || totalDeleted > 0 ? (
              <span className="webui-diff-header-stats">
                {totalAdded > 0 ? (
                  <span className="webui-diff-add">{`+${totalAdded}`}</span>
                ) : null}
                {totalDeleted > 0 ? (
                  <span className="webui-diff-del">{`-${totalDeleted}`}</span>
                ) : null}
              </span>
            ) : null}
          </span>
        </div>
      </div>
      <ul className="webui-diff-files">
        {shown.map((stat, index) => (
          <li
            className="webui-diff-file"
            key={`${stat.name ?? "file"}-${index}`}
          >
            <span className="webui-diff-file-icon" data-testid="turn-diff-file-icon"><WebuiIconDiffFile fileName={stat.name ?? undefined} /></span>
            <span className="webui-diff-file-name">{stat.name ?? "文件"}</span>
            {stat.added > 0 || stat.deleted > 0 ? (
              <span className="webui-diff-file-stats">
                {stat.added > 0 ? (
                  <span className="webui-diff-add">{`+${stat.added}`}</span>
                ) : null}
                {stat.deleted > 0 ? (
                  <span className="webui-diff-del">{`-${stat.deleted}`}</span>
                ) : null}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {stats.length > 3 ? (
        <button
          type="button"
          className="webui-diff-expand"
          data-webui-diff-expand="true"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起" : `展开其余 ${stats.length - 3} 个`}
        </button>
      ) : null}
      {others.length > 0 ? (
        <div className="webui-tool-list" data-webui-tool-list="true">
          {renderRows(others)}
        </div>
      ) : null}
    </div>
  );
}

/** Desktop activity-group: a 16px activity header and a timeline body.
 *  Desktop defaults to collapsed; the WebUI's previous `open` default is
 *  preserved only when the turn is still streaming so the user can see the
 *  running tool calls. */
export function WebuiActivityGroup({
  tools,
  authoritativeDiffAvailable = false,
  activityItems,
  initiallyExpanded = false,
}: {
  readonly tools: readonly Record<string, unknown>[];
  readonly authoritativeDiffAvailable?: boolean;
  readonly activityItems?: readonly WebuiActivityGroupItem[];
  readonly initiallyExpanded?: boolean;
}): ReactElement | null {
  if (tools.length === 0) return null;
  const active = tools.some((tool) => {
    const status = toolCallStatus(tool);
    return status === "pending" || status === "running";
  });
  const activeTool = [...tools].reverse().find((tool) => {
    const status = toolCallStatus(tool);
    return status === "pending" || status === "running";
  });
  const categories = new Set(tools.map(toolCallIconCategory));
  const summaryIcon = activeTool
    ? toolCallIconCategory(activeTool)
    : categories.size === 1
      ? toolCallIconCategory(tools[0] ?? {})
      : "combine";
  const thinkingCount = activityItems?.filter((item) => item.type === "thinking").length ?? 0;
  const summary = [
    ...(thinkingCount > 0 ? [`思考 ${thinkingCount} 次`] : []),
    webuiActivitySummary(tools),
  ].join("，");
  const detailItems: ReactElement[] = [];
  if (activityItems) {
    for (let index = 0; index < activityItems.length; index += 1) {
      const item = activityItems[index];
      if (!item) continue;
      if (item.type === "thinking") {
        detailItems.push(<WebuiThinkingBlock key={`thinking-${index}`} text={item.text} durationMs={item.durationMs} streaming={item.streaming} summaryLabel="思考" />);
        continue;
      }
      const groupedTools: Record<string, unknown>[] = [item.tool];
      while (activityItems[index + 1]?.type === "tool") {
        index += 1;
        const next = activityItems[index];
        if (next?.type === "tool") groupedTools.push(next.tool);
      }
      detailItems.push(<WebuiToolResults key={`tools-${index}`} tools={groupedTools} authoritativeDiffAvailable={authoritativeDiffAvailable} />);
    }
  }
  return (
    <details
      className="activity-group"
      data-testid="activity-group"
      data-active={active ? "true" : undefined}
      open={active || initiallyExpanded}
    >
      <summary className="activity-group-header">
        <span className="activity-group-icon" data-webui-activity-icon-category={summaryIcon} aria-hidden="true">
          <WebuiToolIcon category={summaryIcon} />
        </span>
        <span className="activity-group-summary">{summary}</span>
        <WebuiIconChevronDown className="activity-group-chevron" />
      </summary>
      <div className="activity-group-body">
        <span className="timeline-spine" aria-hidden="true" />
        <div className="activity-group-items">
          {activityItems ? detailItems : <WebuiToolResults tools={tools} authoritativeDiffAvailable={authoritativeDiffAvailable} />}
        </div>
      </div>
    </details>
  );
}

export type WebuiActivityGroupItem =
  | { readonly type: "thinking"; readonly text: string; readonly durationMs?: number; readonly streaming?: boolean }
  | { readonly type: "tool"; readonly tool: Record<string, unknown> };

export function WebuiTurnProcess({
  active,
  startedAtMs,
  endedAtMs,
  tokenCount,
  requestDurationMs,
  wallClockDurationMs,
  children,
  collapsedContent,
  hasExpandableContent = true,
  forceExpanded = false,
  disabled = false,
  initiallyExpanded = true,
}: {
  readonly active: boolean;
  readonly startedAtMs?: number;
  readonly endedAtMs?: number;
  /** Approximate token count streamed during the turn. Used to derive the
   *  Desktop-style "output rate" (`{N} token/s`) when the turn has finished. */
  readonly tokenCount?: number;
  /** Wall-clock duration of the turn measured by the runtime
   *  (`usage.request_duration_ms`). When this is present it wins over the
   *  wall-clock fallback for finished turns. */
  readonly requestDurationMs?: number;
  /** Wall-clock duration computed from message timestamps (oldest user →
   *  newest assistant inside the turn). Used when neither the runtime nor
   *  `startedAtMs` give us a number — this is the only honest signal the
   *  runtime hands us, so render its real value rather than guess. */
  readonly wallClockDurationMs?: number;
  readonly children: ReactElement | ((expanded: boolean) => ReactElement);
  /** Content that remains visible outside the collapsible details while the
   *  process is collapsed (for example, the final assistant reply). */
  readonly collapsedContent?: (expanded: boolean) => ReactNode;
  /** Desktop only renders an outer disclosure control when this turn has
   *  content that can actually be expanded. The duration summary can remain
   *  visible without the control. */
  readonly hasExpandableContent?: boolean;
  /** Mirrors Desktop turn-process modes: these states suppress the toggle
   *  and keep available details open. */
  readonly forceExpanded?: boolean;
  readonly disabled?: boolean;
  readonly initiallyExpanded?: boolean;
}): ReactElement {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const canToggle = hasExpandableContent && !forceExpanded && !disabled;
  const contentExpanded = forceExpanded || disabled || expanded;
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!active) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
  // Priority for finished turns:
  //   1. `requestDurationMs` from the runtime usage block
  //   2. `wallClockDurationMs` from the message timestamp span
  //   3. fall back to "0 秒" so we never lie about elapsed time
  // Live turns tick from `startedAtMs` → now.
  const seconds =
    typeof startedAtMs === "number"
      ? Math.max(
          0,
          Math.floor(
            ((active
              ? Date.now()
              : typeof requestDurationMs === "number"
                ? startedAtMs + requestDurationMs
                : endedAtMs ?? Date.now()) -
              startedAtMs) /
              1000,
          ),
        )
      : typeof requestDurationMs === "number"
        ? Math.floor(requestDurationMs / 1000)
        : typeof wallClockDurationMs === "number"
          ? Math.floor(wallClockDurationMs / 1000)
          : undefined;
  // Desktop renders the wall-clock duration as "M 分 N 秒" / "N 秒".
  const durationLabel =
    typeof seconds === "number"
      ? seconds >= 60
        ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`
        : `${seconds} 秒`
      : undefined;
  const outputRateLabel =
    !active &&
    typeof seconds === "number" &&
    seconds > 0 &&
    typeof tokenCount === "number" &&
    tokenCount > 0
      ? `${Math.round(tokenCount / seconds)} token/s`
      : undefined;
  const summary = durationLabel
    ? active
      ? `已执行 ${durationLabel}`
      : `共执行 ${durationLabel}`
    : active
      ? "已执行 0 秒"
      : "共执行 0 秒";
  return (
    <section className="pt-2" data-testid="turn-process-disclosure">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2" data-testid="turn-process-summary">
        {canToggle ? (
          <button
            type="button"
            className="group/turn-process text-activity-body-small flex items-center gap-1 py-1 text-center text-sm font-normal leading-5 tracking-normal text-text_label_tertiary_default transition-colors hover:text-text_label_tertiary_hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border_accent"
            aria-expanded={contentExpanded}
            data-testid="turn-process-trigger"
            data-summary-text={summary}
            onClick={() => setExpanded((value) => !value)}
          >
            <span data-testid="turn-process-summary-text">{summary}</span>
            <span
              data-testid="turn-process-chevron"
              className={`-ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-icon_interaction_tertiary_default transition-transform duration-200 ease-out motion-reduce:transition-none group-hover/turn-process:text-icon_interaction_tertiary_hover ${contentExpanded ? "rotate-90" : ""}`}
            >
              <WebuiIconChevronDown className="size-4" />
            </span>
          </button>
        ) : (
          <span
            className="text-activity-body-small flex items-center gap-2 py-1 text-center text-sm font-normal leading-5 tracking-normal text-text_label_tertiary_default"
            data-testid="turn-process-summary-text"
            data-summary-text={summary}
          >
            {summary}
          </span>
        )}
        {!active && outputRateLabel ? (
          <span
            className="ml-auto text-text_default_tertiary text-size_12"
            data-testid="turn-output-rate"
          >
            <span className="sr-only">输出速度：</span>
            {outputRateLabel}
          </span>
        ) : null}
      </div>
      <div className="mt-2 border-b-[0.5px] border-border_default" data-testid="turn-process-separator" aria-hidden="true" />
      {hasExpandableContent ? (
        <div className="mt-3 space-y-4" data-testid="turn-process-detail" hidden={!contentExpanded}>
          {typeof children === "function" ? children(contentExpanded) : contentExpanded ? children : null}
        </div>
      ) : null}
      {collapsedContent?.(contentExpanded)}
    </section>
  );
}

export function WebuiThinkingBlock({
  text,
  durationMs,
  streaming = false,
  processingStartedAtMs,
  summaryLabel,
}: {
  readonly text: string;
  readonly durationMs?: number;
  readonly streaming?: boolean;
  readonly processingStartedAtMs?: number;
  readonly summaryLabel?: string;
}): ReactElement | null {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!streaming) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [streaming]);
  if (!text.trim()) return null;
  // Desktop `think-container`: a pulse dot + 推理中... with a live-second
  // counter while streaming, collapsing to 已完成推理 + total seconds.
  const elapsed = streaming
    ? typeof processingStartedAtMs === "number"
      ? Math.max(0, Math.floor((Date.now() - processingStartedAtMs) / 1000))
      : undefined
    : typeof durationMs === "number" && durationMs > 0
      ? Math.max(1, Math.floor(durationMs / 1000))
      : undefined;
  return (
    <details className="webui-thinking-block" data-webui-thinking-block="true" open={streaming}>
      <summary className="webui-thinking-summary" data-webui-thinking="true">
        {streaming ? (
          <ActivityIndicator aria-hidden="true" />
        ) : null}
        <span>{summaryLabel ?? (streaming ? "推理中..." : "已完成推理")}</span>
        {typeof elapsed === "number" && elapsed >= 1 ? (
          <span className="webui-thinking-elapsed">{elapsed}s</span>
        ) : null}
        <WebuiIconChevronDown className="webui-thinking-chevron" />
      </summary>
      <div className="webui-thinking-detail">
        <WebuiMarkdown source={text} />
      </div>
    </details>
  );
}

/** Desktop `turn_process` row: 已执行 N 秒, ticking once per second. */
export function TurnElapsedRow({
  startedAtMs,
  running,
}: {
  readonly startedAtMs: number;
  readonly running: boolean;
}): ReactElement | null {
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => forceTick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  const seconds = Math.floor((Date.now() - startedAtMs) / 1000);
  if (seconds < 1) return null;
  return (
    <p className="webui-turn-elapsed" data-webui-turn-elapsed="true">
      {running ? `已执行 ${seconds} 秒` : `共执行 ${seconds} 秒`}
    </p>
  );
}
