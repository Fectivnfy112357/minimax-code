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
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { WebuiMarkdown } from "./markdown.js";
import { projectMessageParts, stripQuestionnaireResponse } from "./projection/message-parts.js";
import type { WebuiQuestionnaireResponseSummary } from "./projection/message-parts.js";
import {
  WebuiIconActivity,
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
  WebuiIconContextArchive,
  WebuiIconContextChevron,
  WebuiIconContextCopy,
  WebuiIconContextFeedback,
  WebuiIconContextFork,
  WebuiIconContextPin,
  WebuiIconContextRename,
  WebuiIconContextTrash,
  WebuiIconMessageCopy,
  WebuiIconMessageCopied,
  WebuiIconMessageDislikeOff,
  WebuiIconMessageDislikeOn,
  WebuiIconMessageEdit,
  WebuiIconMessageEditUser,
  WebuiIconMessageFork,
  WebuiIconMessageLikeOff,
  WebuiIconMessageLikeOn,
  WebuiIconMessageRewind,
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
import {
  LeftRail,
  readProjectNames,
  readProjectPins,
  readSessionOverlay,
  toggleProjectPin,
  toggleSessionOverlay,
  writeProjectName,
} from "./components/LeftRail.js";
import { UserMenu } from "./components/UserMenu.js";
import { WebuiWorkspacePanel, WebuiWorkspaceOverview, WebuiWorkspacePanelControls, type WebuiTodo } from "./components/WorkspacePanels.js";
import { Transcript } from "./components/Transcript.js";
import { TurnNavigator, type TurnSummary } from "./components/TurnNavigator.js";
import { MessageAttachments, type MessageAttachment } from "./components/MessageAttachments.js";
import {
  ActivityIndicator,
  MessageAfterQueryStreamingPlaceholder,
  MessagePassiveLoadingPlaceholder,
  MessageViewportStreamingLoader,
} from "./components/ActivityIndicator.js";
import { ChatSkeleton, GreetingSkeleton } from "./components/TranscriptSkeletons.js";
import { OutputError } from "./components/OutputError.js";
import {
  ConversationUsageBanner,
  type ConversationUsageNotice,
} from "./components/ConversationUsageBanner.js";
import { initialWebuiStreamState, type WebuiStreamMessage, type WebuiStreamState } from "./stream.js";
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
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiFileDiffInfoView,
  WebuiTurnDiffView,
  WebuiRevertTurnDiffRequest,
  WebuiRevertTurnDiffResult,
  WebuiReapplyTurnDiffRequest,
  WebuiReapplyTurnDiffResult,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiForkSessionRequest,
  WebuiForkSessionResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiRewindSessionRequest,
  WebuiRewindSessionResult,
  WebuiEditSessionMessageRequest,
  WebuiEditSessionMessageResult,
  WebuiGoal,
  WebuiGoalStatus,
  WebuiUsageQuotaResult,
  WebuiGoalSessionRequest,
  WebuiGoalCreateRequest,
  WebuiGoalPatchRequest,
  WebuiGoalEnabledResult,
} from "../server/port.js";
import {
  initialWebuiWorkspaceProgress,
  projectWebuiWorkspaceHistory,
  webuiWorkspaceSubagentStatus,
  type WebuiWorkspaceProgressState,
  type WebuiWorkspaceSubagent,
} from "./projection/workspace-progress.js";

// ---------------------------------------------------------------------------
// W2 imports — the pure helpers and types that W2 moved into dedicated
// modules under `projection/`, `value-readers.ts`, and `contracts.ts`.
// `app.tsx` keeps its own internal copies for the React components
// (unchanged behaviour), but the moved symbols are now sourced from the new
// modules so the types and helpers stay in one place per concern.
// ---------------------------------------------------------------------------
import {
  formatWebuiError,
  recordValue,
  stringValue,
  numberValue,
  booleanValue,
} from "./value-readers.js";
import {
  readMessageDiff,
  projectMessageAttachments,
  deriveConversationUsageNotice,
  projectWebuiMessage,
  readMessageUsage,
  readUsageNumber,
} from "./projection/message-projection.js";
import {
  toolCallResultText,
  toolCallName,
  toolCallLabel,
  toolCallInputText,
  isWebuiEditTool,
  webuiEditFileStat,
  webuiActivitySummary,
} from "./projection/tool-projection.js";
import {
  groupWebuiTranscriptItems,
} from "./projection/transcript-projection.js";
import {
  webuiClientRequestId,
  buildWebuiRewindRequest,
  buildWebuiEditRequest,
  buildWebuiForkRequest,
  buildWebuiMessageForkRequest,
  buildWebuiModelSelectionRequest,
  webuiModelOptionValue,
} from "./projection/action-requests.js";
import {
  sortWebuiQuestionnaireOptions,
  canAdvanceWebuiQuestionnaireStep,
  toggleWebuiQuestionnaireOption,
  buildWebuiQuestionnaireAnswers,
  optionIdsForStep,
} from "./projection/questionnaire-state.js";
import {
  formatWebuiGoalDuration,
  buildWebuiGoalEditPatch,
  buildWebuiGoalStatusPatch,
  WEBUI_GOAL_STATUS_COPY,
  WEBUI_GOAL_WAIT_COPY,
} from "./projection/goal-state.js";
import {
  buildWebuiComposerHandlers,
  submitWebuiComposerTurn,
  createdSessionId,
} from "./projection/composer-state.js";
import {
  applyWebuiEffectCommands,
  reduceWebuiEffect,
} from "./projection/effect-reducer.js";
import type {
  WebuiClientMessage,
  WebuiClientSession,
  WebuiClientSessionPage,
  WebuiClientSessionTreeNode,
  WebuiClientSessionTreePage,
  WebuiClientSessionTreeLoader,
  WebuiClientSessionLoader,
  WebuiClientMessagePage,
  WebuiClientMessageLoader,
  WebuiClientCreateSessionRequest,
  WebuiClientCreateSessionResult,
  WebuiClientSessionCreator,
  WebuiClientMessageSender,
  WebuiClientMessageEnqueuer,
  WebuiClientSessionResumer,
  WebuiClientEventWatcher,
  WebuiTranscriptItem,
  WebuiDiffState,
  WebuiDiffStateAction,
  WebuiModelSelectionRequest,
  WebuiTransport,
} from "./contracts.js";
import type {
  WebuiComposerSubmitArgs,
  WebuiComposerSubmitHandlers,
} from "./projection/composer-state.js";

// Re-export the moved symbols so external consumers (tests + future
// importers) can read them from `app.tsx` while they migrate.
export {
  formatWebuiError,
  recordValue,
  stringValue,
  numberValue,
  booleanValue,
} from "./value-readers.js";
export type {
  WebuiClientMessage,
  WebuiClientSession,
  WebuiClientSessionPage,
  WebuiClientSessionTreeNode,
  WebuiClientSessionTreePage,
  WebuiClientSessionTreeLoader,
  WebuiClientSessionLoader,
  WebuiClientMessagePage,
  WebuiClientMessageLoader,
  WebuiClientCreateSessionRequest,
  WebuiClientCreateSessionResult,
  WebuiClientSessionCreator,
  WebuiClientMessageSender,
  WebuiClientMessageEnqueuer,
  WebuiClientSessionResumer,
  WebuiClientEventWatcher,
  WebuiTranscriptItem,
  WebuiDiffState,
  WebuiDiffStateAction,
} from "./contracts.js";
export {
  readMessageDiff,
  projectMessageAttachments,
  deriveConversationUsageNotice,
  projectWebuiMessage,
  readMessageUsage,
  readUsageNumber,
} from "./projection/message-projection.js";
export {
  toolCallResultText,
  toolCallName,
  toolCallLabel,
  toolCallInputText,
  isWebuiEditTool,
  webuiEditFileStat,
  webuiActivitySummary,
} from "./projection/tool-projection.js";
export {
  groupWebuiTranscriptItems,
  eventSessionId,
  pendingPermissionFromEvent,
  questionnaireFromEvent,
  replacePermission,
} from "./projection/transcript-projection.js";
export {
  webuiClientRequestId,
  buildWebuiRewindRequest,
  buildWebuiEditRequest,
  buildWebuiForkRequest,
  buildWebuiMessageForkRequest,
  buildWebuiModelSelectionRequest,
  webuiModelOptionValue,
} from "./projection/action-requests.js";
export {
  sortWebuiQuestionnaireOptions,
  canAdvanceWebuiQuestionnaireStep,
  toggleWebuiQuestionnaireOption,
  buildWebuiQuestionnaireAnswers,
  optionIdsForStep,
} from "./projection/questionnaire-state.js";
export {
  formatWebuiGoalDuration,
  buildWebuiGoalEditPatch,
  buildWebuiGoalStatusPatch,
  WEBUI_GOAL_STATUS_COPY,
  WEBUI_GOAL_WAIT_COPY,
  projectWebuiThreadGoalMessage,
} from "./projection/goal-state.js";
export {
  buildWebuiComposerHandlers,
  submitWebuiComposerTurn,
  createdSessionId,
} from "./projection/composer-state.js";

// (WebuiClientMessage, WebuiClientSession, page/loader types,
//  WebuiTranscriptItem, WebuiDiffState/Action, etc. moved to ./contracts.ts in W2)

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

// (moved to ./projection/message-projection.ts in W2)

// (tool helpers moved to ./projection/tool-projection.ts in W2)

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

export const initialWebuiDiffState: WebuiDiffState = {
  unsupported: false,
  busy: false,
  expanded: false,
  reviewing: false,
};

export function reduceWebuiDiffState(
  state: WebuiDiffState,
  action: WebuiDiffStateAction,
): WebuiDiffState {
  switch (action.type) {
    case "loaded":
      return { ...state, view: action.view, unsupported: false, busy: false };
    case "unsupported":
    case "mutation-failed":
      return { ...state, unsupported: true, busy: false };
    case "begin-mutation":
      return state.busy ? state : { ...state, busy: true };
    case "mutation-succeeded":
      return { ...state, view: action.view, unsupported: false, busy: false };
    case "toggle-expanded":
      return { ...state, expanded: !state.expanded };
    case "toggle-review":
      return { ...state, reviewing: !state.reviewing };
  }
}

export function buildWebuiDiffMutationRequest(
  state: WebuiDiffState,
  request: WebuiGetTurnDiffRequest,
  action: "revert" | "reapply",
): WebuiRevertTurnDiffRequest | WebuiReapplyTurnDiffRequest | undefined {
  if (state.busy || state.unsupported || !state.view?.changeSetId) return undefined;
  if (action === "revert" && (state.view.status === "reverted" || state.view.canUndo === false)) return undefined;
  if (action === "reapply" && (state.view.status !== "reverted" || state.view.canReapply === false)) return undefined;
  return { ...request, changeSetId: state.view.changeSetId };
}

export function confirmWebuiDiffMutation(
  state: WebuiDiffState,
  confirmed: boolean,
): WebuiDiffState {
  return confirmed
    ? reduceWebuiDiffState(state, { type: "begin-mutation" })
    : state;
}

export function WebuiDiffCard({
  sessionId,
  assistantMessageId,
  turnId,
  changeSetId,
  initialView,
  initialState,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
}: {
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialView?: WebuiTurnDiffView;
  readonly initialState?: Partial<WebuiDiffState>;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
}): ReactElement | null {
  const [diffState, setDiffState] = useState<WebuiDiffState>(() => ({
    ...initialWebuiDiffState,
    ...initialState,
    ...(initialView ? { view: initialView } : {}),
  }));
  const { view, unsupported, busy, expanded, reviewing } = diffState;
  const request = useMemo<WebuiGetTurnDiffRequest | undefined>(() => {
    if (!sessionId || !getTurnDiff) return undefined;
    // The runtime keys a turn diff by the turn: an `assistantMessageId` is
    // answered only for the turn's LAST assistant message, and any other
    // message of the same turn yields an empty file list (it also wins over
    // `turnId` when both are sent). The rendered group is keyed by its first
    // message, so ask by turn whenever the group knows one.
    return {
      id: sessionId,
      ...(turnId ? { turnId } : assistantMessageId ? { assistantMessageId } : {}),
      ...(changeSetId ? { changeSetId } : {}),
    };
  }, [assistantMessageId, changeSetId, getTurnDiff, sessionId, turnId]);

  useEffect(() => {
    if (!request || !getTurnDiff) return undefined;
    let cancelled = false;
    void getTurnDiff(request)
      .then((nextView) => {
        if (!cancelled) setDiffState((current) => reduceWebuiDiffState(current, { type: "loaded", view: nextView }));
      })
      .catch(() => {
        // The runtime deliberately reports an unavailable diff capability as a
        // neutral card state. The client must not infer success from edit-tool
        // output when the authoritative application is unavailable.
        if (!cancelled) setDiffState((current) => reduceWebuiDiffState(current, { type: "unsupported" }));
      });
    return () => {
      cancelled = true;
    };
  }, [getTurnDiff, request]);

  const mutate = async (action: "revert" | "reapply") => {
    if (!request || busy) return;
    const handler = action === "revert" ? revertTurnDiff : reapplyTurnDiff;
    if (!handler) {
      setDiffState((current) => reduceWebuiDiffState(current, { type: "unsupported" }));
      return;
    }
    const confirmed = window.confirm(action === "revert" ? "撤销这轮文件改动？" : "重新应用这轮文件改动？");
    if (!confirmed) return;
    const mutationRequest = buildWebuiDiffMutationRequest(diffState, request, action);
    if (!mutationRequest) return;
    setDiffState((current) => confirmWebuiDiffMutation(current, confirmed));
    try {
      const result = await handler(mutationRequest);
      const nextView = action === "revert"
        ? (result as WebuiRevertTurnDiffResult).turnDiff
        : (result as WebuiReapplyTurnDiffResult);
      if (nextView) setDiffState((current) => reduceWebuiDiffState(current, { type: "mutation-succeeded", view: nextView }));
      else setDiffState((current) => reduceWebuiDiffState(current, { type: "mutation-failed" }));
    } catch {
      setDiffState((current) => reduceWebuiDiffState(current, { type: "mutation-failed" }));
    } finally {
      setDiffState((current) => ({ ...current, busy: false }));
    }
  };

  if (unsupported)
    return (
      <div className="webui-diff-card webui-diff-card--neutral" data-webui-diff-card="true" data-webui-diff-state="runtime-unsupported">
        <span className="webui-diff-header-title">文件改动暂不可用</span>
        <span className="webui-diff-neutral-copy">当前运行时未提供 session diff 能力。</span>
      </div>
    );
  if ((!getTurnDiff || !request) && !view) return null;
  if (!view || (view.fileChanges ?? []).length === 0) return null;
  const files = view.fileChanges ?? [];
  const shown = expanded ? files : files.slice(0, 3);
  const totalAdded = files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeleted = files.reduce((sum, file) => sum + file.deletions, 0);
  const reverted = view.status === "reverted";
  const basenameOf = (path: string): string => {
    if (!path) return "";
    const normalized = path.replace(/\\/g, "/");
    const idx = normalized.lastIndexOf("/");
    return idx === -1 ? normalized : normalized.slice(idx + 1);
  };
  return (
    <div
      className="webui-diff-card"
      data-webui-diff-card="true"
      data-webui-diff-state={view.status ?? "active"}
      data-change-set-id={view.changeSetId}
      data-source-message-id={view.sourceMessageId ?? assistantMessageId}
    >
      <div className="webui-diff-header">
        <span className="webui-diff-icon" aria-hidden="true"><WebuiIconFile /></span>
        <span className="webui-diff-header-title">{`已编辑 ${files.length} 个文件`}</span>
        <span className="webui-diff-header-stats" data-webui-diff-stats="true">
          <span className="webui-diff-add">{`+${totalAdded}`}</span>
          {/* Desktop's diff card hides the deletion badge when no lines
           * were removed from the change set — keeping the row additions-only
           * avoids the misleading "+{n}-0" stat the WebUI used to render. */}
          {totalDeleted > 0 ? <span className="webui-diff-del">{`-${totalDeleted}`}</span> : null}
        </span>
      </div>
      <ul className="webui-diff-files">
        {shown.map((file) => (
          <li className="webui-diff-file" key={file.file} data-webui-diff-file="true" data-file-path={file.file}>
            <WebuiIconFile className="webui-diff-file-icon" />
            <span className="webui-diff-file-name" title={file.file}>{basenameOf(file.file)}</span>
            <span className="webui-diff-file-stats" data-webui-diff-file-stats="true">
              <span className="webui-diff-add">{`+${file.additions}`}</span>
              {file.deletions > 0 ? <span className="webui-diff-del">{`-${file.deletions}`}</span> : null}
            </span>
          </li>
        ))}
      </ul>
      {files.length > 3 ? (
        <button type="button" className="webui-diff-expand" data-webui-diff-expand="true" onClick={() => setDiffState((current) => reduceWebuiDiffState(current, { type: "toggle-expanded" }))}>
          {expanded ? "收起" : `展开其余 ${files.length - 3} 个`}
        </button>
      ) : null}
      <div className="webui-diff-actions">
        <button type="button" className="webui-diff-review" data-webui-diff-review="true" onClick={() => setDiffState((current) => reduceWebuiDiffState(current, { type: "toggle-review" }))}>
          {reviewing ? "关闭 Review" : "Review"}
        </button>
        {reverted ? (
          <button type="button" className="webui-diff-reapply" disabled={busy || view.canReapply === false} onClick={() => void mutate("reapply")}>
            重新应用
          </button>
        ) : (
          <button type="button" className="webui-diff-revert" disabled={busy || view.canUndo === false} onClick={() => void mutate("revert")}>
            撤销
          </button>
        )}
      </div>
      {reviewing ? (
        <div className="webui-diff-review-panel" data-webui-diff-review-panel="true">
          {files.map((file) => (
            <details key={`${file.file}-review`} open>
              <summary>{file.file}</summary>
              {file.diff ? <pre>{file.diff}</pre> : file.patch ? <pre>{JSON.stringify(file.patch, null, 2)}</pre> : <p>当前运行时没有提供该文件的 patch 预览。</p>}
            </details>
          ))}
        </div>
      ) : null}
    </div>
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

// (webuiActivitySummary moved to ./projection/tool-projection.ts in W2)

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

function WebuiAssistantBody({
  messageId,
  sessionId,
  assistantMessageId,
  turnId,
  changeSetId,
  initialDiff,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  thinking,
  thinkingDurationMs,
  processingStartedAtMs,
  totalRequestDurationMs,
  totalOutputTokens,
  wallClockDurationMs,
  tools,
  answers,
  attachments,
  streaming = false,
}: {
  readonly messageId: string;
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  /** Sum of `usage.requestDurationMs` across the turn's assistant messages
   *  when the runtime reports it. Falls back to `wallClockDurationMs`. */
  readonly totalRequestDurationMs?: number;
  /** Sum of `usage.outputTokens` across the turn's assistant messages. */
  readonly totalOutputTokens?: number;
  /** Wall-clock duration computed from message timestamps inside the turn
   *  (oldest user → newest assistant). Used when the runtime doesn't emit
   *  a per-request duration. */
  readonly wallClockDurationMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers: readonly string[];
  readonly attachments?: readonly MessageAttachment[];
  readonly streaming?: boolean;
}): ReactElement {
  return (
    <div
      className="webui-assistant-body text-sm space-y-4"
      data-webui-assistant-body={messageId}
    >
      {thinking || tools?.length ? (
        <WebuiTurnProcess
          active={streaming}
          startedAtMs={processingStartedAtMs}
          {...(!streaming && totalRequestDurationMs !== undefined
            ? { endedAtMs: (processingStartedAtMs ?? 0) + totalRequestDurationMs }
            : {})}
          tokenCount={
            !streaming && typeof totalOutputTokens === "number"
              ? totalOutputTokens
              : answers.reduce((sum, answer) => sum + answer.length, 0)
          }
          requestDurationMs={totalRequestDurationMs}
          wallClockDurationMs={wallClockDurationMs}
        >
          <div className="activity-group-content">
            {thinking ? (
              <WebuiThinkingBlock
                text={thinking}
                durationMs={thinkingDurationMs}
                streaming={streaming}
                processingStartedAtMs={processingStartedAtMs}
              />
            ) : null}
            {tools?.length ? <WebuiActivityGroup tools={tools} authoritativeDiffAvailable={Boolean(getTurnDiff)} streaming={streaming} /> : null}
          </div>
        </WebuiTurnProcess>
      ) : null}
      {answers.map((answer, index) => (
        <div
          key={`${messageId}-answer-${index}`}
          className="webui-assistant-answer"
          data-webui-message-kind="assistant"
        >
          <WebuiMarkdown source={answer} />
        </div>
      ))}
      {/* Desktop places the diff card after the assistant body so the
       * edited-files summary sits at the end of the message. */}
      <WebuiDiffCard
        sessionId={sessionId}
        assistantMessageId={assistantMessageId ?? messageId}
        turnId={turnId}
        changeSetId={changeSetId}
        initialView={initialDiff}
        getTurnDiff={getTurnDiff}
        revertTurnDiff={revertTurnDiff}
        reapplyTurnDiff={reapplyTurnDiff}
      />
      {attachments?.length ? (
        <MessageAttachments attachments={attachments} />
      ) : null}
    </div>
  );
}

/**
 * The single message renderer shared by persisted history and the live turn.
 * The shell still decides which source owns the turn (history after done,
 * composer while active), but the DOM for either role is produced here.
 */
export function MessageItem({
  messageId,
  role,
  sessionId,
  assistantMessageId,
  turnId,
  changeSetId,
  initialDiff,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  actions,
  timestamp,
  isGoal = false,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
  onMutationComplete,
  totalRequestDurationMs,
  totalOutputTokens,
  wallClockDurationMs,
  userText,
  thinking,
  thinkingDurationMs,
  processingStartedAtMs,
  tools,
  answers,
  attachments,
  streaming = false,
  streamMessageId,
  messageRootId,
}: {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly actions?: WebuiMessageActionCapabilities;
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly getSessionForkOptions?: WebuiTransport["getSessionForkOptions"];
  readonly forkSession?: WebuiTransport["forkSession"];
  readonly getSessionRewindPreview?: WebuiTransport["getSessionRewindPreview"];
  readonly rewindSession?: WebuiTransport["rewindSession"];
  readonly editSessionMessage?: WebuiTransport["editSessionMessage"];
  readonly onMutationComplete?: () => void;
  readonly userText?: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers?: readonly string[];
  readonly attachments?: readonly MessageAttachment[];
  readonly streaming?: boolean;
  readonly streamMessageId?: string;
  readonly messageRootId?: string;
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  readonly wallClockDurationMs?: number;
}): ReactElement {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(userText ?? "");
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindPreview, setRewindPreview] = useState<WebuiGetSessionRewindPreviewResult>();
  const [rewindLoading, setRewindLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [forkTitle, setForkTitle] = useState("");
  const [forkOpen, setForkOpen] = useState(false);
  const [forkOptions, setForkOptions] = useState<WebuiGetSessionForkOptionsResult>();
  const openRewind = () => {
    setRewindOpen(true);
    setRewindPreview(undefined);
    setMutationError(undefined);
    if (!sessionId || !getSessionRewindPreview) return;
    setRewindLoading(true);
    void getSessionRewindPreview({ id: sessionId, userMessageId: messageId })
      .then(setRewindPreview)
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRewindLoading(false));
  };
  const confirmRewind = (rewindTurnDiff: boolean) => {
    if (!sessionId || !rewindSession) return;
    setMutationBusy(true);
    void rewindSession(buildWebuiRewindRequest(sessionId, messageId, webuiClientRequestId("rewind"), rewindTurnDiff))
      .then(() => { setRewindOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const submitEdit = () => {
    if (!sessionId || !editSessionMessage) return;
    const request = buildWebuiEditRequest(sessionId, messageId, webuiClientRequestId("edit"), editText);
    if (!request) return;
    setMutationBusy(true);
    void editSessionMessage(request)
      .then(() => { setEditing(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const confirmFork = () => {
    if (!sessionId || !forkSession || forkOptions?.canFork === false) return;
    setMutationBusy(true);
    void forkSession(buildWebuiMessageForkRequest(sessionId, messageId, webuiClientRequestId("fork"), forkTitle))
      .then(() => { setForkOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const openFork = () => {
    setForkOpen(true);
    setForkOptions(undefined);
    if (!sessionId || !getSessionForkOptions) return;
    void getSessionForkOptions({ id: sessionId, assistantMessageId: messageId })
      .then((nextOptions) => {
        setForkOptions(nextOptions);
        if (nextOptions.suggestedTitle) setForkTitle(nextOptions.suggestedTitle);
      })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)));
  };
  const actionProps = {
    role,
    messageId,
    copyText: role === "user" ? userText ?? "" : answers?.join("\n\n") ?? "",
    actions,
    onRewind: role === "user" ? openRewind : undefined,
    onEdit: role === "user" ? () => { setEditText(userText ?? ""); setEditing(true); } : undefined,
    onFork: role === "assistant" ? openFork : undefined,
    timestamp,
  };
  if (role === "user") {
    return (
      <div
        className="webui-message message-animate-in group relative"
        data-webui-stream-message={streamMessageId}
        data-webui-message-root={messageRootId ?? messageId}
        data-webui-message-role="user"
        data-testid="message-item"
        data-role="user"
        data-message-id={messageId}
        data-webui-goal-message={isGoal ? "true" : undefined}
        data-message-timestamp={timestamp}
      >
        <div className="flex w-full justify-end">
          <div className="flex w-full flex-col items-end gap-spacing_8">
            {editing ? (
              <div className="webui-user-inline-editor" data-testid="user-message-inline-editor">
                <textarea aria-label="编辑" value={editText} onChange={(event) => setEditText(event.target.value)} autoFocus />
                <div className="webui-inline-editor-actions"><button type="button" onClick={() => setEditing(false)} disabled={mutationBusy}>取消</button><button type="button" onClick={submitEdit} disabled={mutationBusy || !editText.trim()}>发送</button></div>
              </div>
            ) : <div
              className="webui-user-bubble bg-bg_grouped_tertiary rounded-[16px] px-3 py-2 max-w-[80%]"
              data-webui-user-bubble="true"
            >
              <div className="webui-user-text-clamp">
                <p
                  className="webui-user-text"
                  data-webui-message-kind="user"
                  data-webui-user-text="true"
                >
                  <span>{userText ?? ""}</span>
                </p>
              </div>
            </div>}
            {!editing ? <WebuiMessageActions {...actionProps} /> : null}
            {rewindOpen ? <WebuiRewindDialog messageId={messageId} preview={rewindPreview} loading={rewindLoading} error={mutationError} busy={mutationBusy} onClose={() => setRewindOpen(false)} onConfirm={confirmRewind} /> : null}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="webui-message message-animate-in group relative"
      data-webui-stream-message={streamMessageId}
      data-webui-message-root={messageRootId ?? messageId}
      data-webui-message-role="assistant"
      data-testid="message-item"
      data-role="assistant"
      data-message-id={messageId}
    >
      <WebuiAssistantBody
        messageId={messageId}
        sessionId={sessionId}
        assistantMessageId={assistantMessageId}
        turnId={turnId}
        changeSetId={changeSetId}
        initialDiff={initialDiff}
        getTurnDiff={getTurnDiff}
        revertTurnDiff={revertTurnDiff}
        reapplyTurnDiff={reapplyTurnDiff}
        thinking={thinking}
        thinkingDurationMs={thinkingDurationMs}
        tools={tools}
        answers={answers ?? []}
        attachments={attachments}
        streaming={streaming}
        processingStartedAtMs={processingStartedAtMs}
        totalRequestDurationMs={totalRequestDurationMs}
        totalOutputTokens={totalOutputTokens}
        wallClockDurationMs={wallClockDurationMs}
      />
      <WebuiMessageActions {...actionProps} />
      {forkOpen ? <div className="webui-message-dialog" role="dialog" aria-modal="true" data-testid="fork-dialog"><div className="webui-message-dialog-surface"><h3>复制为新会话</h3><p>{forkOptions?.unavailableReason ?? "保留当前上下文，在新会话中继续"}</p><input aria-label="会话名称" value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="使用简短且不同的名称，便于识别" disabled={forkOptions?.canFork === false} /><div className="webui-message-dialog-actions"><button type="button" onClick={() => setForkOpen(false)} disabled={mutationBusy}>取消</button><button type="button" onClick={confirmFork} disabled={mutationBusy || forkOptions?.canFork === false}>复制并进入</button></div></div></div> : null}
      {mutationError && !rewindOpen && !forkOpen ? <p role="alert" className="webui-message-mutation-error">{mutationError}</p> : null}
    </div>
  );
}

export interface WebuiClientFoundationAppProps {
  // Non-method props (seed / UI / SSR). The 78 method props that used to
  // live here are now bundled into `transport` (see contracts.ts →
  // `WebuiTransport`). Optional semantics preserved: `transport.X` is
  // `undefined` exactly when the underlying operation is not wired.
  readonly label: string;
  readonly version?: WebuiVersionInfo;
  readonly sessionPage?: WebuiClientSessionPage;
  /** Seed for the transcript so SSR / first paint can render messages before
   * `loadMessages` resolves; production always re-fetches in the background
   * so the prop only changes the initial paint, not the source of truth. */
  readonly initialMessages?: WebuiClientMessagePage;
  /** Seed for the conversation usage banner so SSR / first paint can render
   * it before `getUsageQuota` resolves; production always re-fetches in the
   * background so the prop only changes the initial paint, not the source
   * of truth.
   */
  readonly initialUsageQuota?: WebuiUsageQuotaResult;
  readonly locationHash?: string;
  readonly dataDir?: string;
  /**
   * What the identity row shows under the product name. The desktop puts the signed-in
   * account's plan there; the WebUI is loopback-only and has no account, so it reports
   * the scope it actually runs in. `main.tsx` passes the page's host.
   */
  readonly hostLabel?: string;
  /**
   * W2.5 transport object — the single bag of methods the foundation app
   * consumes. `main.tsx` constructs it ONCE at module scope so the React
   * effect dependency identity is stable across renders. Passing a fresh
   * object every render would re-subscribe the watcher / fetcher effects
   * on every keystroke. Optional fields stay optional: `transport.X`
   * is `undefined` iff the operation is not wired.
   */
  readonly transport?: WebuiTransport;
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

// (createdSessionId moved to ./projection/composer-state.ts in W2)

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

export function sortWebuiProjectSessionIds(
  sessions: readonly Pick<WebuiClientSession, "sessionId" | "updatedAt">[],
  pinnedSessions: Readonly<Record<string, boolean>>,
  sessionIds: readonly string[],
): string[] {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  return [...sessionIds].sort((left, right) => {
    const pinDelta = Number(Boolean(pinnedSessions[right])) - Number(Boolean(pinnedSessions[left]));
    if (pinDelta) return pinDelta;
    return (byId.get(right)?.updatedAt ?? 0) - (byId.get(left)?.updatedAt ?? 0);
  });
}

export function placeWebuiContextMenu({
  x,
  y,
  width,
  height,
  viewportWidth,
  viewportHeight,
  padding = 8,
}: {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly padding?: number;
}): { readonly left: number; readonly top: number } {
  const maxLeft = Math.max(padding, viewportWidth - width - padding);
  const left = Math.min(Math.max(padding, x), maxLeft);
  const flippedTop = y + height + padding > viewportHeight ? y - height : y;
  const maxTop = Math.max(padding, viewportHeight - height - padding);
  return { left, top: Math.min(Math.max(padding, flippedTop), maxTop) };
}

export type WebuiContextMenuItem =
  | { readonly kind: "divider"; readonly key: string }
  | {
      readonly kind: "item";
      readonly key: string;
      readonly label: string;
      readonly icon?: ReactElement;
      readonly danger?: boolean;
      readonly disabled?: boolean;
      readonly onSelect?: () => void | Promise<void>;
      readonly submenu?: readonly WebuiContextMenuItem[];
    };

export function WebuiContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  readonly x: number;
  readonly y: number;
  readonly items: readonly WebuiContextMenuItem[];
  readonly onClose: () => void;
}): ReactElement {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string>();
  const [position, setPosition] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    setPosition({ left: x, top: y });
  }, [x, y]);
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || typeof window === "undefined") return;
    const next = placeWebuiContextMenu({
      x,
      y,
      width: menu.offsetWidth,
      height: menu.offsetHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPosition((current) =>
      current.left === next.left && current.top === next.top ? current : next,
    );
  }, [items, x, y]);
  useEffect(() => {
    const handlePointerDown = (event: globalThis.MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);
  const renderItems = (menuItems: readonly WebuiContextMenuItem[]) =>
    menuItems.map((item) => {
      if (item.kind === "divider") {
        return <div key={item.key} className="webui-context-menu-divider" role="separator" />;
      }
      const hasSubmenu = Boolean(item.submenu?.length);
      return (
        <div
          key={item.key}
          className="webui-context-menu-item-wrap"
          onMouseEnter={() => hasSubmenu && setOpenSubmenu(item.key)}
          onMouseLeave={() => hasSubmenu && setOpenSubmenu(undefined)}
        >
          <button
            type="button"
            className={`webui-context-menu-item${item.danger ? " is-danger" : ""}`}
            disabled={item.disabled}
            aria-disabled={item.disabled ? "true" : undefined}
            onClick={() => {
              if (hasSubmenu) {
                setOpenSubmenu((current) => (current === item.key ? undefined : item.key));
                return;
              }
              onClose();
              void item.onSelect?.();
            }}
          >
            <span className="webui-context-menu-item-icon">{item.icon ?? null}</span>
            <span className="webui-context-menu-item-label">{item.label}</span>
            {hasSubmenu ? <WebuiIconContextChevron className="webui-context-menu-chevron" /> : null}
          </button>
          {hasSubmenu && openSubmenu === item.key ? (
            <div className="webui-context-menu-submenu" role="menu">
              {renderItems(item.submenu ?? [])}
            </div>
          ) : null}
        </div>
      );
    });
  const menu = (
    <div
      ref={menuRef}
      role="menu"
      data-webui-context-menu="true"
      className="webui-context-menu"
      style={{ left: position.left, top: position.top }}
    >
      {renderItems(items)}
    </div>
  );
  return typeof document !== "undefined" ? createPortal(menu, document.body) : menu;
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
  pinnedSessions,
  pinnedProjects,
  projectNames,
  onRenameProject,
  onToggleProjectPin,
  onArchiveProject,
  onRenameSession,
  onToggleSessionPin,
  onArchiveSession,
  onForkSession,
  onCopySession,
  onDeleteSession,
}: {
  readonly page: WebuiClientSessionPage;
  readonly treePage?: WebuiClientSessionTreePage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly onProjectSelect?: (workspaceDir?: string) => void;
  readonly error?: string;
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  readonly pinnedProjects?: Readonly<Record<string, boolean>>;
  readonly projectNames?: Readonly<Record<string, string>>;
  readonly onRenameProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleProjectPin?: (project: WebuiProjectGroup) => void;
  readonly onArchiveProject?: (project: WebuiProjectGroup) => void;
  readonly onRenameSession?: (session: WebuiClientSession) => void;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onForkSession?: (session: WebuiClientSession, createIsolatedWorktree: boolean) => void;
  readonly onCopySession?: (session: WebuiClientSession, value: "workspaceDir" | "sessionId") => void;
  readonly onDeleteSession?: (session: WebuiClientSession) => void;
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
    () => {
      const grouped = groupWebuiSessionsByWorkspace(page.sessions);
      return [...grouped].sort((left, right) => {
        const pinDelta = Number(Boolean(pinnedProjects?.[right.key])) - Number(Boolean(pinnedProjects?.[left.key]));
        return pinDelta || right.updatedAt - left.updatedAt;
      });
    },
    [page.sessions, pinnedProjects],
  );
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<
    | { readonly x: number; readonly y: number; readonly items: readonly WebuiContextMenuItem[] }
    | undefined
  >();
  const sessionsById = useMemo(
    () => new Map(page.sessions.map((session) => [session.sessionId, session])),
    [page.sessions],
  );

  const openSessionMenu = (event: MouseEvent<HTMLElement>, session: WebuiClientSession) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          kind: "item",
          key: "pin",
          label: pinnedSessions?.[session.sessionId] ? "取消置顶" : "置顶",
          icon: <WebuiIconContextPin />,
          disabled: !onToggleSessionPin,
          onSelect: () => onToggleSessionPin?.(session),
        },
        {
          kind: "item",
          key: "rename",
          label: "重命名",
          icon: <WebuiIconContextRename />,
          disabled: !onRenameSession,
          onSelect: () => onRenameSession?.(session),
        },
        {
          kind: "item",
          key: "archive",
          label: session.archived ? "取消归档" : "归档",
          icon: <WebuiIconContextArchive />,
          disabled: !onArchiveSession,
          onSelect: () => onArchiveSession?.(session),
        },
        { kind: "divider", key: "fork-divider" },
        {
          kind: "item",
          key: "fork-current",
          label: "复制为新会话",
          icon: <WebuiIconContextFork />,
          disabled: !onForkSession,
          onSelect: () => onForkSession?.(session, false),
        },
        {
          kind: "item",
          key: "fork-worktree",
          label: "复制到新工作树",
          icon: <WebuiIconContextFork />,
          disabled: !onForkSession,
          onSelect: () => onForkSession?.(session, true),
        },
        { kind: "divider", key: "copy-divider" },
        {
          kind: "item",
          key: "show-folder",
          label: "在文件夹中显示",
          icon: <WebuiIconFolder />,
          disabled: true,
        },
        {
          kind: "item",
          key: "copy",
          label: "复制",
          icon: <WebuiIconContextCopy />,
          submenu: [
            {
              kind: "item",
              key: "copy-workspace-dir",
              label: "复制工作目录",
              icon: <WebuiIconContextCopy />,
              disabled: !session.workspaceDir || !onCopySession,
              onSelect: () => onCopySession?.(session, "workspaceDir"),
            },
            {
              kind: "item",
              key: "copy-session-id",
              label: "复制会话 ID",
              icon: <WebuiIconContextCopy />,
              disabled: !onCopySession,
              onSelect: () => onCopySession?.(session, "sessionId"),
            },
          ],
        },
        {
          kind: "item",
          key: "feedback",
          label: "问题反馈",
          icon: <WebuiIconContextFeedback />,
          disabled: true,
        },
        { kind: "divider", key: "delete-divider" },
        {
          kind: "item",
          key: "delete",
          label: "删除",
          icon: <WebuiIconContextTrash />,
          danger: true,
          disabled: !onDeleteSession,
          onSelect: () => onDeleteSession?.(session),
        },
      ],
    });
  };

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
            const projectName = projectNames?.[project.key] ?? project.name;
            const orderedSessionIds = sortWebuiProjectSessionIds(
              page.sessions,
              pinnedSessions ?? {},
              project.sessionIds,
            );
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
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!project.workspaceDir) return;
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: [
                        {
                          kind: "item",
                          key: "rename-project",
                          label: "重命名项目",
                          icon: <WebuiIconContextRename />,
                          disabled: !onRenameProject,
                          onSelect: () => onRenameProject?.(project),
                        },
                        {
                          kind: "item",
                          key: "toggle-pin-project",
                          label: pinnedProjects?.[project.key] ? "取消置顶项目" : "置顶项目",
                          icon: <WebuiIconContextPin />,
                          disabled: !onToggleProjectPin,
                          onSelect: () => onToggleProjectPin?.(project),
                        },
                        {
                          kind: "item",
                          key: "show-project-in-folder",
                          label: "在文件夹中显示",
                          icon: <WebuiIconFolder />,
                          disabled: true,
                        },
                        {
                          kind: "item",
                          key: "archive-project-sessions",
                          label: "归档对话",
                          icon: <WebuiIconContextArchive />,
                          disabled: !onArchiveProject,
                          onSelect: () => onArchiveProject?.(project),
                        },
                        {
                          kind: "item",
                          key: "remove-project",
                          label: "移除",
                          icon: <WebuiIconContextTrash />,
                          danger: true,
                          disabled: true,
                        },
                      ],
                    });
                  }}
                  data-webui-project-link={project.key}
                  title={project.workspaceDir}
                  className="webui-project-card text-left text-text_default_secondary"
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">
                    {projectName}
                  </span>
                </button>
                {expanded ? (
                  <ul
                    className="webui-project-session-list"
                    data-webui-project-sessions={project.key}
                  >
                    {orderedSessionIds.map((sessionId) => {
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
                            onContextMenu={(event) => openSessionMenu(event, session)}
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
                                    onContextMenu={(event) => openSessionMenu(event, child)}
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
      {contextMenu ? (
        <WebuiContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(undefined)}
        />
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
// (groupWebuiTranscriptItems moved to ./projection/transcript-projection.ts in W2)

type WebuiMessageActionCapabilities = {
  readonly fork?: boolean;
  readonly rewind?: boolean;
  readonly edit?: boolean;
};

export function toggleWebuiFeedback(
  value: "like" | "dislike" | undefined,
  next: "like" | "dislike",
): "like" | "dislike" {
  return value === next ? (next === "like" ? "dislike" : "like") : next;
}

export interface WebuiCopyDependencies {
  readonly clipboard?: { readonly writeText: (value: string) => Promise<void> };
  readonly fallback?: () => void;
}

export async function copyWebuiMessageText(
  value: string,
  dependencies: WebuiCopyDependencies,
): Promise<boolean> {
  try {
    if (dependencies.clipboard) await dependencies.clipboard.writeText(value);
    else if (dependencies.fallback) dependencies.fallback();
    else return false;
    return true;
  } catch {
    return false;
  }
}

export function scheduleWebuiCopiedReset(
  setCopied: (value: boolean) => void,
  schedule: (callback: () => void, delayMs: number) => unknown,
): void {
  schedule(() => setCopied(false), 1_200);
}

// (action-request builders moved to ./projection/action-requests.ts in W2)

export function WebuiMessageActionButton({
  testId,
  label,
  icon,
  onClick,
  disabled = false,
  active,
}: {
  readonly testId: string;
  readonly label: string;
  /** The desktop's action row is glyph-only: a 26px square holding a 16–18px icon. */
  readonly icon: ReactElement;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** Selection state for the feedback toggles; the desktop paints the active glyph differently. */
  readonly active?: boolean;
}): ReactElement {
  return (
    <button
      type="button"
      className={`webui-message-action${active ? " webui-message-action-active" : ""}`}
      data-testid={testId}
      aria-label={label}
      title={label}
      {...(active === undefined ? {} : { "aria-pressed": active })}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  );
}

export function WebuiFeedbackActions({
  value,
  onChange,
}: {
  readonly value?: "like" | "dislike";
  readonly onChange: (value: "like" | "dislike") => void;
}): ReactElement {
  return (
    <span className="webui-message-feedback" data-testid="message-feedback-actions">
      <span data-testid="message-feedback-like">
        <WebuiMessageActionButton
          testId="message-feedback-like-action"
          label="赞"
          icon={value === "like" ? <WebuiIconMessageLikeOn size={18} /> : <WebuiIconMessageLikeOff size={18} />}
          active={value === "like"}
          onClick={() => onChange(toggleWebuiFeedback(value, "like"))}
        />
      </span>
      <span data-testid="message-feedback-dislike">
        <WebuiMessageActionButton
          testId="message-feedback-dislike-action"
          label="踩"
          icon={value === "dislike" ? <WebuiIconMessageDislikeOn size={18} /> : <WebuiIconMessageDislikeOff size={18} />}
          active={value === "dislike"}
          onClick={() => onChange(toggleWebuiFeedback(value, "dislike"))}
        />
      </span>
    </span>
  );
}

/** Desktop timestamp format for the action row: `9月22日, 22:37`. */
export function formatWebuiMessageTimestamp(value?: number): string | undefined {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  const pad = (input: number) => String(input).padStart(2, "0");
  return `${date.getMonth() + 1}月${date.getDate()}日, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function WebuiMessageActions({
  role,
  messageId,
  copyText,
  actions,
  onRewind,
  onEdit,
  onFork,
  timestamp,
}: {
  readonly role: "user" | "assistant";
  readonly messageId: string;
  readonly copyText: string;
  readonly actions?: WebuiMessageActionCapabilities;
  readonly onRewind?: () => void;
  readonly onEdit?: () => void;
  readonly onFork?: () => void;
  /** Epoch ms; the desktop prints it inside the action row. */
  readonly timestamp?: number;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<"like" | "dislike">();
  const copy = async () => {
    try {
      const copied = await copyWebuiMessageText(copyText, {
        ...(typeof navigator !== "undefined" && navigator.clipboard
          ? { clipboard: navigator.clipboard }
          : {}),
        ...(typeof document !== "undefined"
          ? {
              fallback: () => {
                const area = document.createElement("textarea");
                area.value = copyText;
                area.style.position = "fixed";
                area.style.opacity = "0";
                document.body.appendChild(area);
                area.select();
                document.execCommand("copy");
                area.remove();
              },
            }
          : {}),
      });
      if (copied) {
        setCopied(true);
        scheduleWebuiCopiedReset(setCopied, window.setTimeout);
      } else setCopied(false);
    } catch {
      setCopied(false);
    }
  };
  const timestampLabel = formatWebuiMessageTimestamp(timestamp);
  const copyIcon = copied ? <WebuiIconMessageCopied size={18} /> : <WebuiIconMessageCopy size={18} />;
  return (
    <div
      className={`webui-message-actions ${role === "user" ? "webui-user-message-actions" : ""}`}
      data-testid={role === "user" ? "user-message-actions" : "message-actions"}
      data-message-id={messageId}
    >
      {role === "user" ? (
        <>
          {timestampLabel ? (
            <span className="webui-message-timestamp" data-testid="user-message-timestamp">{timestampLabel}</span>
          ) : null}
          {actions?.rewind && onRewind ? (
            <WebuiMessageActionButton testId="user-message-rewind-button" label="回退" icon={<WebuiIconMessageRewind size={18} />} onClick={onRewind} />
          ) : null}
          {(actions?.edit ?? actions?.rewind) && onEdit ? (
            <WebuiMessageActionButton testId="user-message-edit-button" label="编辑" icon={<WebuiIconMessageEditUser size={18} />} onClick={onEdit} />
          ) : null}
          {copyText ? (
            <WebuiMessageActionButton testId="user-message-copy-button" label={copied ? "已复制" : "复制"} icon={copyIcon} onClick={() => void copy()} />
          ) : null}
        </>
      ) : (
        <>
          <WebuiMessageActionButton testId="message-copy-button" label={copied ? "已复制" : "复制"} icon={copyIcon} onClick={() => void copy()} />
          {actions?.rewind && onRewind ? (
            <WebuiMessageActionButton testId="message-rewind-button" label="回退" icon={<WebuiIconMessageRewind size={16} />} onClick={onRewind} />
          ) : null}
          {(actions?.edit ?? actions?.rewind) && onEdit ? (
            <WebuiMessageActionButton testId="message-edit-button" label="编辑" icon={<WebuiIconMessageEdit size={16} />} onClick={onEdit} />
          ) : null}
          <WebuiFeedbackActions value={feedback} onChange={setFeedback} />
          {actions?.fork && onFork ? (
            <WebuiMessageActionButton testId="message-fork-button" label="复制为新会话" icon={<WebuiIconMessageFork size={18} />} onClick={onFork} />
          ) : null}
          {timestampLabel ? (
            <span className="webui-message-timestamp" data-testid="message-timestamp">{timestampLabel}</span>
          ) : null}
        </>
      )}
    </div>
  );
}

/**
 * Historical questionnaire-response projection. Once the user submits a
 * questionnaire we render the question and the recorded answers inside the
 * conversation so a rewinded session still remembers what the user picked.
 */
export function WebuiQuestionnaireResponse({
  messageId,
  summary,
  timestamp,
}: {
  readonly messageId: string;
  readonly summary: WebuiQuestionnaireResponseSummary;
  readonly timestamp?: number;
}): ReactElement {
  const { requestId, answers } = summary;
  return (
    <article
      className="webui-questionnaire-history flex w-full max-w-[80%] flex-col gap-2 rounded-[16px] border border-border_default bg-bg_grouped_secondary_elevated p-3"
      data-webui-questionnaire-history="true"
      data-message-id={messageId}
      data-webui-questionnaire-request={requestId}
      data-testid={`questionnaire-history-${requestId}`}
    >
      <header className="flex flex-col gap-1">
        <span
          className="text-text_default_secondary text-size_12"
          data-testid="questionnaire-history-label"
        >
          问卷回答
        </span>
        <dl
          className="webui-questionnaire-history-meta flex flex-wrap gap-x-3 gap-y-1 text-text_default_tertiary text-size_12"
          data-testid="questionnaire-history-meta"
        >
          <div data-testid="questionnaire-history-meta-requestId">
            <dt className="inline">requestId: </dt>
            <dd className="inline font-mono">{requestId || "(未提供)"}</dd>
          </div>
          {summary.schemaVersion ? (
            <div data-testid="questionnaire-history-meta-schema">
              <dt className="inline">schemaVersion: </dt>
              <dd className="inline font-mono">{summary.schemaVersion}</dd>
            </div>
          ) : null}
          {summary.submittedAt ? (
            <div data-testid="questionnaire-history-meta-submitted">
              <dt className="inline">submittedAt: </dt>
              <dd className="inline font-mono">{summary.submittedAt}</dd>
            </div>
          ) : null}
          {summary.mode ? (
            <div data-testid="questionnaire-history-meta-mode">
              <dt className="inline">mode: </dt>
              <dd className="inline font-mono">{summary.mode}</dd>
            </div>
          ) : null}
          {summary.source ? (
            <div data-testid="questionnaire-history-meta-source">
              <dt className="inline">source: </dt>
              <dd className="inline font-mono">{summary.source}</dd>
            </div>
          ) : null}
          {summary.featureKey ? (
            <div data-testid="questionnaire-history-meta-feature-key">
              <dt className="inline">featureKey: </dt>
              <dd className="inline font-mono">{summary.featureKey}</dd>
            </div>
          ) : null}
        </dl>
      </header>
      <ul
        className="webui-questionnaire-history-answers flex flex-col gap-2"
        data-testid="questionnaire-history-answers"
      >
        {answers.map((answer, index) => (
          <li
            key={`${requestId}-${index}`}
            className="webui-questionnaire-history-answer flex flex-col gap-1 text-size_14"
            data-testid={`questionnaire-history-answer-${index}`}
          >
            <strong
              className="text-text_default_primary"
              data-testid={`questionnaire-history-answer-${index}-question`}
            >
              {answer.question}
            </strong>
            <ul className="flex flex-col gap-1 pl-4">
              {answer.labels.map((label, labelIndex) => (
                <li
                  key={`${requestId}-${index}-${labelIndex}`}
                  className="webui-questionnaire-history-label flex items-start gap-2 list-disc text-text_default_secondary"
                  data-testid={`questionnaire-history-answer-${index}-label-${labelIndex}`}
                >
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {typeof timestamp === "number" ? (
        <span
          className="text-text_default_tertiary text-size_12"
          data-testid="questionnaire-history-timestamp"
        >
          {formatWebuiMessageTimestamp(timestamp)}
        </span>
      ) : null}
    </article>
  );
}

export function WebuiRewindDialog({
  messageId,
  preview,
  loading,
  error,
  busy,
  onClose,
  onConfirm,
}: {
  readonly messageId: string;
  readonly preview?: WebuiGetSessionRewindPreviewResult;
  readonly loading: boolean;
  readonly error?: string;
  readonly busy: boolean;
  readonly onClose: () => void;
  readonly onConfirm: (rewindTurnDiff: boolean) => void;
}): ReactElement {
  const files = preview?.turns.flatMap((turn) => turn.files) ?? [];
  const turns = preview?.turns.length ?? 1;
  return (
    <div className="webui-message-dialog" role="dialog" aria-modal="true" data-testid="rewind-preview-dialog" data-message-id={messageId}>
      <div className="webui-message-dialog-surface">
        <h3>{"回退"}</h3>
        <p>{files.length > 0 ? `${turns} 轮对话将会回退 · ${files.length} 个文件将被修改。` : `${turns} 轮对话将会回退，不涉及任何文件改动。`}</p>
        <section data-testid="rewind-preview-files">
          <h4>受影响的文件改动</h4>
          {loading ? <p>正在检查当前文件…</p> : null}
          {!loading && error ? <p role="alert">暂时无法读取文件预览，仍可选择仅回退对话。</p> : null}
          {!loading && !error && files.length === 0 ? <p>没有受影响的文件改动。</p> : null}
          {files.map((file) => <div key={`${file.filePath}-${file.action}`} className="webui-rewind-file-row"><span>{file.filePath}</span><span>{file.skipped ? "跳过" : file.action}</span></div>)}
        </section>
        <div className="webui-message-dialog-actions">
          <button type="button" onClick={onClose} disabled={busy}>取消</button>
          <button type="button" onClick={() => onConfirm(false)} disabled={busy} data-testid="rewind-confirm-only">仅回退对话</button>
          {files.length > 0 ? <button type="button" onClick={() => onConfirm(true)} disabled={busy} data-testid="rewind-confirm-with-files">回退对话和文件</button> : null}
        </div>
      </div>
    </div>
  );
}

export function WebuiSessionTranscript({
  sessionId,
  loadMessages,
  initialMessages,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
}: {
  readonly sessionId: string;
  readonly loadMessages: WebuiClientMessageLoader;
  readonly initialMessages?: WebuiClientMessagePage;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly getSessionForkOptions?: WebuiTransport["getSessionForkOptions"];
  readonly forkSession?: WebuiTransport["forkSession"];
  readonly getSessionRewindPreview?: WebuiTransport["getSessionRewindPreview"];
  readonly rewindSession?: WebuiTransport["rewindSession"];
  readonly editSessionMessage?: WebuiTransport["editSessionMessage"];
}): ReactElement {
  const [page, setPage] = useState<WebuiClientMessagePage>(
    () => initialMessages ?? {},
  );
  const [loading, setLoading] = useState(initialMessages === undefined);
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
  // The right-rail navigator's tick list mirrors the assistant turns visible
  // on the page. A user turn isn't a tick — only the assistant block that
  // follows it counts. The first assistant group is `active` while we have
  // nothing settled; the last is `running` while streaming is live.
  const turns = useMemo<readonly TurnSummary[]>(() => {
    const assistantGroups = groups.filter((group) =>
      group.items.some((item) => item.kind === "assistant"),
    );
    if (assistantGroups.length === 0) return [];
    const lastIndex = assistantGroups.length - 1;
    return assistantGroups.map((group, index) => ({
      id: group.messageId,
      state:
        index === lastIndex && streamPhase === "streaming"
          ? "running"
          : index === 0
            ? "active"
            : "default",
    }));
  }, [groups, streamPhase]);
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
      className="message-container-viewport scrollbar-hide webui-session-transcript-scroll relative flex w-full flex-col"
      data-webui-session-transcript-scroll="true"
    >
      <div
        className="message-list flex w-full flex-col gap-spacing_8"
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
        {loading && items.length === 0 ? <ChatSkeleton /> : null}
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
        {groups.flatMap((group) => {
          const userItem = group.items.find(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "user",
          );
          const questionnaireResponseItem = group.items.find(
            (
              item,
            ): item is Extract<
              WebuiTranscriptItem,
              { kind: "questionnaire_response" }
            > => item.kind === "questionnaire_response",
          );
          const result: ReactElement[] = [];
          if (questionnaireResponseItem) {
            result.push(
              <WebuiQuestionnaireResponse
                key={`${group.messageId}-questionnaire`}
                messageId={group.messageId}
                summary={questionnaireResponseItem.summary}
                timestamp={questionnaireResponseItem.timestamp}
              />,
            );
          }
          if (userItem)
            result.push(
              <MessageItem
                key={group.messageId}
                messageId={group.messageId}
                role="user"
                userText={userItem.text}
                actions={userItem.actions}
                timestamp={userItem.timestamp}
                isGoal={userItem.isGoal}
                getSessionForkOptions={getSessionForkOptions}
                forkSession={forkSession}
                getSessionRewindPreview={getSessionRewindPreview}
                rewindSession={rewindSession}
                editSessionMessage={editSessionMessage}
              />,
            );
          if (result.length > 0) return result;
          // Fall through to the assistant-group renderer below.
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
          const initialDiff = [...group.items]
            .reverse()
            .find((item): item is Extract<WebuiTranscriptItem, { diff?: WebuiTurnDiffView }> =>
              "diff" in item,
            )?.diff;
          return (
            <MessageItem
              key={group.messageId}
              messageId={group.messageId}
              role="assistant"
              sessionId={sessionId}
              assistantMessageId={group.messageId}
              {...(group.turnId ? { turnId: group.turnId } : {})}
              initialDiff={initialDiff}
              getTurnDiff={getTurnDiff}
              revertTurnDiff={revertTurnDiff}
              reapplyTurnDiff={reapplyTurnDiff}
              actions={group.items.find((item): item is Extract<WebuiTranscriptItem, { actions?: WebuiMessageActionCapabilities }> =>
                "actions" in item,
              )?.actions}
              getSessionForkOptions={getSessionForkOptions}
              forkSession={forkSession}
              getSessionRewindPreview={getSessionRewindPreview}
              rewindSession={rewindSession}
              editSessionMessage={editSessionMessage}
              thinking={
                thinkingItems.length > 0
                  ? thinkingItems.map((item) => item.text).join("\n\n")
                  : undefined
              }
              thinkingDurationMs={thinkingItems[0]?.durationMs}
              tools={tools.length > 0 ? tools : undefined}
              answers={answers.map((item) => item.text)}
              attachments={answers[0]?.attachments}
              totalRequestDurationMs={group.totalRequestDurationMs}
              totalOutputTokens={group.totalOutputTokens}
              wallClockDurationMs={group.wallClockDurationMs}
            />
          );
        })}
        {streamPhase === "streaming" ? (
          <MessageViewportStreamingLoader testId="webui-transcript-viewport-loader" />
        ) : null}
      </div>
      <TurnNavigator turns={turns} />
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
// (WebuiComposerSubmitArgs, WebuiComposerSubmitHandlers, buildWebuiComposerHandlers,
//  submitWebuiComposerTurn moved to ./projection/composer-state.ts in W2)

// (eventSessionId, pendingPermissionFromEvent, questionnaireFromEvent, replacePermission
//  moved to ./projection/transcript-projection.ts in W2)

// (optionIdsForStep moved to ./projection/questionnaire-state.ts in W2)

// (sortWebuiQuestionnaireOptions, canAdvanceWebuiQuestionnaireStep,
//  toggleWebuiQuestionnaireOption, buildWebuiQuestionnaireAnswers
//  moved to ./projection/questionnaire-state.ts in W2)

// (projectWebuiThreadGoalMessage, WEBUI_GOAL_STATUS_COPY, WEBUI_GOAL_WAIT_COPY,
//  formatWebuiGoalDuration, WebuiGoalPatchBuildResult, buildWebuiGoalEditPatch,
//  buildWebuiGoalStatusPatch moved to ./projection/goal-state.ts in W2)

export function WebuiGoalBanner({
  goal,
  patchGoal,
  clearGoal,
  onReplace,
  isGenerating = false,
  interactionBlocked = false,
}: {
  readonly goal?: WebuiGoal;
  readonly patchGoal?: WebuiTransport["patchGoal"];
  readonly clearGoal?: WebuiTransport["clearGoal"];
  readonly onReplace?: () => void;
  readonly isGenerating?: boolean;
  readonly interactionBlocked?: boolean;
}): ReactElement | null {
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [budget, setBudget] = useState(goal?.tokenBudget ? String(goal.tokenBudget) : "");
  const [updated, setUpdated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    setObjective(goal?.objective ?? "");
    setBudget(goal?.tokenBudget ? String(goal.tokenBudget) : "");
    if (!goal) setEditing(false);
  }, [goal?.goalId, goal?.objective, goal?.tokenBudget]);
  useEffect(() => {
    if (!goal || goal.status !== "active" || goal.executionWait) {
      setElapsedSeconds(0);
      return undefined;
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - goal.updatedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [goal]);
  if (!goal) return null;
  const status = updated ? "updated" : goal.status;
  const submitPatch = (patch: { status?: WebuiGoalStatus; objective?: string; tokenBudget?: number | null }) => {
    if (!patchGoal) return;
    setBusy(true);
    setError(undefined);
    void patchGoal({ sessionId: goal.sessionId, ...patch })
      .then(() => { setUpdated(true); setEditing(false); window.setTimeout(() => setUpdated(false), 2_400); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  const saveEdit = () => {
    const result = buildWebuiGoalEditPatch(objective, budget);
    if (!result.ok) { setError(result.error); return; }
    submitPatch(result.patch);
  };
  const clear = () => {
    if (!clearGoal) return;
    setBusy(true);
    void clearGoal({ sessionId: goal.sessionId })
      .then(() => setConfirmClear(false))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="webui-goal-banner" data-testid="thread-goal-banner" data-goal-status={status} role="status" aria-live="polite">
      <div className="webui-goal-banner-content-row" data-testid="thread-goal-banner-content-row">
        <div className="webui-goal-banner-objective-group" data-testid="thread-goal-banner-objective-group">
          <span aria-hidden="true">🎯</span>
          <button type="button" className="webui-goal-objective" data-testid="thread-goal-banner-objective" aria-expanded={false} title={goal.objective}>{goal.objective}</button>
          <span className="webui-goal-status" data-testid="thread-goal-banner-status">{WEBUI_GOAL_STATUS_COPY[status]}</span>
        </div>
        <div className="webui-goal-banner-actions-slot" data-testid="thread-goal-banner-actions-slot">
          {goal.status === "blocked" ? <button type="button" data-testid="thread-goal-banner-resume" onClick={() => submitPatch({ status: "active" })} disabled={busy || interactionBlocked}>继续</button> : null}
          {goal.status === "paused" || goal.status === "usage_limited" ? <button type="button" data-testid="thread-goal-banner-resume" onClick={() => submitPatch({ status: "active" })} disabled={busy || interactionBlocked}>继续</button> : null}
          {goal.status === "active" && !goal.executionWait ? <button type="button" data-testid="thread-goal-banner-pause" onClick={() => submitPatch({ status: "paused" })} disabled={busy || interactionBlocked}>暂停</button> : null}
          <button type="button" data-testid="thread-goal-banner-edit-button" onClick={() => setEditing((value) => !value)} disabled={busy || interactionBlocked || (goal.status === "complete")}>编辑</button>
          {onReplace ? <button type="button" data-testid="thread-goal-banner-replace-button" onClick={onReplace} disabled={busy || interactionBlocked}>替换目标</button> : null}
          {goal.status !== "complete" ? <button type="button" data-testid="thread-goal-banner-clear" onClick={() => setConfirmClear(true)} disabled={busy || interactionBlocked}>清除目标</button> : <button type="button" data-testid="thread-goal-banner-close" onClick={() => setConfirmClear(true)} disabled={busy}>关闭</button>}
        </div>
      </div>
      {goal.executionWait ? <div className="webui-goal-wait" data-testid="thread-goal-wait">{WEBUI_GOAL_WAIT_COPY[goal.executionWait.reason] ?? WEBUI_GOAL_WAIT_COPY.unknown}</div> : null}
      <div className="webui-goal-usage" data-testid="thread-goal-usage"><span data-testid="thread-goal-tokens-used">{goal.tokensUsed} tokens</span><span data-testid="thread-goal-turns-used">{goal.turnsUsed} 轮</span><span data-testid="thread-goal-timer">{formatWebuiGoalDuration(goal.timeUsedSeconds + elapsedSeconds)}</span></div>
      {goal.status === "budget_limited" ? <p data-testid="thread-goal-banner-budget-guide">创建新目标后继续</p> : null}
      {goal.status === "usage_limited" ? <p data-testid="thread-goal-usage-guide">服务商额度恢复后可继续</p> : null}
      {goal.status === "complete" ? <span data-testid="thread-goal-completion-marker" className="webui-goal-completion-marker">目标已完成</span> : null}
      {editing ? <div className="webui-goal-editor" data-testid="goal-editor"><textarea data-testid="thread-goal-banner-edit-input" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="更新目标内容" /><input data-testid="thread-goal-banner-budget-input" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="Token 预算 — 例如 50K、200000；留空表示取消" /><div><button type="button" data-testid="thread-goal-banner-cancel-edit" onClick={() => setEditing(false)} disabled={busy}>取消</button><button type="button" data-testid="thread-goal-banner-save" onClick={saveEdit} disabled={busy}>保存</button></div></div> : null}
      {confirmClear ? <div className="webui-goal-confirm" data-testid="goal-clear-confirm"><strong>删除目标？</strong><p>删除目标后，目标模式会关闭，转为普通模式继续。</p><button type="button" onClick={() => setConfirmClear(false)} disabled={busy}>取消</button><button type="button" data-testid="goal-clear-confirm-confirm" onClick={clear} disabled={busy}>删除</button></div> : null}
      {error ? <p role="alert" data-testid="thread-goal-error">{error}</p> : null}
      {isGenerating ? <span data-testid="thread-goal-generating" aria-hidden="true" /> : null}
    </section>
  );
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
  const [currentStep, setCurrentStep] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState<number | undefined>(() =>
    questionnaire?.expiresAt === undefined
      ? undefined
      : Math.max(0, Math.ceil((questionnaire.expiresAt - Date.now()) / 1000)),
  );
  useEffect(() => {
    setSelections({});
    setOtherSelections({});
    setOtherTexts({});
    setCurrentStep(0);
  }, [questionnaire?.id]);
  useEffect(() => {
    if (!questionnaire?.expiresAt) {
      setRemainingSeconds(undefined);
      return undefined;
    }
    const update = () => setRemainingSeconds(Math.max(0, Math.ceil((questionnaire.expiresAt! - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [questionnaire?.expiresAt]);
  const visiblePermissions = permissions.filter(
    (permission) => permission.sessionId === sessionId,
  );
  const activeStep = questionnaire?.steps[currentStep];
  const activeSelected = activeStep ? optionIdsForStep(selections, activeStep.id) : [];
  const activeOther = activeStep ? otherSelections[activeStep.id] === true : false;
  const activeStepValid = canAdvanceWebuiQuestionnaireStep(
    activeStep,
    activeSelected,
    activeOther,
    otherTexts[activeStep?.id ?? ""] ?? "",
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
          className="webui-card flex max-h-[60vh] flex-col gap-3 overflow-hidden rounded-[20px] border-[0.5px] border-border_default bg-bg_grouped_secondary_elevated p-spacing_16"
          data-testid="questionnaire-composer"
          data-webui-questionnaire-request={questionnaire.id}
          aria-label={questionnaire.title ?? "Questionnaire"}
        >
          <header className="webui-questionnaire-header">
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
              data-testid="questionnaire-close"
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
            {questionnaire.steps.length > 1 && questionnaire.presentation.showProgress ? (
              <span className="webui-questionnaire-progress" data-testid="questionnaire-progress" aria-label={`${currentStep + 1}/${questionnaire.steps.length}`}>
                <button type="button" data-testid="questionnaire-progress-prev" aria-label="上一步" onClick={() => setCurrentStep((value) => Math.max(0, value - 1))} disabled={submitting || !questionnaire.presentation.allowBackNavigation || currentStep === 0}>‹</button>
                <span>{currentStep + 1}/{questionnaire.steps.length}</span>
                <button type="button" data-testid="questionnaire-progress-next" aria-label="下一步" onClick={() => setCurrentStep((value) => Math.min(questionnaire.steps.length - 1, value + 1))} disabled={submitting || currentStep >= questionnaire.steps.length - 1}>›</button>
              </span>
            ) : null}
          </header>
          <p
            className="webui-questionnaire-sub"
            data-webui-questionnaire-waiting="true"
          >
            智能体需要你的回答
          </p>
          {remainingSeconds !== undefined ? <span className="webui-questionnaire-countdown" data-testid="questionnaire-auto-reply-countdown" title={`将在 ${remainingSeconds} 秒后自动提交`}>⏱ {remainingSeconds}s</span> : null}
          <div data-testid="questionnaire-composer-body">
          {questionnaire.steps.slice(currentStep, currentStep + 1).map((step) => {
            const selected = optionIdsForStep(selections, step.id);
            const selectedOther = otherSelections[step.id] === true;
            const multiple =
              step.selectionMode === 1 ||
              (step.selectionMode as unknown) === "multiple";
            return (
              <fieldset key={step.id} className="mb-4" data-testid={`questionnaire-step-${step.id}`}>
                <legend
                  className="text-size_14 font-weight_medium"
                  data-webui-questionnaire-question="true"
                  data-testid={`questionnaire-step-title-${step.id}`}
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
                {multiple ? <span className="webui-questionnaire-multi-hint" data-testid={`questionnaire-multi-hint-${step.id}`}>可多选</span> : null}
                {sortWebuiQuestionnaireOptions(step.options ?? []).map((option, optionIndex) => {
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
                              [step.id]: toggleWebuiQuestionnaireOption(selected, option.id, multiple),
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
          {activeStep && (activeStep.options?.length ?? 0) === 0 && !activeStep.allowOther ? (
            <p className="text-text_default_secondary text-size_12" data-testid="questionnaire-composer-empty">
              当前步骤没有可选项。
            </p>
          ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            {questionnaire.steps.length > 1 && currentStep > 0 ? <button type="button" className="webui-button-secondary text-size_14" disabled={submitting} data-testid="questionnaire-back" onClick={() => setCurrentStep((value) => Math.max(0, value - 1))}>上一步</button> : null}
            {questionnaire.steps.length > 1 && currentStep < questionnaire.steps.length - 1 ? <button type="button" className="webui-button-primary text-size_14" disabled={submitting || !activeStepValid} data-testid="questionnaire-next" onClick={() => setCurrentStep((value) => Math.min(questionnaire.steps.length - 1, value + 1))}>下一步</button> : null}
            <button
              type="button"
              className="webui-button-primary text-size_14"
              disabled={
                submitting ||
                currentStep < questionnaire.steps.length - 1 || !questionnaire.steps.every((step) => {
                  if (!step.required) return true;
                  if (otherSelections[step.id] === true)
                    return Boolean((otherTexts[step.id] ?? "").trim());
                  return optionIdsForStep(selections, step.id).length > 0;
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
        <p role="alert" data-testid="questionnaire-error" className="text-text_default_secondary text-size_12">
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
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
  getGoal,
  createGoal,
  patchGoal,
  clearGoal,
  isGoalEnabled,
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
  readonly runCommand?: (request: { readonly command: "help" | "new" | "compact" | "status" | "usage" | "model"; readonly input?: string; readonly sessionId?: string; readonly agentName?: string; readonly workspaceDir?: string; }) => Promise<Record<string, unknown>>;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiTransport["loadMessages"];
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly getSessionForkOptions?: WebuiTransport["getSessionForkOptions"];
  readonly forkSession?: WebuiTransport["forkSession"];
  readonly getSessionRewindPreview?: WebuiTransport["getSessionRewindPreview"];
  readonly rewindSession?: WebuiTransport["rewindSession"];
  readonly editSessionMessage?: WebuiTransport["editSessionMessage"];
  readonly getGoal?: (request: WebuiGoalSessionRequest) => Promise<WebuiGoal | undefined>;
  readonly createGoal?: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;
  readonly patchGoal?: WebuiTransport["patchGoal"];
  readonly clearGoal?: WebuiTransport["clearGoal"];
  readonly isGoalEnabled?: () => Promise<WebuiGoalEnabledResult>;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly listPendingPermissions?: () => Promise<{ readonly requests: readonly WebuiPendingPermission[] }>;
  readonly getPendingQuestionnaire?: (request: { readonly name: string; readonly sessionId: string }) => Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  readonly replyPermission?: (request: { readonly name: string; readonly requestId: string; readonly reply: "allowOnce" | "allowAlways" | "deny" }) => Promise<WebuiInteractionReplyResult>;
  readonly replyQuestionnaire?: (request: { readonly name: string; readonly requestId: string; readonly schemaVersion: number; readonly answers: readonly WebuiQuestionnaireAnswer[] }) => Promise<WebuiInteractionReplyResult>;
  readonly dismissQuestionnaire?: (request: { readonly name: string; readonly requestId: string }) => Promise<WebuiInteractionReplyResult>;
  readonly abortSession?: (request: { readonly id: string }) => Promise<{ readonly success?: boolean }>;
  readonly listQueueMessages?: (request: { readonly id: string }) => Promise<{ readonly items?: readonly WebuiQueueItem[]; readonly paused?: boolean; readonly pendingCount?: number }>;
  readonly deleteQueueItem?: (request: { readonly id: string; readonly itemId: string }) => Promise<{ readonly item?: WebuiQueueItem }>;
  readonly listModels?: (request?: { readonly sessionId?: string }) => Promise<readonly WebuiModelEntry[]>;
  readonly listSkills?: (request?: { readonly agentName?: string }) => Promise<{ readonly skills: readonly { readonly name: string; readonly displayName?: string; readonly description?: string }[] }>;
  readonly selectModel?: (request: WebuiModelSelectionRequest) => Promise<{ readonly success?: boolean }>;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<Record<string, unknown>>;
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
  const [goal, setGoal] = useState<WebuiGoal>();
  const [goalEnabled, setGoalEnabled] = useState(true);
  const [replaceObjective, setReplaceObjective] = useState<string>();
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
    // Runtime event protocol: the pure decision lives in
    // `reduceWebuiEffect`, the ordered setter calls in
    // `applyWebuiEffectCommands`. The order of setter calls, the exception
    // swallowing on `refreshPending`, and the `cancelled` guard around its
    // post-await writes are load-bearing — do not reorder them.
    const unsubscribe = watchEvents?.((event) => {
      const commands = reduceWebuiEffect(
        {
          stream,
          permissions,
          questionnaire,
          goal,
        },
        event,
        sessionId,
      ).commands;
      applyWebuiEffectCommands(commands, {
        // The original closure called `refreshPending()` unconditionally
        // and let its own `if (cancelled) return;` guard drop post-await
        // writes. The executor only owns the catch-swallow — we don't
        // add a second `cancelled` gate here.
        refreshPending: () => {
          void refreshPending().catch(() => undefined);
        },
        setSending,
        setStream,
        setPermissions,
        setQuestionnaire,
        setGoal,
      });
    });
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
    if (!isGoalEnabled) {
      setGoalEnabled(true);
      return undefined;
    }
    let cancelled = false;
    void isGoalEnabled()
      .then((result) => { if (!cancelled) setGoalEnabled(result.enabled); })
      .catch(() => { if (!cancelled) setGoalEnabled(false); });
    return () => { cancelled = true; };
  }, [isGoalEnabled]);

  useEffect(() => {
    if (!sessionId || !getGoal || !goalEnabled) {
      setGoal(undefined);
      return undefined;
    }
    let cancelled = false;
    void getGoal({ sessionId })
      .then((nextGoal) => {
        if (!cancelled) setGoal(nextGoal);
      })
      .catch(() => {
        if (!cancelled) setGoal(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [getGoal, goalEnabled, sessionId]);

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
  const createGoalFromPrompt = () => {
    if (!sessionId || !createGoal || typeof window === "undefined") return;
    const objective = window.prompt("描述你想完成的目标")?.trim();
    if (!objective) return;
    if (goal) {
      setReplaceObjective(objective);
      return;
    }
    void createGoal({ sessionId, objective })
      .then(setGoal)
      .catch((error: unknown) => setInteractionError(error instanceof Error ? error.message : String(error)));
  };
  const confirmGoalReplacement = async () => {
    if (!sessionId || !replaceObjective || !createGoal || !clearGoal) return;
    try {
      await clearGoal({ sessionId });
      const nextGoal = await createGoal({ sessionId, objective: replaceObjective });
      setGoal(nextGoal);
      setReplaceObjective(undefined);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <section
      aria-label="Compose message"
      className={`w-full ${sessionLayout ? "webui-session-composer" : ""}`}
      data-webui-session-composer={sessionLayout ? "true" : undefined}
    >
      {sessionId && goalEnabled && goal ? <WebuiGoalBanner goal={goal} patchGoal={patchGoal} clearGoal={clearGoal} onReplace={createGoalFromPrompt} interactionBlocked={Boolean(questionnaire || permissions.length > 0)} /> : null}
      {sessionId && goalEnabled && !goal && createGoal ? <button type="button" className="webui-goal-create" data-testid="thread-goal-create" onClick={createGoalFromPrompt}>设置目标</button> : null}
      {replaceObjective ? <div className="webui-goal-confirm" data-testid="goal-replace-confirm" role="dialog"><strong>替换当前目标？</strong><p>用本次文字和注释替换已保存的目标。</p><button type="button" onClick={() => setReplaceObjective(undefined)}>取消</button><button type="button" data-testid="goal-replace-confirm-confirm" onClick={() => void confirmGoalReplacement()}>替换目标</button></div> : null}
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
            .flatMap((message) => {
              const stripped = stripQuestionnaireResponse(message.answer);
              const items: ReactElement[] = [];
              if (stripped.questionnaire) {
                items.push(
                  <WebuiQuestionnaireResponse
                    key={`${message.id}-questionnaire`}
                    messageId={message.id}
                    summary={stripped.questionnaire}
                    timestamp={message.timestamp}
                  />,
                );
              }
              items.push(
                <MessageItem
                  key={message.id}
                  messageId={message.id}
                  role="user"
                  userText={stripped.content}
                  timestamp={message.timestamp}
                  isGoal={message.isGoal}
                  streamMessageId={message.id}
                />,
              );
              return items;
            })}
          {stream.phase === "reconnecting" ? (
            <MessagePassiveLoadingPlaceholder label="重连中…" />
          ) : null}
          {(() => {
            const assistant = stream.messages.filter(
              (message) => message.role !== "user",
            );
            // Pending user just landed but the assistant has not yet sent a
            // frame: the desktop shows the post-query placeholder so the live
            // column has a single owner between the user bubble and the
            // first assistant body. Skip it once an assistant frame is in.
            if (assistant.length === 0) {
              if (
                stream.messages.some((message) => message.role === "user") &&
                stream.phase === "waiting"
              ) {
                return <MessageAfterQueryStreamingPlaceholder />;
              }
              // Stream is in flight but no thinking yet — pulse the rose
              // loader so the live column reads as active.
              if (stream.phase === "streaming" || stream.phase === "waiting") {
                return <ActivityIndicator />;
              }
              return null;
            }
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
            // Aggregate the runtime-measured `usage` across every assistant
            // frame the live column has seen so the Desktop-style "共执行 N
            // 分 M 秒 · {rate} token/s" row renders with real numbers.
            const totalRequestDurationMs = assistant.reduce((sum, message) => {
              const usage = message.usage;
              const value = readUsageNumber(usage, "requestDurationMs", "request_duration_ms");
              return typeof value === "number" && Number.isFinite(value)
                ? sum + value
                : sum;
            }, 0);
            const totalOutputTokens = assistant.reduce((sum, message) => {
              const usage = message.usage;
              const value = readUsageNumber(usage, "outputTokens", "output_tokens");
              return typeof value === "number" && Number.isFinite(value)
                ? sum + value
                : sum;
            }, 0);
            // One turn, one block: the server splits a reply across several
            // `msg_id`s (one per tool round) and each carries its own
            // thinking — desktop shows a single disclosure for the whole
            // turn, so merge here instead of rendering N live bodies.
            return (
              <>
                <MessageItem
                  messageId="stream-live"
                  role="assistant"
                  sessionId={sessionId}
                  assistantMessageId={assistant[assistant.length - 1]?.id}
                  getTurnDiff={getTurnDiff}
                  revertTurnDiff={revertTurnDiff}
                  reapplyTurnDiff={reapplyTurnDiff}
                  streamMessageId="merged"
                  messageRootId="merged"
                  thinking={thinking || undefined}
                  tools={tools.length > 0 ? tools : undefined}
                  answers={answers}
                  streaming={stream.phase === "streaming"}
                  processingStartedAtMs={stream.processingStartedAtMs}
                  totalRequestDurationMs={
                    totalRequestDurationMs > 0 ? totalRequestDurationMs : undefined
                  }
                  totalOutputTokens={
                    totalOutputTokens > 0 ? totalOutputTokens : undefined
                  }
                />
                {stream.phase === "streaming" && answers.length === 0 && !thinking.trim() ? (
                  <ActivityIndicator />
                ) : null}
              </>
            );
          })()}
          {stream.refusal ? (
            <OutputError
              variant="output_error"
              text={stream.refusal}
              errorAt={Date.now()}
              {...(abortSession ? { onRetry: () => void abortSession({ id: sessionId ?? "" }) } : {})}
            />
          ) : null}
          {stream.transcriptIncomplete ? (
            <OutputError
              variant="output_error"
              text="上一轮回复未完整送达，请重新发送以继续。"
              errorAt={Date.now()}
            />
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
        className={`relative ${sessionLayout ? "mt-0 webui-session-composer-overlay" : "mt-8"} w-full`}
        data-webui-composer-region="true"
        data-webui-session-composer-overlay={sessionLayout ? "true" : undefined}
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

        {!sessionLayout ? (
          <>
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
          </>
        ) : null}
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

export function WebuiClientFoundationApp(
  props: WebuiClientFoundationAppProps,
): ReactElement {
  const {
    label,
    sessionPage,
    initialMessages,
    initialUsageQuota,
    version,
    locationHash,
    dataDir,
    hostLabel,
    transport,
  } = props;
  // Each method comes from `transport`. Re-binding to the same local
  // name as before keeps the rest of the function body identical.
  const loadSessions = transport?.loadSessions;
  const loadSessionTree = transport?.loadSessionTree;
  const listArchivedSessions = transport?.listArchivedSessions;
  const loadMessages = transport?.loadMessages;
  const getTurnDiff = transport?.getTurnDiff;
  const revertTurnDiff = transport?.revertTurnDiff;
  const reapplyTurnDiff = transport?.reapplyTurnDiff;
  const getSessionRewindPreview = transport?.getSessionRewindPreview;
  const rewindSession = transport?.rewindSession;
  const editSessionMessage = transport?.editSessionMessage;
  const isGoalEnabled = transport?.isGoalEnabled;
  const getGoal = transport?.getGoal;
  const createGoal = transport?.createGoal;
  const patchGoal = transport?.patchGoal;
  const clearGoal = transport?.clearGoal;
  const listWorkspaceFileTree = transport?.listWorkspaceFileTree;
  const readWorkspaceFile = transport?.readWorkspaceFile;
  const getWorkspaceEnvironment = transport?.getWorkspaceEnvironment;
  const mutateWorkspaceGit = transport?.mutateWorkspaceGit;
  const readCanvas = transport?.readCanvas;
  const applyCanvas = transport?.applyCanvas;
  const createTerminal = transport?.createTerminal;
  const listTerminals = transport?.listTerminals;
  const writeTerminal = transport?.writeTerminal;
  const disposeTerminal = transport?.disposeTerminal;
  const watchTerminal = transport?.watchTerminal;
  const createSession = transport?.createSession;
  const sendMessage = transport?.sendMessage;
  const enqueueMessage = transport?.enqueueMessage;
  const resumeSession = transport?.resumeSession;
  const watchEvents = transport?.watchEvents;
  const listPendingPermissions = transport?.listPendingPermissions;
  const getPendingQuestionnaire = transport?.getPendingQuestionnaire;
  const replyPermission = transport?.replyPermission;
  const replyQuestionnaire = transport?.replyQuestionnaire;
  const dismissQuestionnaire = transport?.dismissQuestionnaire;
  const abortSession = transport?.abortSession;
  const listQueueMessages = transport?.listQueueMessages;
  const deleteQueueItem = transport?.deleteQueueItem;
  const listModels = transport?.listModels;
  const listSkills = transport?.listSkills;
  const selectModel = transport?.selectModel;
  const getSessionUsage = transport?.getSessionUsage;
  const getUsageQuota = transport?.getUsageQuota;
  const getSigninPanel = transport?.getSigninPanel;
  const claimSignin = transport?.claimSignin;
  const getAccountStatus = transport?.getAccountStatus;
  const signOut = transport?.signOut;
  const getVersion = transport?.version;
  const archiveSession = transport?.archiveSession;
  const deleteSession = transport?.deleteSession;
  const updateSession = transport?.updateSession;
  const getSessionForkOptions = transport?.getSessionForkOptions;
  const forkSession = transport?.forkSession;
  const listUserModelProviders = transport?.listUserModelProviders;
  const createUserModelProvider = transport?.createUserModelProvider;
  const updateUserModelProvider = transport?.updateUserModelProvider;
  const deleteUserModelProvider = transport?.deleteUserModelProvider;
  const testUserModelProvider = transport?.testUserModelProvider;
  const testUserModel = transport?.testUserModel;
  const discoverUserModelsCandidate = transport?.discoverUserModelsCandidate;
  const saveUserModelProviderCandidate = transport?.saveUserModelProviderCandidate;
  const listProviderPresets = transport?.listProviderPresets;
  const getMiniMaxApiKeyStatus = transport?.getMiniMaxApiKeyStatus;
  const upsertMiniMaxApiKey = transport?.upsertMiniMaxApiKey;
  const getCodexOAuthStatus = transport?.getCodexOAuthStatus;
  const runCommand = transport?.runCommand;

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
  const [usageQuota, setUsageQuota] = useState<WebuiUsageQuotaResult | undefined>(
    () => initialUsageQuota,
  );
  const [pinnedSessions, setPinnedSessions] = useState<Record<string, boolean>>(
    readSessionOverlay("pins"),
  );
  const [pinnedProjects, setPinnedProjects] = useState<Record<string, boolean>>(
    readProjectPins,
  );
  const [projectNames, setProjectNames] = useState<Record<string, string>>(
    readProjectNames,
  );
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
  // Cloud usage quota for the conversation banner. The runtime exposes
  // getUsageQuota when a bearer lease is available; we only fetch once per
  // session switch so the banner reflects the user's current state without
  // re-fetching on every render.
  useEffect(() => {
    if (!getUsageQuota) {
      setUsageQuota(undefined);
      return undefined;
    }
    let cancelled = false;
    void getUsageQuota()
      .then((next) => {
        if (!cancelled) setUsageQuota(next);
      })
      .catch(() => {
        if (!cancelled) setUsageQuota(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [getUsageQuota]);
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
  const refreshRail = async () => {
    const [nextPage, nextTree] = await Promise.all([
      loadSessions?.(),
      loadSessionTree?.(),
    ]);
    if (nextPage) {
      setPage(nextPage);
      setPageError(undefined);
    }
    if (nextTree) setTreePage(nextTree);
  };
  const handleRenameProject = (project: WebuiProjectGroup) => {
    if (typeof window === "undefined") return;
    const next = window.prompt("重命名项目", projectNames[project.key] ?? project.name)?.trim();
    if (next) setProjectNames(writeProjectName(project.key, next));
  };
  const handleToggleProjectPin = (project: WebuiProjectGroup) => {
    setPinnedProjects(toggleProjectPin(project.key));
  };
  const handleRenameSession = (session: WebuiClientSession) => {
    if (!updateSession || typeof window === "undefined") return;
    const next = window.prompt("重命名", sessionLabel(session))?.trim();
    if (!next || next === sessionLabel(session)) return;
    void updateSession({ id: session.sessionId, title: next })
      .then((result) => {
        const title = result.session?.title;
        if (title) {
          setPage((current) => ({
            ...current,
            sessions: current.sessions.map((candidate) =>
              candidate.sessionId === session.sessionId ? { ...candidate, title } : candidate,
            ),
          }));
          setTreePage((current) => ({
            ...current,
            sessions: current.sessions.map((node) => ({
              ...node,
              session: node.session.sessionId === session.sessionId ? { ...node.session, title } : node.session,
              childSessions: node.childSessions.map((candidate) =>
                candidate.sessionId === session.sessionId ? { ...candidate, title } : candidate,
              ),
            })),
          }));
        }
        return refreshRail();
      })
      .catch((reason: unknown) => setPageError(reason instanceof Error ? reason.message : String(reason)));
  };
  const handleToggleSessionPin = (session: WebuiClientSession) => {
    setPinnedSessions(toggleSessionOverlay("pins", session.sessionId));
  };
  const handleArchiveSession = (session: WebuiClientSession) => {
    if (!archiveSession) return;
    void archiveSession({ id: session.sessionId })
      .then(() => refreshRail())
      .catch((reason: unknown) => setPageError(reason instanceof Error ? reason.message : String(reason)));
  };
  const handleArchiveProject = (project: WebuiProjectGroup) => {
    if (!archiveSession) return;
    const ids = new Set(project.sessionIds);
    for (const node of treePage.sessions) {
      if (!project.sessionIds.includes(node.session.sessionId)) continue;
      for (const child of node.childSessions) ids.add(child.sessionId);
    }
    void Promise.all([...ids].map((id) => archiveSession({ id })))
      .then(() => refreshRail())
      .catch((reason: unknown) => setPageError(reason instanceof Error ? reason.message : String(reason)));
  };
  const handleForkSession = (session: WebuiClientSession, createIsolatedWorktree: boolean) => {
    if (!forkSession) return;
    void (async () => {
      const options = await getSessionForkOptions?.({ id: session.sessionId });
      if (options && !options.canFork)
        throw new Error(`当前会话不可复制：${options.unavailableReason ?? "没有可复制的消息边界"}`);
      if (createIsolatedWorktree && options && !options.worktreeVisible)
        throw new Error(`当前会话不可复制到新工作树：${options.worktreeUnavailableReason ?? "工作树不可用"}`);
      return forkSession({
        id: session.sessionId,
        clientRequestId: globalThis.crypto.randomUUID(),
        useSuggestedTitle: true,
        createIsolatedWorktree,
      });
    })()
      .then(async (result) => {
        await refreshRail();
        const id = result.session?.sessionId;
        if (id) {
          setSelectedSessionId(id);
          if (typeof window !== "undefined")
            window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${sessionHash(id)}`);
        }
      })
      .catch((reason: unknown) => setPageError(reason instanceof Error ? reason.message : String(reason)));
  };
  const handleCopySession = (session: WebuiClientSession, value: "workspaceDir" | "sessionId") => {
    const text = value === "workspaceDir" ? session.workspaceDir : session.sessionId;
    if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
    void navigator.clipboard.writeText(text);
  };
  const handleDeleteSession = (session: WebuiClientSession) => {
    if (!deleteSession) return;
    void deleteSession({ id: session.sessionId })
      .then(async () => {
        if (selectedSessionId === session.sessionId) {
          setSelectedSessionId(undefined);
          if (typeof window !== "undefined") window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
        }
        await refreshRail();
      })
      .catch((reason: unknown) => setPageError(reason instanceof Error ? reason.message : String(reason)));
  };
  const homeMode = !selectedSessionId;
  const usageNotice = useMemo(
    () => deriveConversationUsageNotice(usageQuota),
    [usageQuota],
  );
  // First-paint of the home page: the rail reads from the sessions list,
  // but the welcome hero appears regardless. Show the greeting skeleton
  // while the initial session page is still being fetched so the layout
  // doesn't flash an empty hero before the rail populates.
  const homeGreetingPending =
    homeMode && loadSessions !== undefined && page.sessions.length === 0 && loading;
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
    // Desktop's "new task without a project" action clears the pending
    // workspace choice. A project selected again on the home surface is still
    // passed to createSession; once a session exists, its workspace belongs to
    // the session and must not be cleared just because the picker is hidden.
    userClearedWorkspaceRef.current = true;
    writeNoProjectFlag(true);
    setNewTaskWorkspaceDir(undefined);
    setWorkspaceMenuOpen(false);
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
                        pinnedSessions={pinnedSessions}
                        pinnedProjects={pinnedProjects}
                        projectNames={projectNames}
                        onRenameProject={handleRenameProject}
                        onToggleProjectPin={handleToggleProjectPin}
                        onArchiveProject={handleArchiveProject}
                        onRenameSession={handleRenameSession}
                        onToggleSessionPin={handleToggleSessionPin}
                        onArchiveSession={handleArchiveSession}
                        onForkSession={handleForkSession}
                        onCopySession={handleCopySession}
                        onDeleteSession={handleDeleteSession}
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
                    homeGreetingPending ? (
                      <GreetingSkeleton />
                    ) : (
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
                    )
                  ) : (
                    <div className="flex w-full items-center gap-2">
                      <span className="text-text_default_secondary text-size_12 leading-line_height_16">
                        {selectedSession?.title ?? ""}
                      </span>
                    </div>
                  )}
                  {usageNotice ? (
                    <ConversationUsageBanner
                      notice={usageNotice}
                      messageText={
                        usageNotice.kind === "weekly"
                          ? "本周配额接近上限。"
                          : usageNotice.kind === "five_hour"
                            ? "五小时配额接近上限。"
                            : "本周期视频配额已用尽。"
                      }
                    />
                  ) : null}

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
                    getTurnDiff={getTurnDiff}
                    revertTurnDiff={revertTurnDiff}
                    reapplyTurnDiff={reapplyTurnDiff}
                    getSessionForkOptions={getSessionForkOptions}
                    forkSession={forkSession}
                    getSessionRewindPreview={getSessionRewindPreview}
                    rewindSession={rewindSession}
                    editSessionMessage={editSessionMessage}
                    getGoal={getGoal}
                    createGoal={createGoal}
                    patchGoal={patchGoal}
                    clearGoal={clearGoal}
                    isGoalEnabled={isGoalEnabled}
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
                      {...(initialMessages ? { initialMessages } : {})}
                      getTurnDiff={getTurnDiff}
                      revertTurnDiff={revertTurnDiff}
                      reapplyTurnDiff={reapplyTurnDiff}
                      getSessionForkOptions={getSessionForkOptions}
                      forkSession={forkSession}
                      getSessionRewindPreview={getSessionRewindPreview}
                      rewindSession={rewindSession}
                      editSessionMessage={editSessionMessage}
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
