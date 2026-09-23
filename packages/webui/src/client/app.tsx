// Shell and conversation surface for the WebUI client.
//
// The anatomy, the values and the icon set are read out of the desktop application's
// front-end as it renders; the extraction is recorded in
// `minimax-code-webui-work/webui-visual-align-spec.md` and
// `minimax-code-webui-work/webui-visual-align-icons.md`, and the reasoning is
// docs/webui-visual-language.md with ADR 0009.
//
// Two kinds of copy live on this screen and they do not mix:
//   * Shell chrome reproduced from the desktop (rail rows, section header, headline,
//     composer hint, identity row) carries the desktop's own wording, because the
//     element is a replica of the desktop's element.
//   * Surfaces that exist only in the WebUI (the transcript, stream refusals) keep this
//     client's existing English copy. Changing the product's
//     interface language is not a styling decision.
//
// Elements marked `data-webui-placeholder-chrome` reproduce the desktop's shape with the
// desktop's label while the WebUI has no feature behind them yet. They are inert and
// carry `aria-disabled`, so the screen reads correctly without presenting a control that
// claims to do something it cannot.

import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { WebuiMarkdown } from "./markdown.js";
import {
  WebuiIconAttach,
  WebuiIconBell,
  WebuiIconBrand,
  WebuiIconChevronDown,
  WebuiIconFolder,
  WebuiIconNewTask,
  WebuiIconPlugins,
  WebuiIconRemote,
  WebuiIconSchedule,
  WebuiIconSearch,
  WebuiIconSidebarToggle,
  WebuiIconFile,
  WebuiIconSend,
  WebuiIconSites,
} from "./icons.js";
import { ArchonShell } from "./components/ArchonShell.js";
import { Composer } from "./components/Composer.js";
import {
  WebuiModelPicker,
  type WebuiModelPickerDraft,
} from "./components/ModelPicker.js";
import {
  isTeamModeLocked,
  readTeamModeOff,
  readTeamModeSessionChoices,
  teamModeCopy,
  writeTeamModeOff,
  writeTeamModeSessionChoice,
  type TeamModeSessionChoices,
} from "./team-mode.js";
import { readNoProjectFlag, writeNoProjectFlag } from "./no-project.js";
import { LeftRail } from "./components/LeftRail.js";
import { UserMenu } from "./components/UserMenu.js";
import { WebuiWorkspacePanel, WebuiWorkspaceOverview, WebuiWorkspacePanelControls, type WebuiTodo } from "./components/WorkspacePanels.js";
import { Transcript } from "./components/Transcript.js";
import { initialWebuiStreamState, type WebuiStreamState } from "./stream.js";
import {
  buildWebuiStreamLoopSink,
  runWebuiStreamLoop,
  type WebuiStreamLoopDeps,
  type WebuiStreamLoopSink,
} from "./stream-loop.js";
import type {
  WebuiInteractionReplyResult,
  WebuiPendingPermission,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireRequest,
  WebuiQueueItem,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiModelEntry,
  WebuiRuntimeEvent,
  WebuiStreamFrame,
  WebuiVersionInfo,
} from "../server/port.js";
import {
  initialWebuiWorkspaceProgress,
  projectWebuiWorkspaceHistory,
  reduceWebuiWorkspaceProgressEvent,
  webuiWorkspaceSubagentStatus,
  type WebuiWorkspaceProgressState,
  type WebuiWorkspaceSubagent,
} from "./workspace-progress.js";

export interface WebuiClientMessage {
  readonly msgId: string;
  readonly msgContent?: string;
  readonly role?: string;
  readonly thinkingContent?: string;
  readonly thinkingDurationMs?: number;
  readonly toolCalls?: readonly Record<string, unknown>[];
}

export interface WebuiClientSession {
  readonly sessionId: string;
  readonly agentName: string;
  readonly title?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly workspaceDir?: string;
  readonly isDefaultWorkspace?: boolean;
  readonly sessionKind?: string;
  readonly parentSessionId?: string;
  readonly status?: unknown;
}

export interface WebuiClientSessionPage {
  readonly sessions: readonly WebuiClientSession[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export interface WebuiClientSessionTreeNode {
  readonly session: WebuiClientSession;
  readonly childSessions: readonly WebuiClientSession[];
}

export interface WebuiClientSessionTreePage {
  readonly sessions: readonly WebuiClientSessionTreeNode[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export type WebuiClientSessionTreeLoader = (
  cursor?: string,
) => Promise<WebuiClientSessionTreePage>;

export type WebuiClientSessionLoader = (
  cursor?: string,
) => Promise<WebuiClientSessionPage>;

export interface WebuiClientMessagePage {
  readonly messages?: readonly WebuiClientMessage[];
  readonly nextCursor?: string;
  readonly hasMore?: boolean;
}

export type WebuiClientMessageLoader = (request: {
  readonly id: string;
  readonly before?: string;
}) => Promise<WebuiClientMessagePage>;

export interface WebuiClientCreateSessionRequest {
  readonly name: string;
  /** Optional: absent means "use the default workspace" (harness resolves it). */
  readonly workspaceDir?: string;
  readonly teamModeOff?: boolean;
}
export interface WebuiClientCreateSessionResult {
  readonly sessionId?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly workspaceDir?: string;
  };
}
export type WebuiClientSessionCreator = (
  request: WebuiClientCreateSessionRequest,
) => Promise<WebuiClientCreateSessionResult>;
export type WebuiClientMessageSender = (
  request: { readonly id: string; readonly content: string },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export type WebuiClientMessageEnqueuer = (
  request: WebuiEnqueueMessageRequest,
) => Promise<WebuiEnqueueMessageResult>;

export type WebuiClientSessionResumer = (
  request: {
    readonly id: string;
    readonly afterCursor?: string;
    readonly afterMsgId?: string;
    readonly drainQueued?: boolean;
  },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export type WebuiClientEventWatcher = (
  onEvent: (event: WebuiRuntimeEvent) => void,
  onReconnect?: () => void,
) => () => void;

/**
 * A provider/model pair is not always a unique picker identity: one catalog
 * entry can expose multiple variants. Keep the variant in the native select
 * value so the lookup that follows a change selects the same catalog entry
 * that the user actually chose.
 */
export function webuiModelOptionValue(model: WebuiModelEntry): string {
  return `${model.providerId}/${model.modelId}/${model.variant ?? ""}`;
}

export interface WebuiModelSelectionRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly variant?: string;
  readonly contextLimit?: number;
  readonly sessionId?: string;
}

export function buildWebuiModelSelectionRequest(
  model: WebuiModelEntry,
  draft: WebuiModelPickerDraft,
  sessionId?: string,
): WebuiModelSelectionRequest {
  const variant = draft.variant !== undefined ? draft.variant : model.variant;
  const inheritedContextLimit =
    typeof model.contextLimit === "number" ? model.contextLimit : undefined;
  const contextLimit =
    draft.contextLimit !== undefined
      ? draft.contextLimit
      : inheritedContextLimit;
  return {
    providerId: model.providerId,
    modelId: model.modelId,
    // The empty string is meaningful: it explicitly disables thinking.
    ...(variant !== undefined ? { variant } : {}),
    ...(contextLimit !== undefined ? { contextLimit } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function readSessionIdFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const id = params.get("session");
  return id?.trim() || undefined;
}

export function sessionHash(sessionId: string): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  return `#${params.toString()}`;
}

export type WebuiTranscriptItem =
  | {
      readonly kind: "user" | "assistant" | "thinking";
      readonly text: string;
      readonly messageId: string;
      readonly durationMs?: number;
    }
  | {
      readonly kind: "tool";
      readonly messageId: string;
      readonly tools: readonly Record<string, unknown>[];
    };

export function projectWebuiMessage(
  message: WebuiClientMessage,
): WebuiTranscriptItem[] {
  const items: WebuiTranscriptItem[] = [];
  if (message.thinkingContent)
    items.push({
      kind: "thinking",
      text: message.thinkingContent,
      messageId: message.msgId,
      ...(typeof message.thinkingDurationMs === "number"
        ? { durationMs: message.thinkingDurationMs }
        : {}),
    });
  if (message.toolCalls?.length)
    items.push({
      kind: "tool",
      tools: message.toolCalls,
      messageId: message.msgId,
    });
  if (message.msgContent)
    items.push({
      kind: message.role === "user" ? "user" : "assistant",
      text: message.msgContent,
      messageId: message.msgId,
    });
  return items;
}

function toolCallResultText(tool: Record<string, unknown>): string | undefined {
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

function toolCallName(tool: Record<string, unknown>): string {
  const value =
    tool.tool_call_name ??
    tool.toolCallName ??
    tool.tool_name ??
    tool.toolName ??
    tool.name;
  return typeof value === "string" && value.trim() ? value.trim() : "tool";
}

function toolCallLabel(tool: Record<string, unknown>): string {
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

function toolCallInputText(tool: Record<string, unknown>): string | undefined {
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

function isWebuiEditTool(tool: Record<string, unknown>): boolean {
  return WEBUI_EDIT_TOOL_LABELS.has(toolCallLabel(tool));
}

/** Best-effort file name + +N/-N stat for an edit tool (desktop diff card). */
function webuiEditFileStat(tool: Record<string, unknown>): {
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

/** Desktop's `已编辑 N 个文件` card: file rows with +N/-N stats, a collapse
 * control, then the remaining tool steps in the same card. */
export function WebuiToolResults({
  tools,
}: {
  readonly tools: readonly Record<string, unknown>[];
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

function WebuiAssistantBody({
  messageId,
  thinking,
  thinkingDurationMs,
  processingStartedAtMs,
  tools,
  answers,
  streaming = false,
}: {
  readonly messageId: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers: readonly string[];
  readonly streaming?: boolean;
}): ReactElement {
  return (
    <div
      className="webui-assistant-body"
      data-webui-assistant-body={messageId}
    >
      {thinking ? (
        <WebuiThinkingBlock
          text={thinking}
          durationMs={thinkingDurationMs}
          streaming={streaming}
          processingStartedAtMs={processingStartedAtMs}
        />
      ) : null}
      {tools?.length ? <WebuiToolResults tools={tools} /> : null}
      {answers.map((answer, index) => (
        <div
          key={`${messageId}-answer-${index}`}
          className="webui-assistant-answer"
          data-webui-message-kind="assistant"
        >
          <WebuiMarkdown source={answer} />
        </div>
      ))}
    </div>
  );
}

export interface WebuiClientFoundationAppProps {
  readonly label: string;
  readonly version?: WebuiVersionInfo;
  readonly getVersion?: () => Promise<WebuiVersionInfo>;
  readonly listArchivedSessions?: () => Promise<WebuiClientSessionPage>;
  readonly sessionPage?: WebuiClientSessionPage;
  readonly loadSessions?: WebuiClientSessionLoader;
  readonly loadSessionTree?: WebuiClientSessionTreeLoader;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly listWorkspaceFileTree?: (request: { readonly workspaceDir: string; readonly path?: string }) => Promise<readonly import("../server/port.js").WebuiWorkspaceFile[]>;
  readonly readWorkspaceFile?: (request: { readonly workspaceDir: string; readonly path: string }) => Promise<import("../server/port.js").WebuiWorkspaceFileContent>;
  readonly getWorkspaceEnvironment?: (request: { readonly workspaceDir: string }) => Promise<import("../server/port.js").WebuiWorkspaceEnvironment>;
  readonly mutateWorkspaceGit?: (request: import("../server/port.js").WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>;
  readonly readCanvas?: (request: { readonly sessionId: string }) => Promise<import("../server/port.js").WebuiCanvasDocument>;
  readonly applyCanvas?: (request: { readonly sessionId: string; readonly operation: Record<string, unknown> }) => Promise<unknown>;
  readonly createTerminal?: (request: { readonly workspaceDir: string }) => Promise<{ readonly terminalId: string; readonly status: string }>;
  readonly listTerminals?: () => Promise<readonly Record<string, unknown>[]>;
  readonly writeTerminal?: (request: { readonly terminalId: string; readonly data: string }) => Promise<unknown>;
  readonly disposeTerminal?: (request: { readonly terminalId: string }) => Promise<unknown>;
  readonly watchTerminal?: (request: { readonly terminalId: string }, onFrame: (frame: { terminalId: string; data: string; exited: boolean }) => void) => () => void;
  readonly locationHash?: string;
  readonly createSession?: WebuiClientSessionCreator;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly listPendingPermissions?: () => Promise<{
    readonly requests: readonly WebuiPendingPermission[];
  }>;
  readonly getPendingQuestionnaire?: (request: {
    readonly name: string;
    readonly sessionId: string;
  }) => Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  readonly replyPermission?: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: "allowOnce" | "allowAlways" | "deny";
  }) => Promise<WebuiInteractionReplyResult>;
  readonly replyQuestionnaire?: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: readonly WebuiQuestionnaireAnswer[];
  }) => Promise<WebuiInteractionReplyResult>;
  readonly dismissQuestionnaire?: (request: {
    readonly name: string;
    readonly requestId: string;
  }) => Promise<WebuiInteractionReplyResult>;
  readonly abortSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly listQueueMessages?: (request: { readonly id: string }) => Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  readonly deleteQueueItem?: (request: {
    readonly id: string;
    readonly itemId: string;
  }) => Promise<{ readonly item?: WebuiQueueItem }>;
  readonly listModels?: (request?: {
    readonly sessionId?: string;
  }) => Promise<readonly WebuiModelEntry[]>;
  readonly listSkills?: (request?: {
    readonly agentName?: string;
  }) => Promise<{
    readonly skills: readonly {
      readonly name: string;
      readonly displayName?: string;
      readonly description?: string;
    }[];
  }>;
  readonly selectModel?: (
    request: WebuiModelSelectionRequest,
  ) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: (request: {
    readonly id: string;
  }) => Promise<Record<string, unknown>>;
  readonly getUsageQuota?: (request?: {
    readonly forceRefresh?: boolean;
  }) => Promise<import("../server/port.js").WebuiUsageQuotaResult>;
  readonly getSigninPanel?: () => Promise<
    import("../server/port.js").WebuiSigninPanelView
  >;
  readonly claimSignin?: () => Promise<
    import("../server/port.js").WebuiClaimSigninView
  >;
  readonly getAccountStatus?: (request?: {
    readonly sessionId?: string;
  }) => Promise<Record<string, unknown>>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
  readonly archiveSession?: (request: { readonly id: string }) => Promise<{ readonly success?: boolean }>;
  readonly deleteSession?: (request: { readonly id: string }) => Promise<{ readonly success?: boolean }>;
  readonly listUserModelProviders?: () => Promise<readonly Record<string, unknown>[]>;
  readonly createUserModelProvider?: (request: Record<string, unknown>) => Promise<unknown>;
  readonly updateUserModelProvider?: (request: Record<string, unknown>) => Promise<unknown>;
  readonly deleteUserModelProvider?: (providerId: string) => Promise<unknown>;
  readonly testUserModelProvider?: (providerId: string) => Promise<unknown>;
  readonly testUserModel?: (request: { readonly providerId: string; readonly modelId: string }) => Promise<unknown>;
  readonly discoverUserModelsCandidate?: (request: Record<string, unknown>) => Promise<unknown>;
  readonly saveUserModelProviderCandidate?: (request: Record<string, unknown>) => Promise<unknown>;
  readonly listProviderPresets?: () => Promise<readonly Record<string, unknown>[]>;
  readonly getMiniMaxApiKeyStatus?: () => Promise<Record<string, unknown>>;
  readonly upsertMiniMaxApiKey?: (request: { readonly apiKey: string; readonly saveAndUse?: boolean }) => Promise<unknown>;
  readonly getCodexOAuthStatus?: () => Promise<Record<string, unknown>>;
  readonly dataDir?: string;
  readonly runCommand?: (request: {
    readonly command: "help" | "new" | "compact" | "status" | "usage" | "model";
    readonly input?: string;
    readonly sessionId?: string;
    readonly agentName?: string;
    readonly workspaceDir?: string;
  }) => Promise<Record<string, unknown>>;
  /**
   * What the identity row shows under the product name. The desktop puts the signed-in
   * account's plan there; the WebUI is loopback-only and has no account, so it reports
   * the scope it actually runs in. `main.tsx` passes the page's host.
   */
  readonly hostLabel?: string;
}

// Slash palette for the composer hinting model.
//
// The data layer lives in `slash-palette.ts` and mirrors the desktop's
// `app/out/_next/static/chunks/10118-*` palette exactly: built-in commands,
// the `ez`-style plugin registry, the skills resolver, the sectioning pass
// (`eR` + memory splice), the lite-mode filter, and the four-rank scoring.
// This file just wires that data into the existing submit / popover flow.
import {
  isWebuiRunnableCommand,
  rankWebuiSlashPalette,
  sectionWebuiSlashPalette,
  slashSkillSummaryToEntry,
  WEBUI_BUILTIN_COMMANDS,
  type SlashCommandEntry,
  type WebuiSlashSkillSummary,
} from "./slash-palette.js";

// WebUI's static palette: built-ins + the skills resolved from
// `resolveWebuiSlashSkills`. The resolver is awaited once at module init so
// the sectioning pass has a fallback pool (fixtures) for the moment before
// the harness `listSkills` RPC returns. The composer overrides this with the
// live registry as soon as `listSkills` resolves.
const WEBUI_SLASH_FALLBACK_SECTIONED: SlashCommandEntry[] = await (async () => {
  const { resolveWebuiSlashSkills } = await import("./slash-palette.js");
  const entries = await resolveWebuiSlashSkills();
  return sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, entries);
})();
type WebuiCommandName = SlashCommandEntry["name"];

function useSelectedSessionId(
  locationHash?: string,
): [string | undefined, (id: string | undefined) => void] {
  const read = () =>
    readSessionIdFromHash(
      locationHash ??
        (typeof window === "undefined" ? "" : window.location.hash),
    );
  const [selected, setSelected] = useState(read);
  useEffect(() => {
    if (locationHash !== undefined || typeof window === "undefined") return;
    return subscribeToSessionHash((id) => setSelected(id));
  }, [locationHash]);
  return [selected, setSelected];
}

export function subscribeToSessionHash(
  onChange: (sessionId: string | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onHashChange = () =>
    onChange(readSessionIdFromHash(window.location.hash));
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}

interface WebuiSessionRuntimeState {
  readonly stream: WebuiStreamState;
  readonly sending: boolean;
}

const HOME_SESSION_RUNTIME_KEY = "__webui-home__";

const sessionRuntimeStates = new Map<string, WebuiSessionRuntimeState>();
const sessionRuntimeListeners = new Map<
  string,
  Set<(state: WebuiSessionRuntimeState) => void>
>();

export function readSessionRuntimeState(
  sessionKey: string,
): WebuiSessionRuntimeState {
  return (
    sessionRuntimeStates.get(sessionKey) ?? {
      stream: initialWebuiStreamState,
      sending: false,
    }
  );
}

export function updateSessionRuntimeState(
  sessionKey: string,
  update: (current: WebuiSessionRuntimeState) => WebuiSessionRuntimeState,
): void {
  const next = update(readSessionRuntimeState(sessionKey));
  sessionRuntimeStates.set(sessionKey, next);
  for (const listener of sessionRuntimeListeners.get(sessionKey) ?? [])
    listener(next);
}

/**
 * Carry a session's live runtime state (stream + sending) to a new key and
 * clear the source. The first turn starts streaming before the session
 * exists — it writes to the home key — and `onSessionCreated` switches the
 * view mid-turn; migrating keeps the in-flight stream on screen and leaves
 * home clean so the next 新建任务 cannot replay the previous turn under the
 * welcome hero. Listeners are not notified on purpose: the only subscriber
 * is the view that is about to switch keys (its effect re-reads the target
 * key), and the target key has no subscriber yet.
 */
export function migrateSessionRuntimeState(
  fromKey: string,
  toKey: string,
): void {
  if (fromKey === toKey) return;
  const state = sessionRuntimeStates.get(fromKey);
  sessionRuntimeStates.delete(fromKey);
  if (state) sessionRuntimeStates.set(toKey, state);
}

function useSessionRuntimeState(sessionId: string | undefined): {
  readonly state: WebuiSessionRuntimeState;
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: (sending: boolean) => void;
} {
  const sessionKey = sessionId ?? HOME_SESSION_RUNTIME_KEY;
  const [state, setState] = useState(() => readSessionRuntimeState(sessionKey));
  // Writes follow the key that is currently on screen: the submit path
  // captures these setters before the first-session switch, so the in-flight
  // stream and the finish-time `setSending(false)` must land on the key the
  // state was migrated to, not on the abandoned home key.
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
    setState(readSessionRuntimeState(sessionKey));
    let listeners = sessionRuntimeListeners.get(sessionKey);
    if (!listeners) {
      listeners = new Set();
      sessionRuntimeListeners.set(sessionKey, listeners);
    }
    const listener = (next: WebuiSessionRuntimeState) => setState(next);
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) sessionRuntimeListeners.delete(sessionKey);
    };
  }, [sessionKey]);
  return {
    state,
    setStream: (update) =>
      updateSessionRuntimeState(sessionKeyRef.current, (current) => ({
        ...current,
        stream: update(current.stream),
      })),
    setSending: (sending) =>
      updateSessionRuntimeState(sessionKeyRef.current, (current) => ({
        ...current,
        sending,
      })),
  };
}

export function createdSessionId(
  result: WebuiClientCreateSessionResult,
): string | undefined {
  return (
    result.sessionId?.trim() || result.session?.sessionId?.trim() || undefined
  );
}

function sessionLabel(session: WebuiClientSession): string {
  return session.title?.trim() || session.agentName || session.sessionId;
}

/**
 * Open a directory picker and return the chosen directory's path string.
 *
 * Webui has no native IPC bridge like the desktop's Electron main, so it
 * has to use whatever the browser exposes:
 *   1. `<input type="file" webkitdirectory>` — supported everywhere. Chromium
 *      exposes `File.path` for the absolute path; other engines fall back to
 *      `webkitRelativePath` for the directory name only.
 *   2. `window.showDirectoryPicker()` — Chromium 86+, gives a directory handle
 *      but no path string; we use the directory name as a best-effort label.
 *
 * Resolves to `undefined` when the user cancels. Returns an empty string
 * when the picker succeeded but no path was derivable (Safari etc.) so the
 * caller can prompt for a manual path.
 */
function pickWorkspaceDirectory(): Promise<string | undefined> {
  if (typeof window === "undefined") return Promise.resolve(undefined);
  if (typeof window.showDirectoryPicker === "function") {
    return window
      .showDirectoryPicker()
      .then((handle) => {
        // Chromium returns a handle but no path. Surface the directory name so
        // the user can confirm what they picked; the runtime will resolve it.
        return handle.name || "";
      })
      .catch((error) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "name" in error &&
          (error as { name?: string }).name === "AbortError"
        ) {
          return undefined;
        }
        throw error;
      });
  }
  return new Promise<string | undefined>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.position = "fixed";
    input.style.left = "-9999px";
    // webkitdirectory is the legacy attribute; the spec uses "directory".
    input.setAttribute("webkitdirectory", "");
    input.setAttribute("directory", "");
    input.addEventListener(
      "change",
      () => {
        const file = input.files?.[0];
        document.body.removeChild(input);
        if (!file) {
          resolve(undefined);
          return;
        }
        // Chromium exposes the absolute path on `File.path`. We slice off the
        // relative portion to land on the directory the user picked.
        // Fall back to the legacy `webkitRelativePath` (just the directory
        // name) for browsers that don't expose `path`.
        const filePath = (file as File & { path?: string }).path;
        const relativePath = file.webkitRelativePath || "";
        if (filePath) {
          const dirPath = filePath.slice(
            0,
            filePath.length - relativePath.length,
          );
          resolve(dirPath.replace(/[\\/]$/, "") || filePath);
        } else if (relativePath) {
          resolve(relativePath.split("/")[0] ?? "");
        } else {
          resolve("");
        }
      },
      { once: true },
    );
    input.addEventListener(
      "cancel",
      () => {
        document.body.removeChild(input);
        resolve(undefined);
      },
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

function workspaceProjectName(workspaceDir?: string): string {
  const value = workspaceDir?.trim();
  if (!value) return "未选项目";
  const normalized = value.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || normalized;
}

export interface WebuiProjectGroup {
  readonly key: string;
  readonly name: string;
  readonly workspaceDir?: string;
  readonly latestSessionId: string;
  readonly sessionIds: readonly string[];
  readonly updatedAt: number;
}

/**
 * The desktop's home rail is project-first, even though its source data is a
 * session history. Keep the grouping deterministic so paging and a refresh do
 * not reshuffle a project while the user is looking at it.
 */
export function groupWebuiSessionsByWorkspace(
  sessions: readonly WebuiClientSession[],
): WebuiProjectGroup[] {
  const ordered = [...sessions].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const groups = new Map<string, WebuiProjectGroup>();
  for (const session of ordered) {
    const workspaceDir = session.workspaceDir?.trim() || undefined;
    const key = workspaceDir ?? "__webui_unassigned_project__";
    const current = groups.get(key);
    if (current) {
      groups.set(key, {
        ...current,
        sessionIds: [...current.sessionIds, session.sessionId],
      });
      continue;
    }
    groups.set(key, {
      key,
      name: workspaceProjectName(workspaceDir),
      ...(workspaceDir ? { workspaceDir } : {}),
      latestSessionId: session.sessionId,
      sessionIds: [session.sessionId],
      updatedAt: session.updatedAt,
    });
  }
  return [...groups.values()];
}

/**
 * Project projection for the desktop-shaped rail. The existing session list
 * remains available for history/detail surfaces; the home rail must not expose
 * that flat list where desktop exposes workspaces.
 */
export function WebuiProjectList({
  page,
  treePage,
  loading,
  onLoadMore,
  selectedSessionId,
  onProjectSelect,
  error,
}: {
  readonly page: WebuiClientSessionPage;
  readonly treePage?: WebuiClientSessionTreePage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly onProjectSelect?: (workspaceDir?: string) => void;
  readonly error?: string;
}): ReactElement {
  // Build a lookup from parent session id to its child sessions. When
  // `treePage` is provided, this lets the rail render child sessions under
  // each root — mirroring the desktop sidebar's parent/child grouping.
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, readonly WebuiClientSession[]>();
    if (!treePage) return map;
    for (const node of treePage.sessions) {
      if (node.childSessions.length > 0) {
        map.set(node.session.sessionId, node.childSessions);
      }
    }
    return map;
  }, [treePage]);
  const projects = useMemo(
    () => groupWebuiSessionsByWorkspace(page.sessions),
    [page.sessions],
  );
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const sessionsById = useMemo(
    () => new Map(page.sessions.map((session) => [session.sessionId, session])),
    [page.sessions],
  );

  useEffect(() => {
    if (!selectedSessionId) return;
    const activeProject = projects.find((project) =>
      project.sessionIds.includes(selectedSessionId),
    );
    if (!activeProject) return;
    setExpandedProjects((current) => {
      if (current.has(activeProject.key)) return current;
      return new Set(current).add(activeProject.key);
    });
  }, [projects, selectedSessionId]);

  return (
    <section data-webui-project-list="true">
      <div
        className="flex h-7 items-center px-2 text-sm font-normal leading-5 text-text_default_tertiary"
        data-webui-rail-section-header="true"
      >
        项目
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load projects: {error}
        </p>
      ) : null}
      {!error && projects.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          暂无项目
        </p>
      ) : (
        <ul className="space-y-px" data-webui-project-list-items="true">
          {projects.map((project) => {
            const expanded = expandedProjects.has(project.key);
            return (
              <li key={project.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    onProjectSelect?.(project.workspaceDir);
                    setExpandedProjects((current) => {
                      const next = new Set(current);
                      if (next.has(project.key)) next.delete(project.key);
                      else next.add(project.key);
                      return next;
                    });
                  }}
                  data-webui-project-link={project.key}
                  title={project.workspaceDir}
                  className="webui-project-card text-left text-text_default_secondary"
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">
                    {project.name}
                  </span>
                </button>
                {expanded ? (
                  <ul
                    className="webui-project-session-list"
                    data-webui-project-sessions={project.key}
                  >
                    {project.sessionIds.map((sessionId) => {
                      const session = sessionsById.get(sessionId);
                      if (!session) return null;
                      const children = childrenByParentId.get(session.sessionId) ?? [];
                      return (
                        <li key={session.sessionId}>
                          <a
                            href={sessionHash(session.sessionId)}
                            data-webui-session-link={session.sessionId}
                            data-webui-session-active={
                              session.sessionId === selectedSessionId
                                ? "true"
                                : "false"
                            }
                            className="webui-project-session-card text-text_default_primary"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {sessionLabel(session)}
                            </span>
                          </a>
                          {children.length > 0 ? (
                            <ul
                              className="webui-project-child-session-list"
                              data-webui-project-child-sessions={session.sessionId}
                            >
                              {children.map((child) => (
                                <li key={child.sessionId}>
                                  <a
                                    href={sessionHash(child.sessionId)}
                                    data-webui-session-link={child.sessionId}
                                    data-webui-session-child-of={session.sessionId}
                                    data-webui-session-active={
                                      child.sessionId === selectedSessionId
                                        ? "true"
                                        : "false"
                                    }
                                    className="webui-project-child-session-card text-text_default_primary"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {sessionLabel(child)}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

/**
 * The rail's recent-tasks block. A row is the desktop's session row: 30px tall, 8px
 * radius, `text-sm`, a 0.5px hairline in the gutter, fill only on hover — see the spec's
 * "Measured values".
 */
export function WebuiSessionList({
  page,
  loading,
  onLoadMore,
  selectedSessionId,
  error,
  teamModeChoices,
}: {
  readonly page: WebuiClientSessionPage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly error?: string;
  readonly teamModeChoices?: TeamModeSessionChoices;
}): ReactElement {
  const sessions = useMemo(
    () =>
      [...page.sessions].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    [page.sessions],
  );
  return (
    <div
      className="transition-colors group/project-list"
      data-webui-rail-sessions="true"
    >
      <div
        className="group/section flex h-[30px] items-center gap-1 pl-2 pr-0.5"
        data-webui-rail-section-header="true"
      >
        <span className="truncate text-sm font-normal leading-5 text-text_default_tertiary">
          最近任务
        </span>
        <span className="ml-auto flex-shrink-0 text-sm font-normal leading-5 text-text_default_tertiary">
          {sessions.length}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load sessions: {error}
        </p>
      ) : null}
      {!error && sessions.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          No sessions yet.
        </p>
      ) : (
        <ul className="pt-px space-y-px" data-webui-session-list="true">
          {sessions.map((session) => (
            <li key={session.sessionId} data-webui-session-card="true">
              <a
                href={sessionHash(session.sessionId)}
                data-webui-session-link={session.sessionId}
                data-webui-session-active={
                  selectedSessionId === session.sessionId ? "true" : "false"
                }
                title={session.workspaceDir ?? undefined}
                className="webui-session-card text-text_default_primary"
              >
                <span className="flex h-[31px] w-[18px] flex-shrink-0 items-center justify-center">
                  <span className="block h-[31px] w-0 border-l-[0.5px] border-border_default" />
                </span>
                <span className="w-0 flex-1 truncate text-sm">
                  {sessionLabel(session)}
                </span>
                {teamModeChoices?.[session.sessionId] === false ||
                sessions.some(
                  (child) => child.parentSessionId === session.sessionId,
                ) ? (
                  <span
                    className="webui-pill flex-shrink-0 bg-bg_interaction_primary_default text-text_default_primary text-[11px]"
                    data-webui-team-badge="true"
                    title={teamModeCopy().label}
                  >
                    Agent Team
                  </span>
                ) : null}
              </a>
              {session.workspaceDir ? (
                <div
                  data-webui-workspace-dir={session.workspaceDir}
                  className="truncate pl-[28px] pr-1 text-xs leading-4 text-text_default_tertiary"
                >
                  {session.workspaceDir}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Group a flat transcript into one block per message, so a single turn renders
 * as the desktop renders it: one block carrying its process steps and its
 * answer. Exported because it is the contract the transcript's markup depends
 * on.
 */
export function groupWebuiTranscriptItems(
  items: readonly WebuiTranscriptItem[],
): { messageId: string; items: WebuiTranscriptItem[] }[] {
  const out: { messageId: string; items: WebuiTranscriptItem[] }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    // A user line always opens its own block; everything else that follows
    // merges into the open assistant block — the server splits one reply
    // across several msg_ids (one per tool round) and desktop renders the
    // whole turn as a single disclosure, not one block per msg_id.
    const lastIsUser = last?.items[0]?.kind === "user";
    if (last && !lastIsUser && item.kind !== "user") last.items.push(item);
    else if (last && last.messageId === item.messageId) last.items.push(item);
    else out.push({ messageId: item.messageId, items: [item] });
  }
  return out;
}

export function WebuiSessionTranscript({
  sessionId,
  loadMessages,
}: {
  readonly sessionId: string;
  readonly loadMessages: WebuiClientMessageLoader;
}): ReactElement {
  const [page, setPage] = useState<WebuiClientMessagePage>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const { stream } = useSessionRuntimeState(sessionId).state;
  const streamPhase = stream.phase;
  // One live column per turn: while the turn runs the composer renders it
  // (including the in-flight user bubble), so skip loads; reload when the
  // turn lands so the transcript takes over with the full history.
  const turnLive =
    streamPhase === "streaming" ||
    streamPhase === "waiting" ||
    streamPhase === "reconnecting";
  useEffect(() => {
    if (turnLive) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void loadMessages({ id: sessionId })
      .then((nextPage) => {
        if (!cancelled) setPage(nextPage);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMessages, sessionId, streamPhase, turnLive]);
  // During a live turn the server snapshot may already contain this turn's
  // user line (first-load race) — hide it here so the composer's pending
  // bubble is the only renderer while the turn runs.
  const items = useMemo(
    () => (page.messages ?? []).flatMap(projectWebuiMessage),
    [page.messages],
  );
  // Group by message so one turn renders as one block, the way the desktop
  // does: a process disclosure carrying the thinking and the tool steps, then
  // the assistant's markdown. A user turn is its own block.
  const groups = useMemo(() => groupWebuiTranscriptItems(items), [items]);
  const loadOlder =
    page.hasMore && page.nextCursor
      ? () => {
          setLoading(true);
          void loadMessages({ id: sessionId, before: page.nextCursor })
            .then((olderPage) => {
              setPage((current) => ({
                messages: [
                  ...(olderPage.messages ?? []),
                  ...(current.messages ?? []),
                ],
                nextCursor: olderPage.nextCursor,
                hasMore: olderPage.hasMore,
              }));
            })
            .finally(() => setLoading(false));
        }
      : undefined;
  return (
    <section
      aria-label="Transcript"
      data-webui-transcript={sessionId}
      className="webui-session-transcript-scroll flex w-full flex-col"
      data-webui-session-transcript-scroll="true"
    >
      <div
        className="flex w-full flex-col gap-spacing_8"
        data-webui-message-list="true"
      >
        {error ? (
          <p
            role="alert"
            className="text-text_default_secondary text-size_14 leading-line_height_20"
          >
            Unable to load messages: {error}
          </p>
        ) : null}
        {!error && !loading && items.length === 0 ? (
          <p className="text-text_default_secondary text-size_14 leading-line_height_20">
            No messages in this session.
          </p>
        ) : null}
        {loadOlder ? (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loading}
              className="webui-button-secondary text-text_default_primary text-size_14 leading-line_height_20"
            >
              Load older
            </button>
          </div>
        ) : null}
        {groups.map((group) => {
          const userItem = group.items.find(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "user",
          );
          if (userItem)
            return (
              <div
                key={group.messageId}
                className="webui-message"
                data-webui-message-root={group.messageId}
                data-webui-message-role="user"
              >
                <div className="flex w-full justify-end">
                  <div className="flex w-full flex-col items-end gap-spacing_8">
                    <div
                      className="webui-user-bubble"
                      data-webui-user-bubble="true"
                    >
                      <div className="webui-user-text-clamp">
                        <p
                          className="webui-user-text"
                          data-webui-message-kind="user"
                          data-webui-user-text="true"
                        >
                          <span>{userItem.text}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          const thinkingItems = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "thinking",
          );
          const tools = group.items
            .filter(
              (
                item,
              ): item is Extract<WebuiTranscriptItem, { kind: "tool" }> =>
                item.kind === "tool",
            )
            .flatMap((item) => item.tools);
          const answers = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "assistant",
          );
          return (
            <div
              key={group.messageId}
              className="webui-message"
              data-webui-message-root={group.messageId}
              data-webui-message-role="assistant"
            >
              <WebuiAssistantBody
                messageId={group.messageId}
                thinking={
                  thinkingItems.length > 0
                    ? thinkingItems.map((item) => item.text).join("\n\n")
                    : undefined
                }
                thinkingDurationMs={thinkingItems[0]?.durationMs}
                tools={tools.length > 0 ? tools : undefined}
                answers={answers.map((item) => item.text)}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A rail row. `webui-nav-item` carries the shared hover and selected treatment; the fixed
 * row passes `active` so the current destination reads differently from a hover-only row.
 */
function RailRow({
  label,
  icon,
  active,
  onSelect,
  inert,
}: {
  readonly label: string;
  readonly icon?: ReactElement;
  readonly active?: boolean;
  readonly onSelect?: () => void;
  readonly inert?: boolean;
}): ReactElement {
  return (
    <div
      className="webui-nav-item group/nav flex h-8 w-full items-center rounded-lg text-sm text-text_default_primary transition-colors hover:bg-bg_interaction_tertiary_hover"
      data-webui-placeholder-chrome={inert ? "rail-nav" : undefined}
      data-webui-nav-item={label}
      data-webui-nav-active={active ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={inert}
        aria-disabled={inert ? "true" : undefined}
        tabIndex={inert ? -1 : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 pr-2.5 text-left focus:outline-none"
      >
        {icon ? (
          <span className="flex flex-shrink-0 items-center justify-center">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
          {label}
        </span>
      </button>
    </div>
  );
}

/**
 * Pure form-submit handler extracted from the React component so a test
 * can drive the production app-to-helper seam without standing up a
 * DOM. The React component in this file (`WebuiComposer`) calls this
 * helper with the same handlers it derives from `useState`; the helper
 * itself is the single source of truth for the production wiring.
 *
 * The seam that the test must cover is `buildWebuiStreamLoopSink`:
 * omitting the helper, passing a no-op state setter, or ignoring the
 * returned sink all leave the React component unable to render the
 * stream. The shell test drives this function end-to-end and asserts
 * the resulting state matches the reachable outcomes.
 */
export interface WebuiComposerSubmitArgs {
  readonly sessionId?: string;
  readonly draft: string;
  readonly sending: boolean;
  readonly deps: WebuiStreamLoopDeps;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  /** Create the first session silently when New Task has no selected session. */
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

export interface WebuiComposerSubmitHandlers {
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
  readonly setSending: (sending: boolean) => void;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly onQueued?: () => void;
}

/**
 * Assemble the React-state setters the submit handler needs into the
 * shape `submitWebuiComposerTurn` accepts. The component in this file
 * calls this once per render with the setters it derives from
 * `useState`, then hands the result to `submitWebuiComposerTurn`. The
 * helper is a single-line pass-through by design — its job is to make
 * the assembly a named unit that a test can drive, so a regression
 * that drops, swaps, or ignores a field is caught by a failing
 * assertion. The shell test
 * `webui-shell.test.ts > "buildWebuiComposerHandlers passes every
 * field through unchanged"` walks each field and asserts identity,
 * which would die if a future change confused `setStream` with
 * `setSending`.
 *
 * Note that this covers the helper itself, not the component's call
 * into it. The component's `submit = async (event) => { ... await
 * submitWebuiComposerTurn(args, buildWebuiComposerHandlers({...})) }`
 * line is verified by inspection only — no DOM environment exists,
 * and source-text assertions are not allowed in this project.
 */
export function buildWebuiComposerHandlers(args: {
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: WebuiComposerSubmitHandlers["setSending"];
  readonly onDraftChange: WebuiComposerSubmitHandlers["onDraftChange"];
  readonly onNeedsSession?: WebuiComposerSubmitHandlers["onNeedsSession"];
  readonly onSessionCreated?: WebuiComposerSubmitHandlers["onSessionCreated"];
  readonly onQueued?: WebuiComposerSubmitHandlers["onQueued"];
}): WebuiComposerSubmitHandlers {
  return {
    setStream: args.setStream,
    setSending: args.setSending,
    onDraftChange: args.onDraftChange,
    onNeedsSession: args.onNeedsSession,
    onSessionCreated: args.onSessionCreated,
    onQueued: args.onQueued,
  };
}

export async function submitWebuiComposerTurn(
  args: WebuiComposerSubmitArgs,
  handlers: WebuiComposerSubmitHandlers,
): Promise<void> {
  const message = args.draft.trim();
  if (!message || (!args.deps.sendMessage && !args.enqueueMessage)) return;
  let sessionId = args.sessionId;
  if (!sessionId) {
    // No workspace is fine: the harness falls back to the default workspace
    // (desktop's 不需要项目 / default-directory flows). Only bail when the
    // session creator itself is not wired — that used to swallow the send
    // silently whenever the folder pill was unset.
    if (!args.createSession) {
      handlers.onNeedsSession?.(args.draft);
      return;
    }
    try {
      const result = await args.createSession({
        name: "main",
        workspaceDir: args.createSessionWorkspaceDir,
        teamModeOff: args.teamModeOff,
      });
      sessionId = createdSessionId(result);
      if (!sessionId)
        throw new Error("createSession response did not include a session id");
      // Seed the live state on the current (home) key first: setSelected
      // has not flushed yet, so a later write would land on a stale key and
      // drop the turn clock. onSessionCreated then migrates this state into
      // the new session key. The user's line comes from the server's
      // replayed `msg-user-*` frame — no second renderer.
      handlers.setStream(() => ({
        ...initialWebuiStreamState,
        phase: "streaming",
        processingStartedAtMs: Date.now(),
      }));
      // Enter the session view as soon as the session exists. Waiting for
      // the stream to finish kept the welcome hero on screen while the
      // first turn rendered underneath it (the first message showed on
      // the new-task page until the reply completed).
      handlers.onSessionCreated?.(sessionId);
    } catch (error) {
      handlers.setStream((current) => ({
        ...current,
        refusal: error instanceof Error ? error.message : String(error),
      }));
      return;
    }
  }
  if (args.sending) {
    if (!args.enqueueMessage) return;
    try {
      await args.enqueueMessage({ id: sessionId, content: message });
      handlers.onDraftChange("");
      handlers.onQueued?.();
    } catch (error) {
      handlers.setStream((current) => ({
        ...current,
        refusal: error instanceof Error ? error.message : String(error),
      }));
    }
    return;
  }
  if (!args.deps.sendMessage) return;
  handlers.setSending(true);
  handlers.onDraftChange("");
  // Initialise the reducer state via the live `setStream`. The
  // production binding goes through `buildWebuiStreamLoopSink`
  // unconditionally — there is no test-only override; the seam
  // coverage comes from the helper test and the production-path
  // test that drives this function end-to-end.
  handlers.setStream((current) => ({
    ...initialWebuiStreamState,
    phase: "streaming",
    processingStartedAtMs: Date.now(),
  }));
  try {
    await runWebuiStreamLoop(
      args.deps,
      { sessionId, message },
      buildWebuiStreamLoopSink(handlers.setStream),
    );
  } finally {
    handlers.setSending(false);
  }
}

function eventSessionId(event: WebuiRuntimeEvent): string | undefined {
  const value = event.payload.sessionId ?? event.payload.session_id;
  return typeof value === "string" ? value : undefined;
}

function pendingPermissionFromEvent(
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

function questionnaireFromEvent(
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

function replacePermission(
  current: readonly WebuiPendingPermission[],
  next: WebuiPendingPermission,
): readonly WebuiPendingPermission[] {
  return [
    ...current.filter((permission) => permission.requestId !== next.requestId),
    next,
  ];
}

function optionIdsForStep(
  selections: Readonly<Record<string, readonly string[]>>,
  stepId: string,
): readonly string[] {
  return selections[stepId] ?? [];
}

/**
 * Convert the interaction panel's controlled fields into the harness answer
 * shape. Keeping this projection outside the JSX makes the important
 * `allowOther` path effect-testable without pretending a server-side render
 * exercised browser input events.
 */
export function buildWebuiQuestionnaireAnswers(
  request: WebuiQuestionnaireRequest,
  selections: Readonly<Record<string, readonly string[]>>,
  otherSelections: Readonly<Record<string, boolean>>,
  otherTexts: Readonly<Record<string, string>>,
): readonly WebuiQuestionnaireAnswer[] {
  return request.steps.map((step) => {
    const selectedOther = otherSelections[step.id] === true;
    return {
      stepId: step.id,
      selectedOptionIds: optionIdsForStep(selections, step.id),
      ...(selectedOther
        ? {
            selectedOther: true,
            otherText: otherTexts[step.id] ?? "",
          }
        : {}),
    };
  });
}

export function WebuiInteractionPanel({
  sessionId,
  permissions,
  questionnaire,
  onPermission,
  onQuestionnaire,
  onDismiss,
  interactionError,
}: {
  readonly sessionId: string;
  readonly permissions: readonly WebuiPendingPermission[];
  readonly questionnaire?: WebuiQuestionnaireRequest;
  readonly onPermission: (
    request: WebuiPendingPermission,
    decision: "allowOnce" | "allowAlways" | "deny",
  ) => Promise<void>;
  readonly onQuestionnaire: (
    request: WebuiQuestionnaireRequest,
    answers: readonly WebuiQuestionnaireAnswer[],
  ) => Promise<void>;
  readonly onDismiss: (request: WebuiQuestionnaireRequest) => Promise<void>;
  readonly interactionError?: string;
}): ReactElement {
  const [selections, setSelections] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const [otherSelections, setOtherSelections] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [otherTexts, setOtherTexts] = useState<Readonly<Record<string, string>>>(
    {},
  );
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    setSelections({});
    setOtherSelections({});
    setOtherTexts({});
  }, [questionnaire?.id]);
  const visiblePermissions = permissions.filter(
    (permission) => permission.sessionId === sessionId,
  );
  return (
    <div
      className="mt-3 flex w-full flex-col gap-3"
      data-webui-interactions={sessionId}
    >
      {visiblePermissions.map((permission) => (
        <article
          key={permission.requestId}
          className="webui-card flex flex-col gap-2 p-spacing_16"
          data-webui-permission-request={permission.requestId}
          aria-label="Permission request"
        >
          <strong>Permission required</strong>
          <span className="text-text_default_secondary text-size_14">
            {permission.toolName}: {permission.reason}
          </span>
          {permission.toolDescription ? (
            <span className="text-text_default_secondary text-size_12">
              {permission.toolDescription}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="webui-button-primary text-size_14"
              onClick={() => void onPermission(permission, "allowOnce")}
            >
              Allow once
            </button>
            {permission.allowAlwaysSupported ? (
              <button
                type="button"
                className="webui-button-secondary text-size_14"
                onClick={() => void onPermission(permission, "allowAlways")}
              >
                Always allow
              </button>
            ) : null}
            <button
              type="button"
              className="webui-button-secondary text-size_14"
              onClick={() => void onPermission(permission, "deny")}
            >
              Deny
            </button>
          </div>
        </article>
      ))}
      {questionnaire ? (
        <article
          className="webui-card flex flex-col gap-3 p-spacing_16"
          data-webui-questionnaire-request={questionnaire.id}
          aria-label={questionnaire.title ?? "Questionnaire"}
        >
          <div className="webui-questionnaire-header">
            <strong
              className="text-size_16"
              data-webui-questionnaire-title="true"
            >
              {questionnaire.title ??
                questionnaire.steps[0]?.question ??
                "Questionnaire"}
            </strong>
            <button
              type="button"
              aria-label="关闭问卷"
              data-webui-dismiss-questionnaire="true"
              className="webui-questionnaire-close"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void onDismiss(questionnaire).finally(() =>
                  setSubmitting(false),
                );
              }}
            >
              ×
            </button>
          </div>
          <p
            className="webui-questionnaire-sub"
            data-webui-questionnaire-waiting="true"
          >
            智能体需要你的回答
          </p>
          {questionnaire.steps.length > 1 ? (
            <p className="webui-questionnaire-steps-meta">
              {`共 ${questionnaire.steps.length} 步`}
            </p>
          ) : null}
          {questionnaire.steps.map((step) => {
            const selected = optionIdsForStep(selections, step.id);
            const selectedOther = otherSelections[step.id] === true;
            const multiple =
              step.selectionMode === 1 ||
              (step.selectionMode as unknown) === "multiple";
            return (
              <fieldset key={step.id} className="mb-4">
                <legend
                  className="text-size_14 font-weight_medium"
                  data-webui-questionnaire-question="true"
                >
                  {step.question}
                </legend>
                {step.description ? (
                  <span className="text-text_default_secondary text-size_12">
                    {step.description}
                  </span>
                ) : null}
                <div
                  className="webui-questionnaire-options"
                  role={multiple ? "group" : "presentation"}
                >
                {(step.options ?? []).map((option, optionIndex) => {
                  const checked = selected.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="webui-questionnaire-option"
                      data-selected={checked || undefined}
                      data-webui-questionnaire-option={option.id}
                    >
                      <input
                        type={multiple ? "checkbox" : "radio"}
                        name={`${questionnaire.id}-${step.id}`}
                        className="sr-only"
                        checked={checked}
                        onChange={() =>
                          {
                            setSelections((current) => ({
                              ...current,
                              [step.id]: multiple
                                ? checked
                                  ? selected.filter((id) => id !== option.id)
                                  : [...selected, option.id]
                                : [option.id],
                            }));
                            if (!multiple)
                              setOtherSelections((current) => ({
                                ...current,
                                [step.id]: false,
                              }));
                          }
                        }
                      />
                      <span className="webui-questionnaire-letter" aria-hidden="true">
                        {String.fromCharCode(65 + optionIndex)}
                      </span>
                      <span>
                        {option.label}
                        {option.description ? (
                          <small className="ml-1 text-text_default_secondary">
                            {option.description}
                          </small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
                </div>
                {step.allowOther ? (
                  <label
                    className="webui-questionnaire-other-row"
                    data-selected={selectedOther || undefined}
                    data-webui-questionnaire-other={step.id}
                  >
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      name={`${questionnaire.id}-${step.id}`}
                      className="sr-only"
                      checked={selectedOther}
                      onChange={() => {
                        const next = !selectedOther;
                        setOtherSelections((current) => ({
                          ...current,
                          [step.id]: next,
                        }));
                        if (next && !multiple)
                          setSelections((current) => ({
                            ...current,
                            [step.id]: [],
                          }));
                      }}
                    />
                    <span
                      className="webui-questionnaire-other-toggle"
                      aria-hidden="true"
                    >
                      +
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <input
                        type="text"
                        value={otherTexts[step.id] ?? ""}
                        placeholder={
                          selectedOther
                            ? step.otherPlaceholder || "在这里输入..."
                            : "自定义回答..."
                        }
                        aria-label={`${step.question} 自定义回答`}
                        required={step.required && selectedOther}
                        readOnly={!selectedOther}
                        onFocus={() => {
                          if (selectedOther) return;
                          setOtherSelections((current) => ({
                            ...current,
                            [step.id]: true,
                          }));
                          setSelections((current) => ({
                            ...current,
                            [step.id]: [],
                          }));
                        }}
                        onChange={(event) =>
                          setOtherTexts((current) => ({
                            ...current,
                            [step.id]: event.target.value,
                          }))
                        }
                        className="webui-questionnaire-other-input"
                      />
                    </span>
                  </label>
                ) : null}
              </fieldset>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="webui-button-primary text-size_14"
              disabled={
                submitting ||
                questionnaire.steps.some((step) => {
                  if (!step.required) return false;
                  if (otherSelections[step.id] === true)
                    return !(otherTexts[step.id] ?? "").trim();
                  return optionIdsForStep(selections, step.id).length === 0;
                })
              }
              onClick={() => {
                setSubmitting(true);
                void onQuestionnaire(
                  questionnaire,
                  buildWebuiQuestionnaireAnswers(
                    questionnaire,
                    selections,
                    otherSelections,
                    otherTexts,
                  ),
                ).finally(() => setSubmitting(false));
              }}
            >
              提交
            </button>
            <button
              type="button"
              className="webui-button-secondary text-size_14"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void onDismiss(questionnaire).finally(() =>
                  setSubmitting(false),
                );
              }}
            >
              跳过
            </button>
          </div>
        </article>
      ) : null}
      {interactionError ? (
        <p role="alert" className="text-text_default_secondary text-size_12">
          Unable to answer interaction: {interactionError}
        </p>
      ) : null}
    </div>
  );
}

function WebuiComposer({
  sessionId,
  sessionLayout = false,
  agentName,
  createSession,
  createSessionWorkspaceDir,
  availableWorkspaces,
  onWorkspaceChange,
  workspaceMenuOpen,
  setWorkspaceMenuOpen,
  runCommand,
  sendMessage,
  resumeSession,
  loadMessages,
  watchEvents,
  listPendingPermissions,
  getPendingQuestionnaire,
  replyPermission,
  replyQuestionnaire,
  dismissQuestionnaire,
  abortSession,
  listQueueMessages,
  deleteQueueItem,
  listModels,
  listSkills,
  selectModel,
  getAccountStatus,
  draft,
  onDraftChange,
  onNeedsSession,
  onSessionCreated,
  enqueueMessage,
  teamModeOff,
  onTeamModeOffChange,
  teamModeLocked,
}: {
  readonly sessionId?: string;
  readonly sessionLayout?: boolean;
  readonly agentName: string;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly availableWorkspaces: readonly WebuiProjectGroup[];
  readonly onWorkspaceChange: (workspaceDir?: string) => void;
  /** Open state for the workspace picker; owned by the parent so the
   *  parent's workspace-change handler can also close the popover. */
  readonly workspaceMenuOpen: boolean;
  readonly setWorkspaceMenuOpen: (open: boolean) => void;
  readonly runCommand?: WebuiClientFoundationAppProps["runCommand"];
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly listPendingPermissions?: WebuiClientFoundationAppProps["listPendingPermissions"];
  readonly getPendingQuestionnaire?: WebuiClientFoundationAppProps["getPendingQuestionnaire"];
  readonly replyPermission?: WebuiClientFoundationAppProps["replyPermission"];
  readonly replyQuestionnaire?: WebuiClientFoundationAppProps["replyQuestionnaire"];
  readonly dismissQuestionnaire?: WebuiClientFoundationAppProps["dismissQuestionnaire"];
  readonly abortSession?: WebuiClientFoundationAppProps["abortSession"];
  readonly listQueueMessages?: WebuiClientFoundationAppProps["listQueueMessages"];
  readonly deleteQueueItem?: WebuiClientFoundationAppProps["deleteQueueItem"];
  readonly listModels?: WebuiClientFoundationAppProps["listModels"];
  readonly listSkills?: WebuiClientFoundationAppProps["listSkills"];
  readonly selectModel?: WebuiClientFoundationAppProps["selectModel"];
  readonly getAccountStatus?: WebuiClientFoundationAppProps["getAccountStatus"];
  /** The draft lives on the shell so it survives silent first-session creation. */
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly teamModeOff: boolean;
  readonly onTeamModeOffChange: (teamModeOff: boolean) => void;
  readonly teamModeLocked: boolean;
}): ReactElement {
  const {
    state: runtimeState,
    setStream,
    setSending,
  } = useSessionRuntimeState(sessionId);
  const { stream, sending } = runtimeState;
  const [permissions, setPermissions] = useState<
    readonly WebuiPendingPermission[]
  >([]);
  const [questionnaire, setQuestionnaire] =
    useState<WebuiQuestionnaireRequest>();
  const [interactionError, setInteractionError] = useState<string>();
  const [queueItems, setQueueItems] = useState<readonly WebuiQueueItem[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [models, setModels] = useState<readonly WebuiModelEntry[]>([]);
  const [accountStatus, setAccountStatus] = useState<Record<string, unknown>>();
  const [commandOutput, setCommandOutput] = useState<string>();
  const [commandRunning, setCommandRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRegionRef = useRef<HTMLDivElement | null>(null);
  const fieldId = useId();

  useEffect(() => {
    if (!sessionId) {
      // Inspection data belongs to a session. Clear it when New Task returns to
      // home so the previous session's model/account state cannot bleed into the composer.
      setModels([]);
      setAccountStatus(undefined);
      // The live turn bleeds the same way: the module-level runtime map kept
      // the previous turn's stream under the welcome hero on every 新建任务.
      setStream(() => initialWebuiStreamState);
      setSending(false);
      return undefined;
    }
    let cancelled = false;
    const refreshPending = async () => {
      const [permissionResult, questionnaireResult] = await Promise.all([
        listPendingPermissions?.(),
        getPendingQuestionnaire?.({ name: agentName, sessionId }),
      ]);
      if (cancelled) return;
      const sessionPermissions = (permissionResult?.requests ?? []).filter(
        (permission) => permission.sessionId === sessionId,
      );
      setPermissions(sessionPermissions);
      setQuestionnaire(questionnaireResult?.request);
      if (sessionPermissions.length > 0 || questionnaireResult?.request)
        setStream((current) => ({ ...current, phase: "waiting" }));
      if (listQueueMessages) {
        const queue = await listQueueMessages({ id: sessionId });
        if (cancelled) return;
        setQueueItems(queue.items ?? []);
        setQueuePaused(queue.paused === true);
      }
    };
    void refreshPending().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    const unsubscribe = watchEvents?.(
      (event) => {
        if (eventSessionId(event) !== sessionId) return;
        setStream((current) => ({
          ...current,
          workspaceProgress: reduceWebuiWorkspaceProgressEvent(
            current.workspaceProgress,
            { type: event.type, ...event.payload },
            sessionId,
          ),
        }));
        if (event.type === "session.start") {
          setSending(true);
          setStream((current) => ({ ...current, phase: "streaming" }));
          return;
        }
        if (
          event.type === "session.finish" ||
          event.type === "session.abort" ||
          event.type === "session.error"
        ) {
          setSending(false);
          setStream((current) => ({
            ...current,
            phase: "done",
            status:
              event.type === "session.finish"
                ? "finished"
                : event.type === "session.abort"
                  ? "aborted"
                  : "error",
            ...(typeof event.payload.error === "string"
              ? { refusal: event.payload.error }
              : {}),
          }));
          return;
        }
        if (event.type === "session.queue.updated") {
          void refreshPending().catch(() => undefined);
          return;
        }
        if (event.type === "permission.ask") {
          const permission = pendingPermissionFromEvent(event);
          if (permission) {
            setPermissions((current) => replacePermission(current, permission));
            setStream((current) => ({ ...current, phase: "waiting" }));
          }
          return;
        }
        if (event.type === "permission.resolved") {
          const requestId = event.payload.requestId;
          if (typeof requestId === "string")
            setPermissions((current) =>
              current.filter(
                (permission) => permission.requestId !== requestId,
              ),
            );
          setStream((current) => ({ ...current, phase: "streaming" }));
          return;
        }
        if (event.type === "questionnaire.ask") {
          const request = questionnaireFromEvent(event);
          if (request) {
            setQuestionnaire(request);
            setStream((current) => ({ ...current, phase: "waiting" }));
          }
          return;
        }
        if (
          event.type === "questionnaire.dismiss" ||
          event.type === "questionnaire.superseded"
        ) {
          const requestId = event.payload.requestId;
          if (typeof requestId === "string")
            setQuestionnaire((current) =>
              current?.id === requestId ? undefined : current,
            );
          setStream((current) => ({ ...current, phase: "streaming" }));
        }
      },
      () => void refreshPending().catch(() => undefined),
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    agentName,
    getPendingQuestionnaire,
    listPendingPermissions,
    listQueueMessages,
    sessionId,
    watchEvents,
  ]);

  useEffect(() => {
    if (!listModels && !getAccountStatus) return undefined;
    let cancelled = false;
    const refreshInspection = async () => {
      const [nextModels, nextAccount] = await Promise.all([
        listModels?.({ sessionId }),
        getAccountStatus?.({ sessionId }),
      ]);
      if (cancelled) return;
      setModels(nextModels ?? []);
      setAccountStatus(nextAccount);
    };
    void refreshInspection().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    const timer = setInterval(() => {
      void refreshInspection().catch(() => undefined);
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [getAccountStatus, listModels, sessionId]);

  const handlePermission = async (
    permission: WebuiPendingPermission,
    decision: "allowOnce" | "allowAlways" | "deny",
  ) => {
    if (!replyPermission) return;
    setInteractionError(undefined);
    try {
      const result = await replyPermission({
        name: permission.agentName,
        requestId: permission.requestId,
        reply: decision,
      });
      if (result.success !== true)
        throw new Error("The permission request was no longer pending");
      setPermissions((current) =>
        current.filter((item) => item.requestId !== permission.requestId),
      );
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleQuestionnaire = async (
    request: WebuiQuestionnaireRequest,
    answers: readonly WebuiQuestionnaireAnswer[],
  ) => {
    if (!replyQuestionnaire) return;
    setInteractionError(undefined);
    try {
      const result = await replyQuestionnaire({
        name: request.requester?.agentName ?? agentName,
        requestId: request.id,
        schemaVersion: request.schemaVersion,
        answers,
      });
      if (result.ok !== true)
        throw new Error("The questionnaire was not accepted");
      setQuestionnaire(undefined);
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDismiss = async (request: WebuiQuestionnaireRequest) => {
    if (!dismissQuestionnaire) return;
    setInteractionError(undefined);
    try {
      const result = await dismissQuestionnaire({
        name: request.requester?.agentName ?? agentName,
        requestId: request.id,
      });
      if (result.ok !== true)
        throw new Error("The questionnaire could not be dismissed");
      setQuestionnaire(undefined);
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleStop = async () => {
    if (!sessionId || !abortSession) return;
    setInteractionError(undefined);
    try {
      const result = await abortSession({ id: sessionId });
      if (result.success === false)
        throw new Error("The running turn could not be stopped");
      setSending(false);
      setStream((current) => ({
        ...current,
        phase: "done",
        status: "aborted",
      }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDeleteQueueItem = async (item: WebuiQueueItem) => {
    if (!deleteQueueItem || !sessionId) return;
    setInteractionError(undefined);
    try {
      await deleteQueueItem({ id: sessionId, itemId: item.itemId });
      setQueueItems((current) =>
        current.filter((candidate) => candidate.itemId !== item.itemId),
      );
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleSelectModel = async (
    model: WebuiModelEntry,
    draft: WebuiModelPickerDraft,
  ) => {
    if (!selectModel) return;
    setInteractionError(undefined);
    try {
      const result = await selectModel(
        buildWebuiModelSelectionRequest(model, draft, sessionId),
      );
      if (result.success === false)
        throw new Error("The model could not be selected");
      const refreshed = await listModels?.({
        ...(sessionId ? { sessionId } : {}),
      });
      if (refreshed) setModels(refreshed);
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const selectedModel = models.find((model) => model.selected);
  const enabledModels = models.filter((model) => model.enabled !== false);
  // Use the un-trimmed draft so the popover closes the moment the user types a
  // trailing space (i.e. after choosing a command). Trimming would re-open it
  // because "/name " trims to "/name" and matches again, leaving the palette
  // pinned above the composer.
  const commandMatch = /^\/([^\s/]*)$/u.exec(draft);
  const commandQuery = commandMatch?.[1] ?? "";
  // Pull a fresh skill pool from the harness when `listSkills` is wired up.
  // The fallback (fixtures resolved at module init) keeps the popover
  // functional even if the RPC is unavailable or rejects; once the live
  // registry returns, fetched entries replace the fixtures in the sectioning
  // pass.
  const [slashSkills, setSlashSkills] = useState<readonly WebuiSlashSkillSummary[]>(
    [],
  );
  const slashSkillsLoadedRef = useRef(false);
  useEffect(() => {
    if (!listSkills) return;
    if (slashSkillsLoadedRef.current) return;
    let cancelled = false;
    slashSkillsLoadedRef.current = true;
    listSkills({ agentName })
      .then((result) => {
        if (cancelled) return;
        setSlashSkills(result.skills);
      })
      .catch(() => {
        // The popover keeps using the fixtures when the RPC rejects; nothing
        // else to do here. The fetched-set flag stays true so we don't retry
        // on every keystroke; the composer mounts once per session, not on
        // every open.
        if (cancelled) return;
        slashSkillsLoadedRef.current = false;
      });
    return () => {
      cancelled = true;
    };
  }, [listSkills, agentName]);
  const slashSectioned = slashSkills.length
    ? sectionWebuiSlashPalette(
        WEBUI_BUILTIN_COMMANDS,
        slashSkills.map(slashSkillSummaryToEntry),
      )
    : WEBUI_SLASH_FALLBACK_SECTIONED;
  const commandSuggestions = commandMatch
    ? rankWebuiSlashPalette(slashSectioned, commandQuery)
    : [];
  const [commandIndex, setCommandIndex] = useState(0);
  useEffect(() => {
    setCommandIndex((current) =>
      commandSuggestions.length === 0
        ? 0
        : Math.min(current, commandSuggestions.length - 1),
    );
  }, [commandMatch?.[1], commandSuggestions.length]);
  // Mirror the desktop's TipTap suggestion plugin behaviour: while the slash
  // popover is open, a pointerdown outside the composer region cancels the
  // slash invocation. The Escape handler above already does the same thing
  // for the keyboard. Without this, the popover stays pinned above the
  // composer until the user types a space or deletes the leading "/" by
  // hand. We keep refs to `draft` and `commandMatch` so the listener always
  // sees the latest values without re-attaching on every keystroke.
  const slashDraftRef = useRef(draft);
  const slashMatchRef = useRef<RegExpExecArray | null>(commandMatch);
  useEffect(() => {
    slashDraftRef.current = draft;
    slashMatchRef.current = commandMatch;
  });
  const slashPanelOpen = commandMatch !== null;
  // Flip the popover below the composer when there isn't enough room above
  // for the full 320px cap. The measurement runs in `useLayoutEffect` so the
  // first paint already shows the correct placement — a normal `useEffect`
  // would let the panel render above, then re-render below, producing a
  // visible "jump" the moment the user types `/`.
  const [slashPanelBelow, setSlashPanelBelow] = useState(false);
  useLayoutEffect(() => {
    if (!slashPanelOpen) {
      setSlashPanelBelow(false);
      return;
    }
    const region = composerRegionRef.current;
    if (!region) return;
    const measure = () => {
      const rect = region.getBoundingClientRect();
      // Leave headroom of `28px` (= composer top + 24px footer padding + 4px
      // breathing) so the panel never clips into the viewport top edge.
      const availableAbove = Math.max(0, rect.top - 28);
      const needsFlip = availableAbove < 280;
      setSlashPanelBelow(needsFlip);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [slashPanelOpen, slashSkills.length]);
  useEffect(() => {
    if (!slashPanelOpen) return;
    const region = composerRegionRef.current;
    if (!region) return;
    const onPointerDown = (event: PointerEvent) => {
      const match = slashMatchRef.current;
      if (!match) return;
      if (!(event.target instanceof Node)) return;
      if (region.contains(event.target)) return;
      // Same clear-and-close as Escape: drop the "/xxx" segment so the
      // regex no longer matches and the popover disappears.
      onDraftChange(slashDraftRef.current.slice(0, match.index));
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [slashPanelOpen, onDraftChange]);
  const chooseCommand = (command: WebuiCommandName) => {
    onDraftChange(`/${command} `);
    textareaRef.current?.focus();
  };
  const commandInvocation = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/u.exec(
    draft.trim(),
  );
  const credentialMessage =
    sessionId && typeof selectedModel?.status?.lastErrorMessage === "string"
      ? selectedModel.status.lastErrorMessage
      : sessionId && accountStatus && accountStatus.available === false
        ? "No usable credentials are available for the selected model."
        : undefined;
  // Typing is always available: composing a message does not need a target yet.
  // The first send creates the target session silently, using the selected project.
  const canCompose = Boolean(sendMessage);
  const canQueue = Boolean(enqueueMessage && sessionId);
  // One live column while the turn runs; `done` hands the view back to the
  // transcript (single renderer per turn — no left/right split of one turn).
  const turnLive =
    stream.phase === "streaming" ||
    stream.phase === "waiting" ||
    stream.phase === "reconnecting";
  const showStreamContent =
    turnLive ||
    stream.phase === "refused" ||
    stream.phase === "error" ||
    stream.transcriptIncomplete;
  const sendable = (canCompose || canQueue) && Boolean(draft.trim());
  // The submit handler is a single call into
  // `submitWebuiComposerTurn` with the assembled handler bundle. The
  // assembly itself is `buildWebuiComposerHandlers` — a named unit
  // the shell test drives — so a regression that drops, swaps, or
  // ignores a field inside the assembly is caught by a failing
  // assertion. The component's call site here is verified by
  // inspection: with no DOM environment, the React render path
  // cannot be exercised, and source-text assertions are not part
  // of this project's policy.
  const handlers = buildWebuiComposerHandlers({
    setStream,
    setSending,
    onDraftChange,
    onNeedsSession,
    onSessionCreated,
    onQueued: () => {
      if (!sessionId || !listQueueMessages) return;
      void listQueueMessages({ id: sessionId })
        .then((queue) => {
          setQueueItems(queue.items ?? []);
          setQueuePaused(queue.paused === true);
        })
        .catch((error: unknown) => {
          setInteractionError(
            error instanceof Error ? error.message : String(error),
          );
        });
    },
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const command = commandInvocation
      ? slashSectioned.find(
          (item) => item.name === commandInvocation[1],
        )
      : undefined;
    if (runCommand && command && isWebuiRunnableCommand(command)) {
      setCommandRunning(true);
      setInteractionError(undefined);
      try {
        const result = await runCommand({
          command: command.name,
          ...(commandInvocation?.[2]
            ? { input: commandInvocation[2].trim() }
            : {}),
          ...(sessionId ? { sessionId } : {}),
          agentName,
          ...(createSessionWorkspaceDir
            ? { workspaceDir: createSessionWorkspaceDir }
            : {}),
        });
        const output =
          typeof result.output === "string"
            ? result.output
            : JSON.stringify(result.data ?? result, null, 2);
        setCommandOutput(output);
        onDraftChange("");
      } catch (error) {
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setCommandRunning(false);
      }
      return;
    }
    await submitWebuiComposerTurn(
      {
        sessionId,
        draft,
        sending,
        deps: { sendMessage, resumeSession, loadMessages },
        enqueueMessage,
        createSession,
        createSessionWorkspaceDir,
        teamModeOff,
      },
      handlers,
    );
  };
  return (
    <section
      aria-label="Compose message"
      className={`w-full ${sessionLayout ? "webui-session-composer" : ""}`}
      data-webui-session-composer={sessionLayout ? "true" : undefined}
    >
      {sessionId ? (
        <WebuiInteractionPanel
          sessionId={sessionId}
          permissions={permissions}
          questionnaire={questionnaire}
          onPermission={handlePermission}
          onQuestionnaire={handleQuestionnaire}
          onDismiss={handleDismiss}
          interactionError={interactionError}
        />
      ) : null}
      {stream.phase === "waiting" ? (
        <p
          role="status"
          data-webui-turn-waiting="true"
          className="mt-3 text-text_default_secondary text-size_14 leading-line_height_20"
        >
          等待你的回答…
        </p>
      ) : null}
      {queuePaused && sessionId ? (
        <span
          role="status"
          className="text-text_default_secondary text-size_12"
        >
          队列已暂停
        </span>
      ) : null}
      {queueItems.length > 0 ? (
        <section
          className="mt-3 flex w-full flex-col gap-2"
          data-webui-queue="true"
        >
          <strong className="text-size_14">
            Waiting messages ({queueItems.length})
          </strong>
          {queueItems.map((item) => (
            <article
              key={item.itemId}
              className="webui-card flex items-center gap-2 p-spacing_12"
            >
              <span className="min-w-0 flex-1 truncate text-size_14">
                {item.content || item.itemId}
              </span>
              {item.status === "queued" ? (
                <button
                  type="button"
                  className="webui-button-secondary text-size_12"
                  onClick={() => void handleDeleteQueueItem(item)}
                  data-webui-remove-queue-item={item.itemId}
                >
                  Remove
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {showStreamContent ? (
        <div
          className="webui-stream-column"
          data-webui-stream-column="true"
        >
          {stream.messages
            .filter((message) => message.role === "user")
            .map((message) => (
              <div
                key={message.id}
                className="flex justify-end"
                data-webui-stream-message={message.id}
              >
                <div
                  className="webui-user-bubble"
                  data-webui-message-role="user"
                >
                  <p className="webui-user-text">{message.answer}</p>
                </div>
              </div>
            ))}
          {turnLive && typeof stream.processingStartedAtMs === "number" ? (
            <TurnElapsedRow
              startedAtMs={stream.processingStartedAtMs}
              running={sending || stream.phase === "streaming"}
            />
          ) : null}
          {stream.phase === "reconnecting" ? (
            <p
              role="status"
              data-webui-reconnecting="true"
              className="text-text_default_secondary text-size_14 leading-line_height_20"
            >
              重连中…
            </p>
          ) : null}
          {(() => {
            const assistant = stream.messages.filter(
              (message) => message.role !== "user",
            );
            if (assistant.length === 0) return null;
            const thinking = assistant
              .map((message) => message.thinking)
              .filter((value) => value.trim())
              .join("\n\n");
            const tools = assistant.flatMap(
              (message) => message.toolCalls ?? [],
            );
            const answers = assistant
              .map((message) => message.answer)
              .filter((value) => value.trim());
            // One turn, one block: the server splits a reply across several
            // `msg_id`s (one per tool round) and each carries its own
            // thinking — desktop shows a single disclosure for the whole
            // turn, so merge here instead of rendering N live bodies.
            return (
              <div
                data-webui-stream-message="merged"
                className="webui-message"
                data-webui-message-root="merged"
                data-webui-message-role="assistant"
              >
                <WebuiAssistantBody
                  messageId="stream-live"
                  thinking={thinking || undefined}
                  tools={tools.length > 0 ? tools : undefined}
                  answers={answers}
                  streaming={stream.phase === "streaming"}
                  processingStartedAtMs={stream.processingStartedAtMs}
                />
              </div>
            );
          })()}
          {stream.refusal ? (
            <p
              role="alert"
              className="text-text_default_secondary text-size_14 leading-line_height_20"
            >
              发送消息失败：{stream.refusal}
            </p>
          ) : null}
        </div>
      ) : null}
      {commandOutput ? (
        <pre
          className="mt-3 w-full whitespace-pre-wrap text-text_default_secondary text-size_12 leading-line_height_16"
          data-webui-command-output="true"
        >
          {commandOutput}
        </pre>
      ) : null}
      {stream.transcriptIncomplete ? (
        <p
          data-webui-transcript-incomplete="true"
          className="text-text_default_secondary text-size_14 leading-line_height_20"
        >
          The displayed transcript may be incomplete; the last update failed
          before all frames could be applied.
        </p>
      ) : null}

      <div
        ref={composerRegionRef}
        className={`relative ${sessionLayout ? "mt-0" : "mt-8"} w-full`}
        data-webui-composer-region="true"
      >
        <form onSubmit={submit} data-webui-composer="true" className="w-full">
          <div className="message-input-home-container flex flex-col items-center gap-1.5 rounded-[20px] bg-bg_default_scrim pb-2">
            <div className="w-full rounded-[20px] border border-border_default bg-bg_grouped_secondary_elevated p-3 webui-composer-card">
              <div className="message-input-container relative transition-colors">
                <label className="sr-only" htmlFor={`${fieldId}-content`}>
                  Message
                </label>
                <textarea
                  ref={textareaRef}
                  id={`${fieldId}-content`}
                  name="content"
                  rows={2}
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && commandMatch) {
                      // 镜像桌面端 aD 的 Escape 处理：清掉 draft 中的 "/xxx" 段
                      // 让 commandMatch 不再命中，popover 自动关闭。保留 / 之前的
                      // 文本（用户可能已经输了前缀词），等价于取消本次 slash 选择。
                      event.preventDefault();
                      onDraftChange(draft.slice(0, commandMatch.index));
                      return;
                    }
                    if (commandSuggestions.length === 0) return;
                    if (event.key === "ArrowDown") {
                      event.preventDefault();
                      setCommandIndex(
                        (current) =>
                          (current + 1) % commandSuggestions.length,
                      );
                    } else if (event.key === "ArrowUp") {
                      event.preventDefault();
                      setCommandIndex(
                        (current) =>
                          (current - 1 + commandSuggestions.length) %
                          commandSuggestions.length,
                      );
                    } else if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      const command = commandSuggestions[commandIndex];
                      if (command) chooseCommand(command.name);
                    }
                  }}
                  disabled={!canCompose && !canQueue}
                  placeholder="输入消息…（输入 / 唤起命令）"
                  className="webui-textarea webui-composer-input text-text_default_primary"
                  data-webui-composer-input="true"
                />
                {commandSuggestions.length > 0 ? (
                  <div
                    role="listbox"
                    aria-label="命令"
                    data-webui-command-menu="true"
                    data-webui-command-menu-placement={slashPanelBelow ? "below" : "above"}
                    className="webui-command-menu"
                  >
                    {commandSuggestions.map((command, index) => {
                      const Icon = command.icon;
                      const inert = !command.supported;
                      const isFirstSkill =
                        command.paletteSection === "skills" &&
                        (index === 0 ||
                          commandSuggestions[index - 1]?.paletteSection !==
                            "skills");
                      return (
                        <Fragment key={command.name}>
                          {isFirstSkill ? (
                            <div
                              role="separator"
                              data-webui-command-section="skills"
                              className="webui-command-section-header"
                            >
                              技能
                            </div>
                          ) : null}
                          <button
                            type="button"
                            role="option"
                            aria-selected={index === commandIndex}
                            aria-disabled={inert || undefined}
                            disabled={inert}
                            data-webui-command-option-inert={
                              inert ? "true" : undefined
                            }
                            className="webui-command-option"
                            onMouseDown={(event) => event.preventDefault()}
                            onMouseEnter={() => {
                              if (inert) return;
                              setCommandIndex(index);
                            }}
                            onClick={() => {
                              if (inert) return;
                              chooseCommand(command.name);
                            }}
                          >
                            <Icon className="webui-command-option-icon text-icon_default_secondary" />
                            <span className="webui-command-option-label">
                              {command.label}
                            </span>
                            <span className="webui-command-option-description text-text_default_tertiary">
                              {command.description}
                            </span>
                          </button>
                        </Fragment>
                      );
                    })}
                  </div>
                ) : null}
              </div>
              <div
                className="flex w-full items-center gap-3 px-3 pt-1"
                data-webui-composer-toolbar="true"
              >
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  tabIndex={-1}
                  aria-label="添加附件"
                  data-webui-placeholder-chrome="attach"
                  className="webui-icon-button text-icon_default_tertiary"
                >
                  <WebuiIconAttach />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <WebuiModelPicker
                    models={enabledModels}
                    selected={selectedModel}
                    onSelect={(model, draft) =>
                      void handleSelectModel(model, draft)
                    }
                  />
                  {sending ? (
                    <button
                      type="button"
                      aria-label="停止"
                      data-webui-composer-stop="true"
                      className="webui-send-button webui-send-button--stop"
                      onClick={() => void handleStop()}
                    >
                      <span className="webui-send-stop-square" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      type="submit"
                      disabled={!sendable || commandRunning}
                      aria-label="发送"
                      data-webui-composer-submit="true"
                      className="webui-send-button"
                    >
                      <WebuiIconSend />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* The workspace pills sit outside the card, as they do on the desktop. */}
        <div
          className="flex w-full items-center gap-3 px-3"
          data-webui-workspace-toolbar="true"
        >
          <div className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={workspaceMenuOpen}
              data-webui-workspace-picker="true"
              className="webui-pill max-w-[220px] min-w-0 text-text_default_primary"
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
            >
            <span className="flex size-5 shrink-0 items-center justify-center text-icon_default_primary">
              <WebuiIconFolder />
            </span>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
              {createSessionWorkspaceDir
                ? workspaceProjectName(createSessionWorkspaceDir)
                : "选择文件夹"}
            </span>
            </button>
            {workspaceMenuOpen ? (
              <div
                role="listbox"
                aria-label="工作目录"
                data-webui-workspace-menu="true"
                className="webui-workspace-menu webui-workspace-menu--desktop"
              >
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  data-webui-workspace-action="add-new"
                  className="webui-workspace-option webui-workspace-option--desktop"
                  onClick={() => {
                    setWorkspaceMenuOpen(false);
                    void pickWorkspaceDirectory().then((path) => {
                      if (path) onWorkspaceChange(path);
                    });
                  }}
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    选择新项目
                  </span>
                </button>
                <button
                  type="button"
                  role="option"
                  aria-selected={createSessionWorkspaceDir === undefined}
                  data-webui-workspace-action="no-project"
                  className="webui-workspace-option webui-workspace-option--desktop"
                  onClick={() => onWorkspaceChange(undefined)}
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left">
                    不需要项目
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {credentialMessage ? (
          <p
            role="alert"
            data-webui-credential-warning="true"
            className="mt-2 text-text_default_secondary text-size_12"
          >
            Model credentials unavailable: {credentialMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}

export function WebuiClientFoundationApp({
  label,
  sessionPage,
  loadSessions,
  loadSessionTree,
  listArchivedSessions,
  locationHash,
  loadMessages,
  createSession,
  sendMessage,
  enqueueMessage,
  resumeSession,
  watchEvents,
  listPendingPermissions,
  getPendingQuestionnaire,
  replyPermission,
  replyQuestionnaire,
  dismissQuestionnaire,
  abortSession,
  listQueueMessages,
  deleteQueueItem,
  listModels,
  listSkills,
  selectModel,
  getSessionUsage,
  getUsageQuota,
  getSigninPanel,
  claimSignin,
  getAccountStatus,
  signOut,
  version,
  getVersion,
  archiveSession,
  deleteSession,
  listUserModelProviders,
  createUserModelProvider,
  updateUserModelProvider,
  deleteUserModelProvider,
  testUserModelProvider,
  testUserModel,
  discoverUserModelsCandidate,
  saveUserModelProviderCandidate,
  listProviderPresets,
  getMiniMaxApiKeyStatus,
  upsertMiniMaxApiKey,
  getCodexOAuthStatus,
  dataDir,
  runCommand,
  hostLabel,
  listWorkspaceFileTree,
  readWorkspaceFile,
  getWorkspaceEnvironment,
  mutateWorkspaceGit,
  readCanvas,
  applyCanvas,
  createTerminal,
  listTerminals,
  writeTerminal,
  disposeTerminal,
  watchTerminal,
}: WebuiClientFoundationAppProps): ReactElement {
  const [runtimeVersion, setRuntimeVersion] = useState(version);
  useEffect(() => { if (!runtimeVersion && getVersion) void getVersion().then(setRuntimeVersion); }, [getVersion, runtimeVersion]);
  const [page, setPage] = useState<WebuiClientSessionPage>(
    sessionPage ?? { sessions: [], hasMore: false },
  );
  const [treePage, setTreePage] = useState<WebuiClientSessionTreePage>(
    () => ({ sessions: [], hasMore: false }),
  );
  const [loading, setLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] =
    useSelectedSessionId(locationHash);
  const [draft, setDraft] = useState("");
  const [teamModeOff, setTeamModeOff] = useState(readTeamModeOff);
  const [teamModeChoices, setTeamModeChoices] =
    useState<TeamModeSessionChoices>(readTeamModeSessionChoices);
  const [pageError, setPageError] = useState<string | undefined>();
  const selectedRuntimeState = useSessionRuntimeState(selectedSessionId).state;
  const [historyProgress, setHistoryProgress] =
    useState<WebuiWorkspaceProgressState>(initialWebuiWorkspaceProgress);
  // Sessions visible to lookups: roots from the flat page plus any child
  // sessions surfaced through the tree projection. Without the tree the
  // flat list is the only source, matching the original behaviour.
  const flatSessionsWithChildren = useMemo(() => {
    if (treePage.sessions.length === 0) return page.sessions;
    const seen = new Set(page.sessions.map((session) => session.sessionId));
    const extras: WebuiClientSession[] = [];
    for (const node of treePage.sessions) {
      for (const child of node.childSessions) {
        if (!seen.has(child.sessionId)) {
          seen.add(child.sessionId);
          extras.push(child);
        }
      }
    }
    return [...page.sessions, ...extras];
  }, [page.sessions, treePage.sessions]);
  const selectedAgentName =
    flatSessionsWithChildren.find((session) => session.sessionId === selectedSessionId)
      ?.agentName ?? "main";
  useEffect(() => {
    if (!selectedSessionId || !loadMessages) {
      setHistoryProgress(initialWebuiWorkspaceProgress);
      return;
    }
    let cancelled = false;
    void loadMessages({ id: selectedSessionId }).then((result) => {
      if (!cancelled)
        setHistoryProgress(
          projectWebuiWorkspaceHistory(
            (result.messages ?? []) as unknown as readonly WebuiClientMessage[],
            selectedSessionId,
          ),
        );
    }).catch(() => { if (!cancelled) setHistoryProgress(initialWebuiWorkspaceProgress); });
    return () => { cancelled = true; };
  }, [loadMessages, selectedSessionId]);
  useEffect(() => {
    writeTeamModeOff(teamModeOff);
  }, [teamModeOff]);
  useEffect(() => {
    if (!loadSessions || sessionPage) return;
    let cancelled = false;
    setLoading(true);
    void loadSessions()
      .then((nextPage) => {
        if (!cancelled) {
          setPage(nextPage);
          setPageError(undefined);
        }
      })
      .catch((reason: unknown) => {
        // Without this the rail renders "No sessions yet." for a list that never
        // loaded, which reads as "you have no sessions" rather than as a failure.
        if (!cancelled)
          setPageError(
            reason instanceof Error ? reason.message : String(reason),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSessions, sessionPage]);
  // Tree projection (root + children) for the rail. Loaded in parallel with
  // the flat session list — the flat list still drives selected-session
  // lookups so the home workspace auto-fill keeps working, but the rail
  // prefers this shape so sub-agent sessions under a root are visible.
  useEffect(() => {
    if (!loadSessionTree || sessionPage) return;
    let cancelled = false;
    void loadSessionTree()
      .then((next) => {
        if (!cancelled) setTreePage(next);
      })
      .catch(() => {
        // Tree projection is optional; ignore failures so a runtime without
        // child-session support does not break the flat-list rail.
      });
    return () => {
      cancelled = true;
    };
  }, [loadSessionTree, sessionPage]);
  const treeSubagents = useMemo<readonly WebuiWorkspaceSubagent[]>(() => {
    const node = treePage.sessions.find(
      (candidate) => candidate.session.sessionId === selectedSessionId,
    );
    return (node?.childSessions ?? []).map((child) => ({
      sessionId: child.sessionId,
      agentName: child.agentName,
      ...(child.title ? { title: child.title } : {}),
      status: webuiWorkspaceSubagentStatus(child.status),
      ...(child.createdAt ? { createdAt: child.createdAt } : {}),
      ...(child.updatedAt ? { updatedAt: child.updatedAt } : {}),
      parentSessionId: selectedSessionId,
    }));
  }, [selectedSessionId, treePage.sessions]);
  const progressTodos: readonly WebuiTodo[] =
    selectedRuntimeState.stream.workspaceProgress.hasTodoSnapshot
      ? selectedRuntimeState.stream.workspaceProgress.todos
      : historyProgress.todos;
  const progressSubagents = useMemo<readonly WebuiWorkspaceSubagent[]>(() => {
    const merged = new Map<string, WebuiWorkspaceSubagent>();
    for (const subagent of historyProgress.subagents) merged.set(subagent.sessionId, subagent);
    for (const subagent of treeSubagents) merged.set(subagent.sessionId, subagent);
    for (const subagent of selectedRuntimeState.stream.workspaceProgress.subagents)
      merged.set(subagent.sessionId, { ...merged.get(subagent.sessionId), ...subagent });
    return [...merged.values()].sort((left, right) => (left.createdAt ?? 0) - (right.createdAt ?? 0));
  }, [historyProgress.subagents, selectedRuntimeState.stream.workspaceProgress.subagents, treeSubagents]);
  const loadMore =
    loadSessions && page.hasMore
      ? () => {
          setLoading(true);
          void loadSessions(page.nextCursor)
            .then((nextPage) => {
              setPage((current) => ({
                sessions: [...current.sessions, ...nextPage.sessions],
                hasMore: nextPage.hasMore,
                nextCursor: nextPage.nextCursor,
              }));
            })
            .finally(() => setLoading(false));
        }
      : undefined;
  const homeMode = !selectedSessionId;
  const selectedSession = flatSessionsWithChildren.find(
    (session) => session.sessionId === selectedSessionId,
  );
  const [newTaskWorkspaceDir, setNewTaskWorkspaceDir] = useState<string | undefined>(
    () => {
      // Honour an explicit "no project" choice from localStorage so the
      // auto-fill below doesn't immediately pull a workspace back.
      if (readNoProjectFlag()) return undefined;
      return (
        selectedSession?.workspaceDir ??
        flatSessionsWithChildren.find((session) => session.workspaceDir)?.workspaceDir
      );
    },
  );
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  // Tracks whether the user has explicitly cleared the workspace in *this*
  // session; the effect below checks both this and the persisted flag.
  const userClearedWorkspaceRef = useRef(readNoProjectFlag());
  useEffect(() => {
    if (userClearedWorkspaceRef.current) return;
    if (selectedSession?.workspaceDir) {
      setNewTaskWorkspaceDir(selectedSession.workspaceDir);
    } else if (!newTaskWorkspaceDir) {
      const workspaceDir = flatSessionsWithChildren.find(
        (session) => session.workspaceDir,
      )?.workspaceDir;
      if (workspaceDir) setNewTaskWorkspaceDir(workspaceDir);
    }
  }, [newTaskWorkspaceDir, flatSessionsWithChildren, selectedSession?.workspaceDir]);
  // Single workspace-change entry point the composer calls. It records the
  // user's intent (cleared vs picked) so the auto-fill effect above stops
  // fighting us, and folds the no-project flag into localStorage.
  const handleWorkspaceChange = useCallback(
    (workspaceDir?: string) => {
      if (workspaceDir === undefined) {
        userClearedWorkspaceRef.current = true;
        writeNoProjectFlag(true);
      } else {
        userClearedWorkspaceRef.current = false;
        writeNoProjectFlag(false);
      }
      setNewTaskWorkspaceDir(workspaceDir);
      setWorkspaceMenuOpen(false);
    },
    [],
  );
  const handleSessionCreated = (id: string) => {
    // The first turn streams into the home key before the session exists;
    // carry it (and the sending flag) across the view switch so the reply
    // stays on screen, and leave home clean.
    migrateSessionRuntimeState(HOME_SESSION_RUNTIME_KEY, id);
    setSelectedSessionId(id);
    writeTeamModeSessionChoice(id, teamModeOff);
    setTeamModeChoices((current) => ({ ...current, [id]: teamModeOff }));
    // Refresh the project projection after the first message creates a session.
    if (loadSessions)
      void loadSessions()
        .then((nextPage) => {
          setPage(nextPage);
          setPageError(undefined);
        })
        .catch((reason: unknown) =>
          setPageError(reason instanceof Error ? reason.message : String(reason)),
        );
    if (loadSessionTree)
      void loadSessionTree()
        .then(setTreePage)
        .catch(() => undefined);
    if (typeof window !== "undefined")
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}${sessionHash(id)}`,
      );
  };
  const startNewTask = () => {
    if (selectedSession?.workspaceDir)
      setNewTaskWorkspaceDir(selectedSession.workspaceDir);
    setDraft("");
    setSelectedSessionId(undefined);
    if (typeof window !== "undefined") {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  };
  const handleWorkspaceSubagentClick = useCallback(
    (subagent: WebuiWorkspaceSubagent) => {
      setSelectedSessionId(subagent.sessionId);
      if (typeof window !== "undefined")
        window.history.replaceState(
          null,
          "",
          `${window.location.pathname}${window.location.search}${sessionHash(subagent.sessionId)}`,
        );
    },
    [],
  );
  const childSessions = selectedSessionId
    ? page.sessions.filter(
        (session) => session.parentSessionId === selectedSessionId,
      )
    : [];
  const composerTeamModeOff = selectedSessionId
    ? teamModeChoices[selectedSessionId] ?? teamModeOff
    : teamModeOff;
  const composerTeamModeLocked = selectedSession
    ? isTeamModeLocked(
        {
          id: selectedSession.sessionId,
          teamModeOff: composerTeamModeOff,
        },
        (sessionId) =>
          sessionId === selectedSession.sessionId ? childSessions : [],
      )
    : false;
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
  const [workspaceOverviewOpen, setWorkspaceOverviewOpen] = useState(true);
  const [workspaceEnvironmentCollapsed, setWorkspaceEnvironmentCollapsed] = useState(false);
  const [workspaceProgressCollapsed, setWorkspaceProgressCollapsed] = useState(false);
  const [workspaceSubagentsCollapsed, setWorkspaceSubagentsCollapsed] = useState(false);
  const [workspacePanelTab, setWorkspacePanelTab] = useState<"files" | "canvas" | "terminal">("files");
  useEffect(() => {
    // Desktop derives these sections from the selected session/workspace. Do
    // not carry a previous session's collapsed state into the next session.
    setWorkspaceEnvironmentCollapsed(false);
    setWorkspaceProgressCollapsed(false);
    setWorkspaceSubagentsCollapsed(false);
  }, [selectedSessionId]);

  return (
    <ArchonShell>
    <div data-webui-shell="two-column" className="w-full h-screen relative">
      <div className="relative flex h-screen overflow-hidden bg-bg_grouped_secondary">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[50] h-[46px]" />

        <div className="contents">
          {/* -------------------------------------------------------------- rail */}
          <div className="relative h-full min-h-0 flex-shrink-0">
            <LeftRail
              sessions={page.sessions}
              activeSessionId={selectedSessionId}
              onNew={startNewTask}
            >
            <aside
              aria-label="Primary navigation"
              data-webui-shell-region="rail"
              data-webui-rail-width={railCollapsed ? "64" : "256"}
              className={`webui-rail relative z-50 flex h-full select-none flex-col overflow-visible bg-bg_default_scrim ${railCollapsed ? "w-[64px]" : "w-[256px]"}`}
            >
              {/* The desktop keeps the rail controls above the first navigation row. */}
              <div className="flex w-full flex-shrink-0 flex-col pb-3">
                <div className="relative flex h-[38px] w-full items-center">
                  <div className="ml-auto flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      data-webui-sidebar-toggle="true"
                      aria-label={railCollapsed ? "展开导航栏" : "收起导航栏"}
                      aria-expanded={!railCollapsed}
                      onClick={() => setRailCollapsed((collapsed) => !collapsed)}
                      className="flex size-8 items-center justify-center rounded-[8px] text-text_default_tertiary hover:bg-bg_interaction_tertiary_hover"
                    >
                      <WebuiIconSidebarToggle />
                    </button>
                    <button
                      type="button"
                      data-webui-search="true"
                      data-webui-placeholder-chrome="search"
                      aria-disabled="true"
                      aria-label="搜索"
                      disabled
                      className="flex size-[30px] cursor-default items-center justify-center rounded-lg text-text_default_tertiary opacity-70"
                    >
                      <WebuiIconSearch />
                    </button>
                  </div>
                </div>
              </div>

              {!railCollapsed ? (
                <>
                  <div
                    className="flex-shrink-0 px-2 pb-px"
                    data-webui-rail-fixed-row="true"
                  >
                    <RailRow
                      label="新建任务"
                      icon={<WebuiIconNewTask className="flex-shrink-0" />}
                      active={homeMode}
                      onSelect={startNewTask}
                    />
                  </div>

                  <div className="relative min-h-0 flex-1">
                    <div className="webui-rail-scroll h-full overflow-x-hidden overflow-y-auto px-4">
                      <div className="space-y-px pb-2">
                        <RailRow label="插件" icon={<WebuiIconPlugins />} inert />
                        <RailRow label="定时" icon={<WebuiIconSchedule />} inert />
                        <RailRow label="网站" icon={<WebuiIconSites />} inert />
                        <RailRow label="远程" icon={<WebuiIconRemote />} inert />
                      </div>

                      <WebuiProjectList
                        page={page}
                        treePage={treePage.sessions.length > 0 ? treePage : undefined}
                        loading={loading}
                        onLoadMore={loadMore}
                        selectedSessionId={selectedSessionId}
                        onProjectSelect={setNewTaskWorkspaceDir}
                        error={pageError}
                      />
                    </div>
                    <div
                      className="webui-scroll-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6"
                      aria-hidden="true"
                      data-webui-scroll-fade="true"
                    />
                  </div>

                </>
              ) : null}
              <div className="relative flex-shrink-0 border-t-[0.5px] border-border_default">
                <UserMenu
                  collapsed={railCollapsed}
                  hostLabel={hostLabel}
                  dataDir={dataDir}
                  version={runtimeVersion}
                  listArchivedSessions={listArchivedSessions}
                  sessionId={selectedSessionId}
                  listModels={listModels}
                  selectModel={selectModel}
                  getSessionUsage={getSessionUsage}
                  getUsageQuota={getUsageQuota}
                  getSigninPanel={getSigninPanel}
                  claimSignin={claimSignin}
                  getAccountStatus={getAccountStatus}
                  signOut={signOut}
                  archiveSession={archiveSession}
                  deleteSession={deleteSession}
                  listUserModelProviders={listUserModelProviders}
                  createUserModelProvider={createUserModelProvider}
                  updateUserModelProvider={updateUserModelProvider}
                  deleteUserModelProvider={deleteUserModelProvider}
                  testUserModelProvider={testUserModelProvider}
                  testUserModel={testUserModel}
                  discoverUserModelsCandidate={discoverUserModelsCandidate}
                  saveUserModelProviderCandidate={saveUserModelProviderCandidate}
                  listProviderPresets={listProviderPresets}
                  getMiniMaxApiKeyStatus={getMiniMaxApiKeyStatus}
                  upsertMiniMaxApiKey={upsertMiniMaxApiKey}
                  getCodexOAuthStatus={getCodexOAuthStatus}
                />
              </div>
            </aside>
            </LeftRail>
          </div>

          <div
            className="group absolute top-0 bottom-0 z-[60] cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
          >
            <div className="webui-rail-grip absolute left-1/2 top-1/2 h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text_default_tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-50" />
          </div>

          {/* -------------------------------------------------------------- main */}
          <main
            data-webui-shell-region="surface"
            className="relative flex min-h-0 min-w-0 flex-1 flex-row"
          >
            {!homeMode ? <WebuiWorkspacePanelControls filePanelOpen={workspacePanelOpen} workspaceOpen={workspaceOverviewOpen && !workspacePanelOpen} onOpenFiles={() => { setWorkspacePanelTab("files"); setWorkspacePanelOpen((value) => !value); }} onToggleWorkspace={() => setWorkspaceOverviewOpen((value) => !value)} /> : null}
            {!homeMode && workspaceOverviewOpen && !workspacePanelOpen ? <WebuiWorkspaceOverview workspaceDir={selectedSession?.workspaceDir} isDefaultWorkspace={selectedSession?.isDefaultWorkspace} todos={progressTodos} subagents={progressSubagents} showProgress={!homeMode} showEmptyProgress={true} getWorkspaceEnvironment={getWorkspaceEnvironment} mutateWorkspaceGit={mutateWorkspaceGit} environmentCollapsed={workspaceEnvironmentCollapsed} progressCollapsed={workspaceProgressCollapsed} subagentsCollapsed={workspaceSubagentsCollapsed} onToggleEnvironment={() => setWorkspaceEnvironmentCollapsed((value) => !value)} onToggleProgress={() => setWorkspaceProgressCollapsed((value) => !value)} onToggleSubagents={() => setWorkspaceSubagentsCollapsed((value) => !value)} onMemberClick={handleWorkspaceSubagentClick} onOpenChanges={() => { setWorkspacePanelTab("files"); setWorkspacePanelOpen(true); }} onOpenTerminal={() => { setWorkspacePanelTab("terminal"); setWorkspacePanelOpen(true); }} /> : null}
            <div className="relative flex h-full min-w-0 flex-1 flex-col">
              <div
                className="pointer-events-none absolute inset-x-0 top-6 z-[60] flex justify-center"
                data-webui-busy-banner-slot="true"
              />
              <div
                className={
                  homeMode
                    ? "flex h-full w-full flex-col items-center relative overflow-y-auto pt-[240px] pb-spacing_40"
                    : "flex h-full min-h-0 w-full flex-col items-center relative overflow-hidden pt-spacing_24"
                }
                data-webui-home-content={homeMode ? "true" : "false"}
                data-webui-session-layout={!homeMode ? "true" : undefined}
              >
                <div
                  className={`flex w-full ${homeMode ? "max-w-[743px]" : "max-w-[768px]"} flex-col items-center gap-2 px-4 ${homeMode ? "" : "webui-session-layout h-full min-h-0"}`}
                >
                  {homeMode ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="group/avatar relative size-16 flex-shrink-0">
                        <div className="webui-hero-avatar relative h-full w-full overflow-visible rounded-full bg-bg_grouped_tertiary">
                          <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
                            <WebuiIconBrand className="h-full w-full" />
                          </span>
                        </div>
                      </div>
                      <h1 className="text-[28px] font-medium leading-tight text-text_default_primary">
                        MiniMax Code，让工作更简单。
                      </h1>
                    </div>
                  ) : (
                    <div className="flex w-full items-center gap-2">
                      <span className="text-text_default_secondary text-size_12 leading-line_height_16">
                        {selectedSession?.title ?? ""}
                      </span>
                    </div>
                  )}

                  <Composer>
                  <WebuiComposer
                    sessionId={selectedSessionId}
                    sessionLayout={!homeMode}
                    agentName={selectedAgentName}
                    createSession={createSession}
                    createSessionWorkspaceDir={newTaskWorkspaceDir}
                    availableWorkspaces={groupWebuiSessionsByWorkspace(page.sessions)}
                    onWorkspaceChange={handleWorkspaceChange}
                    workspaceMenuOpen={workspaceMenuOpen}
                    setWorkspaceMenuOpen={setWorkspaceMenuOpen}
                    runCommand={runCommand}
                    sendMessage={sendMessage}
                    enqueueMessage={enqueueMessage}
                    resumeSession={resumeSession}
                    loadMessages={loadMessages}
                    watchEvents={watchEvents}
                    listPendingPermissions={listPendingPermissions}
                    getPendingQuestionnaire={getPendingQuestionnaire}
                    replyPermission={replyPermission}
                    replyQuestionnaire={replyQuestionnaire}
                    dismissQuestionnaire={dismissQuestionnaire}
                    abortSession={abortSession}
                    listQueueMessages={listQueueMessages}
                    deleteQueueItem={deleteQueueItem}
                    listModels={listModels}
                    listSkills={listSkills}
                    selectModel={selectModel}
                    getAccountStatus={getAccountStatus}
                    draft={draft}
                    onDraftChange={setDraft}
                    teamModeOff={composerTeamModeOff}
                    teamModeLocked={composerTeamModeLocked}
                    onSessionCreated={handleSessionCreated}
                    onTeamModeOffChange={(nextTeamModeOff) => {
                      setTeamModeOff(nextTeamModeOff);
                      if (selectedSessionId) {
                        setTeamModeChoices((current) => ({
                          ...current,
                          [selectedSessionId]: nextTeamModeOff,
                        }));
                        writeTeamModeSessionChoice(
                          selectedSessionId,
                          nextTeamModeOff,
                        );
                      }
                    }}
                  />
                  </Composer>


                  {selectedSessionId && loadMessages ? (
                    <Transcript>
                    <WebuiSessionTranscript
                      sessionId={selectedSessionId}
                      loadMessages={loadMessages}
                    />
                    </Transcript>
                  ) : null}
                </div>
              </div>
            </div>
            {!homeMode && workspacePanelOpen ? <WebuiWorkspacePanel sessionId={selectedSessionId} workspaceDir={selectedSession?.workspaceDir} listWorkspaceFileTree={listWorkspaceFileTree} readWorkspaceFile={readWorkspaceFile} readCanvas={readCanvas} applyCanvas={applyCanvas} createTerminal={createTerminal} listTerminals={listTerminals} writeTerminal={writeTerminal} disposeTerminal={disposeTerminal} watchTerminal={watchTerminal} todos={progressTodos} defaultTab={workspacePanelTab} onClose={() => setWorkspacePanelOpen(false)} /> : null}
          </main>
        </div>
      </div>
    </div>
    </ArchonShell>
  );
}

export default WebuiClientFoundationApp;
