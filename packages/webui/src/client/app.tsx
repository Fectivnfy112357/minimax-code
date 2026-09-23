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
  HOME_SESSION_RUNTIME_KEY,
  migrateSessionRuntimeState,
  readSessionRuntimeState,
  updateSessionRuntimeState,
  useSessionRuntimeState,
} from "./session-runtime-store.js";
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

// W3 tier 1 — leaves moved to ./components/TranscriptPrimitives.tsx
import {
  WebuiActivityGroup,
  WebuiThinkingBlock,
  WebuiToolResults,
  WebuiTurnProcess,
  TurnElapsedRow,
} from "./components/TranscriptPrimitives.js";
export {
  WebuiActivityGroup,
  WebuiThinkingBlock,
  WebuiToolResults,
  WebuiTurnProcess,
  TurnElapsedRow,
} from "./components/TranscriptPrimitives.js";

// W3 tier 2 — diff state + card moved to ./components/DiffCard.tsx
import {
  buildWebuiDiffMutationRequest,
  confirmWebuiDiffMutation,
  initialWebuiDiffState,
  reduceWebuiDiffState,
  WebuiDiffCard,
} from "./components/DiffCard.js";
export {
  buildWebuiDiffMutationRequest,
  confirmWebuiDiffMutation,
  initialWebuiDiffState,
  reduceWebuiDiffState,
  WebuiDiffCard,
} from "./components/DiffCard.js";

// W3 tier 2 — message renderer moved to ./components/MessageItem.tsx
import { MessageItem } from "./components/MessageItem.js";
export { MessageItem } from "./components/MessageItem.js";

// W3 tier 2 — context menu + placement helper moved to ./components/ContextMenu.tsx
import {
  placeWebuiContextMenu,
  WebuiContextMenu,
  type WebuiContextMenuItem,
} from "./components/ContextMenu.js";
export {
  placeWebuiContextMenu,
  WebuiContextMenu,
} from "./components/ContextMenu.js";
export type { WebuiContextMenuItem } from "./components/ContextMenu.js";

// W3 tier 2 — RailRow moved to ./components/RailRow.tsx (still used by WebuiProjectList / WebuiSessionList below; no re-export — RailRow is private)
import { RailRow } from "./components/RailRow.js";

// W3 tier 3 — SessionRail cluster moved to ./components/SessionRail.tsx
import {
  groupWebuiSessionsByWorkspace,
  sessionHash,
  sessionLabel,
  sortWebuiProjectSessionIds,
  WebuiProjectList,
  WebuiSessionList,
  type WebuiProjectGroup,
} from "./components/SessionRail.js";
export {
  groupWebuiSessionsByWorkspace,
  sessionHash,
  sortWebuiProjectSessionIds,
  WebuiProjectList,
  WebuiSessionList,
} from "./components/SessionRail.js";
export type { WebuiProjectGroup } from "./components/SessionRail.js";

// W3 tier 3 — GoalBanner moved to ./components/GoalBanner.tsx
import { WebuiGoalBanner } from "./components/GoalBanner.js";
export { WebuiGoalBanner } from "./components/GoalBanner.js";

// W3 tier 3 — InteractionPanel moved to ./components/InteractionPanel.tsx
import { WebuiInteractionPanel } from "./components/InteractionPanel.js";
export { WebuiInteractionPanel } from "./components/InteractionPanel.js";

// W3 tier 4 — SessionTranscript + WebuiQuestionnaireResponse moved to ./components/SessionTranscript.tsx
import {
  WebuiSessionTranscript,
  WebuiQuestionnaireResponse,
} from "./components/SessionTranscript.js";
export {
  WebuiQuestionnaireResponse,
  WebuiSessionTranscript,
} from "./components/SessionTranscript.js";

// W3 tier 4 — WebuiComposer moved to ./components/SessionComposer.tsx (called from Tier 5 shell, no re-export)
import { WebuiComposer } from "./components/SessionComposer.js";

// W3 tier 2 — message actions cluster moved to ./components/MessageActions.tsx
import {
  copyWebuiMessageText,
  formatWebuiMessageTimestamp,
  scheduleWebuiCopiedReset,
  toggleWebuiFeedback,
  WebuiFeedbackActions,
  WebuiMessageActionButton,
  WebuiMessageActions,
  WebuiRewindDialog,
  type WebuiMessageActionCapabilities,
} from "./components/MessageActions.js";
export {
  copyWebuiMessageText,
  formatWebuiMessageTimestamp,
  scheduleWebuiCopiedReset,
  toggleWebuiFeedback,
  WebuiFeedbackActions,
  WebuiMessageActionButton,
  WebuiMessageActions,
  WebuiRewindDialog,
} from "./components/MessageActions.js";
export type { WebuiMessageActionCapabilities } from "./components/MessageActions.js";

// (WebuiClientMessage, WebuiClientSession, page/loader types,
//  WebuiTranscriptItem, WebuiDiffState/Action, etc. moved to ./contracts.ts in W2)

export function readSessionIdFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const id = params.get("session");
  return id?.trim() || undefined;
}

// (W3 tier 3: sessionHash moved to ./components/SessionRail.tsx; re-exported from app.tsx for back-compat)

// (moved to ./projection/message-projection.ts in W2)

// (tool helpers moved to ./projection/tool-projection.ts in W2)

// (W3 tier 2: diff state + WebuiDiffCard moved to ./components/DiffCard.tsx)

// (W3 tier 2: MessageItem moved to ./components/MessageItem.tsx)

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

// (WebuiSessionRuntimeState / readSessionRuntimeState /
//  updateSessionRuntimeState / migrateSessionRuntimeState /
//  useSessionRuntimeState / sessionRuntimeStates / sessionRuntimeListeners
//  / HOME_SESSION_RUNTIME_KEY moved to ./session-runtime-store.ts in W2.75)

// (W3 tier 3: sessionLabel moved to ./components/SessionRail.tsx; app.tsx imports it locally for composer call sites)

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

// (W3 tier 3: workspaceProjectName, WebuiProjectGroup, groupWebuiSessionsByWorkspace,
// sortWebuiProjectSessionIds moved to ./components/SessionRail.tsx; app.tsx imports
// workspaceProjectName locally for the composer call site below — the others come
// through the W3 tier 3 re-export block at L405.)

import { workspaceProjectName } from "./components/SessionRail.js";

// (W3 tier 2: placeWebuiContextMenu, WebuiContextMenuItem, WebuiContextMenu moved to ./components/ContextMenu.tsx)

// (W3 tier 3: WebuiProjectList moved to ./components/SessionRail.tsx)

// (W3 tier 3: WebuiSessionList moved to ./components/SessionRail.tsx)

/**
 * Group a flat transcript into one block per message, so a single turn renders
 * as the desktop renders it: one block carrying its process steps and its
 * answer. Exported because it is the contract the transcript's markup depends
 * on.
 */
// (groupWebuiTranscriptItems moved to ./projection/transcript-projection.ts in W2)

// (W3 tier 2: WebuiMessageActionCapabilities, toggleWebuiFeedback, WebuiCopyDependencies,
// copyWebuiMessageText, scheduleWebuiCopiedReset, WebuiMessageActionButton, WebuiFeedbackActions,
// formatWebuiMessageTimestamp, WebuiMessageActions moved to ./components/MessageActions.tsx)

// (W3 tier 4: WebuiQuestionnaireResponse moved to ./components/SessionTranscript.tsx)

// (W3 tier 4: WebuiSessionTranscript moved to ./components/SessionTranscript.tsx)

/**
 * A rail row. `webui-nav-item` carries the shared hover and selected treatment; the fixed
 * row passes `active` so the current destination reads differently from a hover-only row.
 */


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

// (W3 tier 3: WebuiGoalBanner moved to ./components/GoalBanner.tsx)

// (W3 tier 3: WebuiInteractionPanel moved to ./components/InteractionPanel.tsx)

// (W3 tier 3: WebuiInteractionPanel moved to ./components/InteractionPanel.tsx)

// (W3 tier 4: WebuiComposer moved to ./components/SessionComposer.tsx; the Tier 5 shell imports it from there)


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
