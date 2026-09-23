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

// W3 tier 5 — WebuiClientFoundationApp + subscribeToSessionHash + useSelectedSessionId moved to ./components/WebuiClientFoundationApp.tsx
import {
  readSessionIdFromHash,
  subscribeToSessionHash,
  WebuiClientFoundationApp,
  type WebuiClientFoundationAppProps,
} from "./components/WebuiClientFoundationApp.js";
export {
  readSessionIdFromHash,
  subscribeToSessionHash,
  WebuiClientFoundationApp,
} from "./components/WebuiClientFoundationApp.js";
export type { WebuiClientFoundationAppProps } from "./components/WebuiClientFoundationApp.js";

// re-export so `app.tsx`'s default export keeps working for `main.tsx`
export default WebuiClientFoundationApp;

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


// (W3 tier 3: sessionHash moved to ./components/SessionRail.tsx; re-exported from app.tsx for back-compat)

// (moved to ./projection/message-projection.ts in W2)

// (tool helpers moved to ./projection/tool-projection.ts in W2)

// (W3 tier 2: diff state + WebuiDiffCard moved to ./components/DiffCard.tsx)

// (W3 tier 2: MessageItem moved to ./components/MessageItem.tsx)



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