// Pure-presentation transcript primitives — leaves of the component tree.
//
// W3 tier 1 lift: these 6 components were moved verbatim out of `app.tsx`
// in W3. The body of every component is byte-identical to what used to
// live there. **Do not** re-shape the JSX, the class names, the data
// attributes, the hook order, or the conditional-rendering structure;
// each of those is load-bearing for the SSR snapshots and the runtime
// render. See `report-w3-tier1.md` for the move evidence.
//
// Re-exported from `app.tsx` so existing consumers (tests, importers)
// keep their current import path during the W3 wave. `WebuiToolRow`
// stays private — it was a non-exported helper in `app.tsx`, used only
// by `WebuiToolResults`.

import { useEffect, useState, type ReactElement } from "react";
import {
  WebuiIconActivity,
  WebuiIconChevronDown,
  WebuiIconFile,
} from "../icons.js";
import { WebuiMarkdown } from "../markdown.js";
import {
  isWebuiEditTool,
  toolCallInputText,
  toolCallName,
  toolCallLabel,
  toolCallResultText,
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
  const detail = result ?? input;
  const status = tool.status ?? tool.tool_call_status ?? tool.toolCallStatus;
  const statusLabel =
    typeof status === "string" && status.trim() ? ` · ${status}` : "";
  return (
    <details
      key={`tool-call-${toolCallName(tool)}-${index}`}
      className="webui-tool-row"
      data-webui-tool-call={toolCallName(tool)}
    >
      <summary className="webui-tool-row-summary">
        <span className="webui-tool-icon" aria-hidden="true">
          ↳
        </span>
        <span className="webui-tool-label">
          {toolCallLabel(tool)}
          {statusLabel}
        </span>
        <WebuiIconChevronDown className="webui-tool-chevron" />
      </summary>
      {detail ? (
        <div className="webui-tool-detail" data-webui-tool-result="true">
          <pre>{detail}</pre>
        </div>
      ) : null}
    </details>
  );
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
      </div>
      <ul className="webui-diff-files">
        {shown.map((stat, index) => (
          <li
            className="webui-diff-file"
            key={`${stat.name ?? "file"}-${index}`}
          >
            <WebuiIconFile className="webui-diff-file-icon" />
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
  streaming = false,
}: {
  readonly tools: readonly Record<string, unknown>[];
  readonly authoritativeDiffAvailable?: boolean;
  readonly streaming?: boolean;
}): ReactElement | null {
  if (tools.length === 0) return null;
  return (
    <details
      className="activity-group"
      data-testid="activity-group"
      data-streaming={streaming ? "true" : undefined}
      open={streaming}
    >
      <summary className="activity-group-header">
        <WebuiIconActivity className="activity-group-icon" />
        <span className="activity-group-summary">{webuiActivitySummary(tools)}</span>
        <WebuiIconChevronDown className="activity-group-chevron" />
      </summary>
      <div className="activity-group-body">
        <span className="timeline-spine" aria-hidden="true" />
        <div className="activity-group-items">
          <WebuiToolResults tools={tools} authoritativeDiffAvailable={authoritativeDiffAvailable} />
        </div>
      </div>
    </details>
  );
}

export function WebuiTurnProcess({
  active,
  startedAtMs,
  endedAtMs,
  tokenCount,
  requestDurationMs,
  wallClockDurationMs,
  children,
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
  readonly children: ReactElement;
}): ReactElement {
  const [expanded, setExpanded] = useState(active);
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
      : outputRateLabel
        ? `共执行 ${durationLabel} · ${outputRateLabel}`
        : `共执行 ${durationLabel}`
    : active
      ? "已执行 0 秒"
      : "共执行 0 秒";
  return (
    <section className="pt-2" data-testid="turn-process-disclosure">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2" data-testid="turn-process-summary">
        <button
          type="button"
          className="group/turn-process text-activity-body-small flex items-center gap-1 py-1 text-center text-sm font-normal leading-5 tracking-normal text-text_label_tertiary_default transition-colors hover:text-text_label_tertiary_hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border_accent"
          aria-expanded={expanded}
          data-testid="turn-process-trigger"
          data-summary-text={summary}
          onClick={() => setExpanded((value) => !value)}
        >
          <span data-testid="turn-process-summary-text">{summary}</span>
          <span
            data-testid="turn-process-chevron"
            className={`-ml-1 inline-flex h-4 w-4 shrink-0 items-center justify-center text-icon_interaction_tertiary_default transition-transform duration-200 ease-out motion-reduce:transition-none group-hover/turn-process:text-icon_interaction_tertiary_hover ${expanded ? "rotate-90" : ""}`}
          >
            <WebuiIconChevronDown className="size-4" />
          </span>
        </button>
        {!active && outputRateLabel ? (
          <span
            className="text-text_default_tertiary text-size_12"
            data-testid="turn-output-rate"
          >
            {`输出速度 : ${outputRateLabel}`}
          </span>
        ) : null}
      </div>
      <div className="mt-2 border-b-[0.5px] border-border_default" data-testid="turn-process-separator" aria-hidden="true" />
      {expanded ? (
        <div className="mt-3 space-y-4" data-testid="turn-process-detail">
          {children}
        </div>
      ) : null}
    </section>
  );
}

export function WebuiThinkingBlock({
  text,
  durationMs,
  streaming = false,
  processingStartedAtMs,
}: {
  readonly text: string;
  readonly durationMs?: number;
  readonly streaming?: boolean;
  readonly processingStartedAtMs?: number;
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
    <details className="webui-thinking-block" data-webui-thinking-block="true">
      <summary className="webui-thinking-summary" data-webui-thinking="true">
        {streaming ? (
          <span className="webui-thinking-indicator is-active" aria-hidden="true" />
        ) : null}
        <span>{streaming ? "推理中..." : "已完成推理"}</span>
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