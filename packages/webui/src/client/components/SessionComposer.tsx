// SessionComposer — the message composer: slash palette, model picker,
// permission/questionnaire panels, goal banner, stream column, and submit
// pipeline.
//
// W3 tier 4 lift: this component was moved verbatim out of `app.tsx`. The
// body is byte-identical to what used to live there; the lift is move-only.
// `app.tsx` does NOT re-export `WebuiComposer` because only the shell
// (Tier 5) uses it — the call site stays in `app.tsx` and reaches the new
// module via a local `import { WebuiComposer } from "./components/SessionComposer.js";`.
//
// The component reads the runtime store (`useSessionRuntimeState`), so the
// W2.75 invariant about `sessionKeyRef.current` is preserved by importing
// the hook from `./session-runtime-store.js` rather than re-implementing it.

import {
  Fragment,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import {
  type WebuiClientEventWatcher,
  type WebuiClientMessageEnqueuer,
  type WebuiClientMessageLoader,
  type WebuiClientMessageSender,
  type WebuiClientSessionCreator,
  type WebuiClientSessionResumer,
  type WebuiClientSessionPage,
  type WebuiModelSelectionRequest,
  type WebuiTransport,
} from "../contracts.js";

/** Capability subset the session composer consumes. Single source of truth
 *  lives in `WebuiTransport`; this alias keeps the prop block free of
 *  per-key `WebuiTransport["x"]` redeclarations. */
type WebuiSessionComposerCapabilities = Pick<
  WebuiTransport,
  | "loadMessages"
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionForkOptions"
  | "forkSession"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
  | "patchGoal"
  | "clearGoal"
>;
import type {
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalEnabledResult,
  WebuiGoalSessionRequest,
  WebuiInteractionReplyResult,
  WebuiModelEntry,
  WebuiPendingPermission,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireRequest,
  WebuiQueueItem,
} from "../../server/port.js";
import { WebuiGoalBanner } from "./GoalBanner.js";
import { WebuiInteractionPanel } from "./InteractionPanel.js";
import { WebuiQuestionnaireResponse } from "./SessionTranscript.js";
import { MessageItem } from "./MessageItem.js";
import {
  WebuiModelPicker,
  type WebuiModelPickerDraft,
} from "./ModelPicker.js";
import {
  WebuiIconAttach,
  WebuiIconCommandGoal,
  WebuiIconFolder,
  WebuiIconSend,
} from "../icons.js";
import { OutputError } from "./OutputError.js";
import {
  ActivityIndicator,
  MessageAfterQueryStreamingPlaceholder,
  MessagePassiveLoadingPlaceholder,
} from "./ActivityIndicator.js";
import {
  applyWebuiEffectCommands,
  reduceWebuiEffect,
} from "../projection/effect-reducer.js";
import { readUsageNumber } from "../projection/message-projection.js";
import { stripQuestionnaireResponse } from "../projection/message-parts.js";
import {
  buildWebuiComposerHandlers,
  submitWebuiGoal,
  submitWebuiComposerTurn,
} from "../projection/composer-state.js";
import {
  buildWebuiModelSelectionRequest,
} from "../projection/action-requests.js";
import { useSessionRuntimeState } from "../session-runtime-store.js";
import { initialWebuiStreamState } from "../stream.js";
import { workspaceProjectName } from "./SessionRail.js";
import {
  isWebuiRunnableCommand,
  rankWebuiSlashPalette,
  sectionWebuiSlashPalette,
  slashSkillSummaryToEntry,
  WEBUI_BUILTIN_COMMANDS,
  type SlashCommandEntry,
  type WebuiSlashSkillSummary,
  type WebuiRunCommandName,
} from "../slash-palette.js";

const WEBUI_SLASH_FALLBACK_SECTIONED: SlashCommandEntry[] = await (async () => {
  const { resolveWebuiSlashSkills } = await import("../slash-palette.js");
  const entries = await resolveWebuiSlashSkills();
  return sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, entries);
})();

// Desktop keeps the viewport pinned through the short hand-off window where
// the live turn is replaced by the refreshed historical transcript.
const WEBUI_STREAM_FINISH_SETTLE_MS = 2_000;

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

export function WebuiComposer({
  sessionId,
  sessionLayout = false,
  agentName,
  createSession,
  createSessionWorkspaceDir,
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
}: {
  readonly sessionId?: string;
  readonly sessionLayout?: boolean;
  readonly agentName: string;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly onWorkspaceChange: (workspaceDir?: string) => void;
  /** Open state for the workspace picker; owned by the parent so the
   *  parent's workspace-change handler can also close the popover. */
  readonly workspaceMenuOpen: boolean;
  readonly setWorkspaceMenuOpen: (open: boolean) => void;
  readonly runCommand?: (request: { readonly command: "help" | "new" | "compact" | "status" | "usage" | "model"; readonly input?: string; readonly sessionId?: string; readonly agentName?: string; readonly workspaceDir?: string; }) => Promise<Record<string, unknown>>;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;

  readonly getGoal?: (request: WebuiGoalSessionRequest) => Promise<WebuiGoal | undefined>;
  readonly createGoal?: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;

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
} & WebuiSessionComposerCapabilities): ReactElement {
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
  const [goalMode, setGoalMode] = useState(false);
  const [goalSubmitting, setGoalSubmitting] = useState(false);
  const [interactionError, setInteractionError] = useState<string>();
  const [queueItems, setQueueItems] = useState<readonly WebuiQueueItem[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [models, setModels] = useState<readonly WebuiModelEntry[]>([]);
  const [accountStatus, setAccountStatus] = useState<Record<string, unknown>>();
  const [commandOutput, setCommandOutput] = useState<string>();
  const [commandRunning, setCommandRunning] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const composerRegionRef = useRef<HTMLDivElement | null>(null);
  const streamColumnRef = useRef<HTMLDivElement | null>(null);
  const autoFollowSessionRef = useRef(true);
  const manualScrollIntentRef = useRef(false);
  const previousStreamSessionRef = useRef<string | undefined>(sessionId);
  const previousStreamContentRef = useRef(false);
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
      .then((result) => {
        if (cancelled) return;
        setGoalEnabled(result.enabled);
        if (!result.enabled) setGoalMode(false);
      })
      .catch(() => { if (!cancelled) setGoalEnabled(false); });
    return () => { cancelled = true; };
  }, [isGoalEnabled]);

  useEffect(() => {
    if (!sessionId || !getGoal || !goalEnabled) {
      setGoal(undefined);
      setGoalMode(false);
      return undefined;
    }
    setGoal(undefined);
    setGoalMode(false);
    let cancelled = false;
    void getGoal({ sessionId })
      .then((nextGoal) => {
        if (cancelled) return;
        setGoal(nextGoal);
        if (nextGoal) setGoalMode(nextGoal.status !== "complete");
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
  const activateGoalMode = () => {
    if (!goalEnabled || !createGoal) return;
    setGoalMode(true);
    onDraftChange("");
    textareaRef.current?.focus();
  };
  const cancelGoalMode = () => {
    setGoalMode(false);
    if (!goal) onDraftChange("");
    textareaRef.current?.focus();
  };
  const handleDraftChange = (next: string) => {
    if (next.trim().toLowerCase() === "/goal") {
      activateGoalMode();
      return;
    }
    onDraftChange(next);
  };
  const chooseCommand = (command: string) => {
    if (command === "goal") {
      activateGoalMode();
      return;
    }
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
  useLayoutEffect(() => {
    if (!sessionLayout) return undefined;
    const region = composerRegionRef.current;
    const layout = region?.closest<HTMLElement>(
      '[data-webui-session-layout="true"]',
    );
    if (!region || !layout) return undefined;
    const updateReservedHeight = () => {
      // Desktop reserves the measured composer inset plus a small base tail
      // inside its single message viewport. Keep the same contract here so a
      // taller slash/permission/composer state cannot cover the live tail.
      const height = Math.ceil(region.getBoundingClientRect().height);
      layout.style.setProperty(
        "--webui-composer-bottom-padding",
        `${height + 16}px`,
      );
    };
    updateReservedHeight();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(updateReservedHeight);
    observer?.observe(region);
    window.addEventListener("resize", updateReservedHeight);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateReservedHeight);
      layout.style.removeProperty("--webui-composer-bottom-padding");
    };
  }, [sessionLayout]);
  useLayoutEffect(() => {
    if (!sessionLayout || !showStreamContent) return undefined;
    const streamColumn = streamColumnRef.current;
    if (!streamColumn) return undefined;
    const viewport = streamColumn?.closest<HTMLElement>(
      '[data-webui-session-scroll="true"]',
    );
    if (!viewport) return undefined;
    const followBottom = () => {
      if (!autoFollowSessionRef.current) return;
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    };
    const handleScroll = () => {
      const distance =
        viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distance <= 150) {
        autoFollowSessionRef.current = true;
        manualScrollIntentRef.current = false;
      } else if (manualScrollIntentRef.current) {
        autoFollowSessionRef.current = false;
      }
    };
    const handleWheel = () => {
      manualScrollIntentRef.current = true;
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    viewport.addEventListener("wheel", handleWheel, { passive: true });
    followBottom();
    const bottomPadding = viewport.querySelector<HTMLElement>(
      '[data-webui-session-bottom-padding="true"]',
    );
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(followBottom);
    observer?.observe(streamColumn);
    if (bottomPadding) observer?.observe(bottomPadding);
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("scroll", handleScroll);
      viewport.removeEventListener("wheel", handleWheel);
    };
  }, [sessionLayout, showStreamContent]);
  useLayoutEffect(() => {
    const previousSessionId = previousStreamSessionRef.current;
    const wasShowingStream = previousStreamContentRef.current;
    previousStreamSessionRef.current = sessionId;
    previousStreamContentRef.current = showStreamContent;
    if (
      !sessionLayout ||
      showStreamContent ||
      !wasShowingStream ||
      previousSessionId !== sessionId
    )
      return undefined;

    const region = composerRegionRef.current;
    const viewport = region?.closest<HTMLElement>(
      '[data-webui-session-scroll="true"]',
    );
    if (!viewport || manualScrollIntentRef.current) return undefined;
    const transcript = viewport.querySelector<HTMLElement>(
      '[data-webui-session-transcript-scroll="true"]',
    );
    const bottomPadding = viewport.querySelector<HTMLElement>(
      '[data-webui-session-bottom-padding="true"]',
    );
    let frame = 0;
    let timer = 0;
    const followBottom = () => {
      if (!autoFollowSessionRef.current) return;
      viewport.scrollTop = Math.max(
        0,
        viewport.scrollHeight - viewport.clientHeight,
      );
    };
    const scheduleFollow = () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        followBottom();
      });
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(scheduleFollow);
    if (transcript) observer?.observe(transcript);
    if (bottomPadding) observer?.observe(bottomPadding);
    scheduleFollow();
    timer = window.setTimeout(() => {
      observer?.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
      frame = 0;
    }, WEBUI_STREAM_FINISH_SETTLE_MS);
    return () => {
      observer?.disconnect();
      window.clearTimeout(timer);
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [sessionId, sessionLayout, showStreamContent]);
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
    const trimmedDraft = draft.trim();
    const command = commandInvocation
      ? slashSectioned.find(
          (item) => item.name === commandInvocation[1],
        )
      : undefined;
    const directGoalObjective =
      command?.name === "goal" ? commandInvocation?.[2]?.trim() : undefined;
    if (command?.name === "goal" && !goalMode && !directGoalObjective) {
      activateGoalMode();
      return;
    }
    if ((goalMode || directGoalObjective) && (trimmedDraft || directGoalObjective)) {
      const objective = directGoalObjective ?? trimmedDraft;
      if (!createGoal || !goalEnabled) return;
      setGoalSubmitting(true);
      setInteractionError(undefined);
      try {
        const nextGoal = await submitWebuiGoal(
          {
            sessionId,
            objective,
            currentGoal: goal,
            createGoal,
            patchGoal,
            createSession,
            createSessionWorkspaceDir,
            teamModeOff,
          },
          onSessionCreated,
        );
        setGoal(nextGoal);
        setGoalMode(nextGoal.status !== "complete");
        onDraftChange("");
      } catch (error) {
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setGoalSubmitting(false);
      }
      return;
    }
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
    // A newly submitted turn is a Desktop-style request to follow the latest
    // frontier. The scroll listener can still release this lock immediately
    // if the user wheels back into history while the turn is running.
    autoFollowSessionRef.current = true;
    manualScrollIntentRef.current = false;
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
  const clearLocalGoal = () => {
    setGoal(undefined);
    setGoalMode(false);
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
          ref={streamColumnRef}
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
                return (
                  <>
                    <MessageAfterQueryStreamingPlaceholder />
                    <ActivityIndicator showLabel labelOverride="思考中…" />
                  </>
                );
              }
              // Stream is in flight but no thinking yet — pulse the rose
              // loader so the live column reads as active.
              if (stream.phase === "streaming" || stream.phase === "waiting") {
                return <ActivityIndicator showLabel labelOverride="思考中…" />;
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
                  processSegments={assistant
                    .map((message) => ({
                      messageId: message.id,
                      ...(message.thinking.trim()
                        ? { thinking: message.thinking }
                        : {}),
                      ...(message.toolCalls?.length
                        ? { tools: message.toolCalls }
                        : {}),
                    }))
                    .filter((segment) => segment.thinking || segment.tools?.length)}
                />
                {(stream.phase === "streaming" || stream.phase === "waiting") && !thinking.trim() ? (
                  <ActivityIndicator showLabel labelOverride="思考中…" />
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
        {sessionId && goalEnabled && goal ? <WebuiGoalBanner goal={goal} patchGoal={patchGoal} clearGoal={clearGoal} onCleared={clearLocalGoal} interactionBlocked={Boolean(questionnaire || permissions.length > 0)} /> : null}
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
                  onChange={(event) => handleDraftChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && goalMode) {
                      event.preventDefault();
                      cancelGoalMode();
                      return;
                    }
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
                  placeholder={goalMode ? "描述你想完成的目标" : "输入消息…（输入 / 唤起命令）"}
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
                {goalEnabled && createGoal ? (
                  <button
                    type="button"
                    className={`webui-goal-mode-button${goalMode ? " is-active" : ""}`}
                    aria-pressed={goalMode}
                    aria-label={goalMode ? "取消目标模式" : "目标"}
                    data-testid="composer-goal-mode"
                    disabled={goalSubmitting || Boolean(questionnaire || permissions.length > 0)}
                    onClick={() => (goalMode ? cancelGoalMode() : activateGoalMode())}
                  >
                    <WebuiIconCommandGoal />
                    <span>目标</span>
                  </button>
                ) : null}
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
                      disabled={!sendable || commandRunning || goalSubmitting}
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
