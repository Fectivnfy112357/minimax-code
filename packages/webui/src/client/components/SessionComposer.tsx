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
  type WebuiClientSession,
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
  WebuiWorkspaceFile,
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
  resolveWebuiSubmissionIntent,
  isTurnLive,
} from "../projection/composer-state.js";
import {
  projectLiveTurnView,
  projectLiveUserView,
} from "../projection/transcript-shape.js";
import { evaluateOutsideClose } from "../projection/outside-close.js";
import {
  buildWebuiModelSelectionRequest,
} from "../projection/action-requests.js";
import { useSessionRuntimeState } from "../session-runtime-store.js";
import { initialWebuiStreamState } from "../stream.js";
import { workspaceProjectName } from "./SessionRail.js";
import {
  findWebuiMentionRange,
  insertWebuiMention,
  webuiAttachmentLimitError,
  type WebuiMentionRange,
} from "../projection/composer-interactions.js";
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
  const { resolveWebuiSlashSkills, sectionWebuiSlashPalette } = await import(
    "../slash-palette.js"
  );
  const resolved = await resolveWebuiSlashSkills();
  return sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, resolved.skills);
})();

// Desktop keeps the viewport pinned through the short hand-off window where
// the live turn is replaced by the refreshed historical transcript.
const WEBUI_STREAM_FINISH_SETTLE_MS = 2_000;

interface ComposerAttachment {
  readonly id: string;
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly dataUrl: string;
  readonly kind: "image" | "file";
}

interface ComposerUrlReference {
  readonly id: string;
  readonly url: string;
}

interface ComposerCatalogEntry {
  readonly name: string;
  readonly displayName: string;
  readonly description?: string;
}

type ComposerMentionChoice =
  | { readonly kind: "plugin"; readonly name: string; readonly label: string; readonly detail?: string; readonly section: string }
  | { readonly kind: "file"; readonly path: string; readonly label: string; readonly section: string }
  | { readonly kind: "local-file"; readonly label: string; readonly section: string }
  | { readonly kind: "local-folder"; readonly label: string; readonly section: string }
  | { readonly kind: "agent"; readonly session: WebuiClientSession; readonly label: string; readonly section: string };

type WebuiComposerPermissionMode = "default" | "auto" | "bypassPermissions";

const PERMISSION_MODE_LABEL: Readonly<Record<WebuiComposerPermissionMode, string>> = {
  default: "主动询问",
  auto: "智能授权",
  bypassPermissions: "始终授权",
};

function readPermissionMode(value: unknown): WebuiComposerPermissionMode | undefined {
  const mode = typeof value === "string"
    ? value
    : value && typeof value === "object" && "mode" in value
      ? (value as { mode?: unknown }).mode
      : undefined;
  return mode === "default" || mode === "auto" || mode === "bypassPermissions"
    ? mode
    : undefined;
}

function composerRows(value: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  const items = Array.isArray(row.plugins) ? row.plugins : Array.isArray(row.items) ? row.items : [];
  return items.filter((item): item is Record<string, unknown> => !!item && typeof item === "object");
}

function flattenWorkspaceFiles(files: readonly WebuiWorkspaceFile[]): readonly { readonly path: string; readonly name: string; readonly type?: string }[] {
  const flattened: { path: string; name: string; type?: string }[] = [];
  const visit = (items: readonly WebuiWorkspaceFile[]) => {
    for (const item of items) {
      flattened.push({ path: item.path, name: item.name, ...(item.type ? { type: item.type } : {}) });
      if (item.children) visit(item.children);
    }
  };
  visit(files);
  return flattened;
}

function readBrowserFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error(`无法读取文件：${file.name}`));
    reader.onload = () => typeof reader.result === "string"
      ? resolve(reader.result)
      : reject(new Error(`无法读取文件：${file.name}`));
    reader.readAsDataURL(file);
  });
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
  listWorkspaceFileTree,
  pluginManagement,
  getPermissionMode,
  setPermissionMode,
  sessions = [],
  workspaceDir,
  onSelectSession,
  onOpenPluginManagement,
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
  readonly listWorkspaceFileTree?: WebuiTransport["listWorkspaceFileTree"];
  readonly pluginManagement?: WebuiTransport["pluginManagement"];
  readonly getPermissionMode?: WebuiTransport["getPermissionMode"];
  readonly setPermissionMode?: WebuiTransport["setPermissionMode"];
  readonly sessions?: readonly WebuiClientSession[];
  readonly workspaceDir?: string;
  readonly onSelectSession?: (sessionId: string) => void;
  readonly onOpenPluginManagement?: (area: "plugins" | "skills") => void;
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
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [urlReferences, setUrlReferences] = useState<ComposerUrlReference[]>([]);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [composerMenu, setComposerMenu] = useState<"root" | "skills" | "plugins">();
  const [installedPlugins, setInstalledPlugins] = useState<readonly ComposerCatalogEntry[]>([]);
  const [pluginsLoading, setPluginsLoading] = useState(false);
  const [pluginsError, setPluginsError] = useState<string>();
  const [skillsMenuLoading, setSkillsMenuLoading] = useState(false);
  const [skillsMenuError, setSkillsMenuError] = useState<string>();
  const [workspaceFiles, setWorkspaceFiles] = useState<readonly { readonly path: string; readonly name: string; readonly type?: string }[]>([]);
  const [mentionRange, setMentionRange] = useState<WebuiMentionRange>();
  const [mentionIndex, setMentionIndex] = useState(0);
  const [permissionMode, setPermissionModeValue] = useState<WebuiComposerPermissionMode>();
  const [permissionMenuOpen, setPermissionMenuOpen] = useState(false);
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionUnavailable, setPermissionUnavailable] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const mentionCaretRef = useRef<number>();
  const pendingMentionCaretRef = useRef<number>();
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
    }, () => {
      // A reconnect may have missed permission, questionnaire or queue events
      // while the browser was suspended. Re-read the authoritative state once
      // the replacement event stream is open.
      void refreshPending().catch(() => undefined);
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
    let cancelled = false;
    if (!getPermissionMode || !setPermissionMode) {
      setPermissionUnavailable(true);
      return undefined;
    }
    getPermissionMode()
      .then((value) => {
        if (cancelled) return;
        const mode = readPermissionMode(value);
        if (!mode) throw new Error("运行时返回了不支持的授权模式");
        setPermissionModeValue(mode);
        setPermissionUnavailable(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPermissionUnavailable(true);
        setInteractionError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [getPermissionMode, setPermissionMode]);

  useEffect(() => {
    if (composerMenu !== "plugins" && !mentionRange) return;
    if (!pluginManagement) {
      setInstalledPlugins([]);
      return;
    }
    let cancelled = false;
    setPluginsLoading(true);
    setPluginsError(undefined);
    pluginManagement({ action: "listInstalledPlugins", input: { limit: 200 } })
      .then((result) => {
        if (cancelled) return;
        setInstalledPlugins(composerRows(result).map((row) => {
          const name = typeof row.name === "string" ? row.name : typeof row.pluginName === "string" ? row.pluginName : "";
          const displayName = typeof row.displayName === "string" ? row.displayName : name;
          return { name, displayName, ...(typeof row.description === "string" ? { description: row.description } : {}) };
        }).filter((plugin) => plugin.name));
      })
      .catch((error: unknown) => {
        if (!cancelled) setPluginsError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => { if (!cancelled) setPluginsLoading(false); });
    return () => { cancelled = true; };
  }, [composerMenu, mentionRange !== undefined, pluginManagement]);

  useEffect(() => {
    if (composerMenu !== "skills") return;
    if (!listSkills) {
      setSkillsMenuError("技能目录暂不可用");
      return;
    }
    let cancelled = false;
    setSkillsMenuLoading(true);
    setSkillsMenuError(undefined);
    listSkills({ agentName })
      .then((result) => { if (!cancelled) setSlashSkills(result.skills); })
      .catch((error: unknown) => { if (!cancelled) setSkillsMenuError(error instanceof Error ? error.message : String(error)); })
      .finally(() => { if (!cancelled) setSkillsMenuLoading(false); });
    return () => { cancelled = true; };
  }, [composerMenu, listSkills, agentName]);

  useEffect(() => {
    if (!mentionRange || !workspaceDir || !listWorkspaceFileTree) {
      setWorkspaceFiles([]);
      return undefined;
    }
    let cancelled = false;
    listWorkspaceFileTree({ workspaceDir })
      .then((files) => { if (!cancelled) setWorkspaceFiles(flattenWorkspaceFiles(files).slice(0, 100)); })
      .catch((error: unknown) => {
        if (!cancelled) setInteractionError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, [mentionRange !== undefined, workspaceDir, listWorkspaceFileTree]);

  useLayoutEffect(() => {
    const caret = pendingMentionCaretRef.current;
    const textarea = textareaRef.current;
    if (caret === undefined || !textarea) return;
    textarea.focus();
    textarea.setSelectionRange(caret, caret);
    pendingMentionCaretRef.current = undefined;
  }, [draft]);

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
  const mentionQuery = mentionRange?.query.toLocaleLowerCase() ?? "";
  const mentionSuggestions: readonly ComposerMentionChoice[] = mentionRange
    ? [
        ...installedPlugins
          .filter((plugin) => `${plugin.displayName} ${plugin.name}`.toLocaleLowerCase().includes(mentionQuery))
          .map((plugin) => ({ kind: "plugin" as const, name: plugin.name, label: plugin.displayName, detail: plugin.description, section: "插件" })),
        { kind: "local-file" as const, label: "添加本地文件", section: "本地资源" },
        { kind: "local-folder" as const, label: "添加本地文件夹", section: "本地资源" },
        ...workspaceFiles
          .filter((file) => `${file.name} ${file.path}`.toLocaleLowerCase().includes(mentionQuery))
          .map((file) => ({ kind: "file" as const, path: file.path, label: file.path, section: "项目文件" })),
        ...sessions
          .filter((session) => session.parentSessionId === sessionId)
          .filter((session) => `${session.title ?? session.agentName} ${session.agentName}`.toLocaleLowerCase().includes(mentionQuery))
          .map((session) => ({ kind: "agent" as const, session, label: session.title ?? session.agentName, section: "子 Agent" })),
      ]
    : [];
  const [commandIndex, setCommandIndex] = useState(0);
  useEffect(() => {
    setMentionIndex((current) => mentionSuggestions.length === 0 ? 0 : Math.min(current, mentionSuggestions.length - 1));
  }, [mentionRange?.query, mentionSuggestions.length]);
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
  useEffect(() => {
    if (!composerMenu && !permissionMenuOpen && !mentionRange) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (composerRegionRef.current?.contains(event.target)) return;
      setComposerMenu(undefined);
      setPermissionMenuOpen(false);
      setMentionRange(undefined);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [composerMenu, permissionMenuOpen, mentionRange]);
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
      const insideContainer = region.contains(event.target);
      // Slash popover's per-surface variant subscribes to `pointerdown`
      // only (no Escape handler — the composer input change handler is
      // the only path). Routing through `evaluateOutsideClose` keeps the
      // four call sites consistent without changing the original close
      // semantics.
      if (
        evaluateOutsideClose({
          surface: "slashPopover",
          kind: "pointerdown",
          insideContainer,
        }) !== "close"
      ) {
        return;
      }
      // Same clear-and-close as Escape: drop the "/xxx" segment so the
      // regex no longer matches and the popover disappears.
      onDraftChange(slashDraftRef.current.slice(0, match.index));
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [slashPanelOpen, onDraftChange]);
  const addFiles = async (filesLike: FileList | readonly File[] | null) => {
    const files = filesLike ? Array.from(filesLike) : [];
    if (files.length === 0) return;
    const limitError = webuiAttachmentLimitError(attachments, files.map((file) => ({ sizeBytes: file.size })));
    if (limitError) {
      setInteractionError(limitError);
      return;
    }
    setAttachmentBusy(true);
    setInteractionError(undefined);
    try {
      const additions = await Promise.all(files.map(async (file): Promise<ComposerAttachment> => {
        const dataUrl = await readBrowserFile(file);
        const fileName = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        return {
          id: crypto.randomUUID(),
          fileName,
          mimeType: file.type || "application/octet-stream",
          sizeBytes: file.size,
          dataUrl,
          kind: file.type.startsWith("image/") ? "image" : "file",
        };
      }));
      setAttachments((current) => [...current, ...additions]);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setAttachmentBusy(false);
    }
  };
  const attachmentWire = attachments.map((attachment) => ({
    meta: {
      attachmentType: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
    },
    local: { dataUrl: attachment.dataUrl },
  }));
  const replaceMention = (insertion: string) => {
    if (!mentionRange) return;
    const result = insertWebuiMention(draft, mentionRange, insertion);
    pendingMentionCaretRef.current = result.caret;
    onDraftChange(result.value);
    setMentionRange(undefined);
  };
  const insertAtCaret = (insertion: string) => {
    const caret = textareaRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret);
    const prefix = before.length > 0 && !/\s$/u.test(before) ? " " : "";
    const inserted = `${prefix}${insertion} `;
    pendingMentionCaretRef.current = before.length + inserted.length;
    onDraftChange(`${before}${inserted}${draft.slice(caret)}`);
  };
  const chooseMention = (choice: ComposerMentionChoice) => {
    setMentionRange(undefined);
    if (choice.kind === "plugin") {
      replaceMention(`@${choice.name}`);
      return;
    }
    if (choice.kind === "file") {
      replaceMention(`@${choice.path}`);
      return;
    }
    if (choice.kind === "local-file") {
      replaceMention("");
      fileInputRef.current?.click();
      return;
    }
    if (choice.kind === "local-folder") {
      replaceMention("");
      folderInputRef.current?.click();
      return;
    }
    if (!onSelectSession) {
      setInteractionError("子 Agent 切换暂不可用");
      return;
    }
    replaceMention("");
    onSelectSession(choice.session.sessionId);
  };
  const changePermissionMode = async (mode: WebuiComposerPermissionMode) => {
    if (!setPermissionMode || !getPermissionMode) return;
    setPermissionBusy(true);
    setInteractionError(undefined);
    try {
      await setPermissionMode({ mode });
      const refreshed = readPermissionMode(await getPermissionMode());
      if (refreshed !== mode) throw new Error("授权模式未能保存，请重试");
      setPermissionModeValue(refreshed);
      setPermissionUnavailable(false);
      setPermissionMenuOpen(false);
    } catch (error) {
      setInteractionError(error instanceof Error ? error.message : String(error));
    } finally {
      setPermissionBusy(false);
    }
  };
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
  // `isTurnLive` is the single source of truth for the three-value phase
  // predicate; `session-runtime-store.ts` carries `sending` as a separate
  // submit-lifecycle boolean the reducer deliberately does NOT merge with
  // `phase` — `submitWebuiComposerTurn` relies on the two staying distinct.
  const turnLive = isTurnLive(stream.phase);
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
  const messageDraft = [draft.trim(), ...urlReferences.map((reference) => reference.url.trim()).filter(Boolean)].filter(Boolean).join("\n");
  const sendable = (canCompose || canQueue) && (Boolean(messageDraft) || attachments.length > 0);
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
    // Pure intent resolution — five paths: activate-goal-mode, submit-goal,
    // run-command, submit-turn (which submitWebuiComposerTurn further
    // splits into send+resume vs queue). All side effects (state updates,
    // draft clearing, auto-follow lock, error rendering) stay in this
    // function so the resolver itself can be tested without React.
    const intent = resolveWebuiSubmissionIntent({
      draft: messageDraft,
      commandMatch: command,
      ...(commandInvocation?.[1] !== undefined
        ? { commandInvocationName: commandInvocation[1] }
        : {}),
      ...(commandInvocation?.[2] !== undefined
        ? { commandInvocationInput: commandInvocation[2] }
        : {}),
      goalMode,
    });
    const resolvedIntent = intent ?? (attachments.length > 0 ? { kind: "submit-turn" as const } : undefined);
    if (!resolvedIntent) return;
    if (resolvedIntent.kind === "activate-goal-mode") {
      activateGoalMode();
      return;
    }
    if (resolvedIntent.kind === "submit-goal") {
      const { objective } = resolvedIntent;
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
    if (resolvedIntent.kind === "run-command") {
      const { command: matchedCommand, input } = resolvedIntent;
      // The original gate (`runCommand && command && isWebuiRunnableCommand`)
      // collapsed into the intent, but the `runCommand` runtime check stays
      // here — the resolver is the source of truth for *which* path, the
      // component is still the source of truth for *whether the host wired
      // the capability* (a disabled host must not reach the run-path).
      if (!runCommand) return;
      setCommandRunning(true);
      setInteractionError(undefined);
      try {
        const result = await runCommand({
          command: matchedCommand.name,
          ...(input ? { input } : {}),
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
    // intent.kind === "submit-turn"
    // A newly submitted turn is a Desktop-style request to follow the latest
    // frontier. The scroll listener can still release this lock immediately
    // if the user wheels back into history while the turn is running.
    autoFollowSessionRef.current = true;
    manualScrollIntentRef.current = false;
    await submitWebuiComposerTurn(
      {
        sessionId,
        draft,
        attachments: attachmentWire,
        onAttachmentsSubmitted: () => { setAttachments([]); setUrlReferences([]); },
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
                  view={projectLiveUserView([message]) ?? {
                    source: "live",
                    messageId: message.id,
                    role: "user",
                    userText: stripped.content,
                    streamMessageId: message.id,
                    ...(message.timestamp !== undefined
                      ? { timestamp: message.timestamp }
                      : {}),
                    ...(message.isGoal ? { isGoal: true } : {}),
                  }}
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
                  view={projectLiveTurnView(stream.messages, {
                      sessionId,
                      streaming: stream.phase === "streaming",
                      processingStartedAtMs: stream.processingStartedAtMs,
                    }) ?? {
                      source: "live",
                      messageId: "stream-live",
                      role: "assistant",
                      ...(sessionId ? { sessionId } : {}),
                      assistantMessageId: assistant[assistant.length - 1]?.id,
                      streamMessageId: "merged",
                      messageRootId: "merged",
                      streaming: stream.phase === "streaming",
                      ...(stream.processingStartedAtMs !== undefined
                        ? { processingStartedAtMs: stream.processingStartedAtMs }
                        : {}),
                      ...(thinking ? { thinking } : {}),
                      ...(tools.length > 0 ? { tools } : {}),
                      ...(answers.length > 0 ? { answers } : {}),
                      ...(totalRequestDurationMs > 0
                        ? { totalRequestDurationMs }
                        : {}),
                      ...(totalOutputTokens > 0 ? { totalOutputTokens } : {}),
                    }}
                  getTurnDiff={getTurnDiff}
                  revertTurnDiff={revertTurnDiff}
                  reapplyTurnDiff={reapplyTurnDiff}
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
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="webui-composer-hidden-file-input"
          aria-label="添加文件或图片"
          onChange={(event) => { void addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
        />
        <input
          ref={folderInputRef}
          type="file"
          multiple
          className="webui-composer-hidden-file-input"
          aria-label="添加本地文件夹"
          {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={(event) => { void addFiles(event.currentTarget.files); event.currentTarget.value = ""; }}
        />
        {sessionId && goalEnabled && goal ? <WebuiGoalBanner goal={goal} patchGoal={patchGoal} clearGoal={clearGoal} onCleared={clearLocalGoal} interactionBlocked={Boolean(questionnaire || permissions.length > 0)} /> : null}
        {composerMenu ? (
          <div className="webui-composer-menu" role="menu" aria-label={composerMenu === "root" ? "添加附件或技能" : composerMenu === "skills" ? "技能" : "插件"} data-webui-composer-menu={composerMenu} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setComposerMenu(undefined); } }}>
            {composerMenu === "root" ? <>
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); fileInputRef.current?.click(); }}>添加文件或图片</button>
              <button type="button" role="menuitem" onClick={() => setComposerMenu("skills")}>技能 <span aria-hidden="true">›</span></button>
              <button type="button" role="menuitem" onClick={() => setComposerMenu("plugins")}>插件 <span aria-hidden="true">›</span></button>
              <div role="separator" />
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); activateGoalMode(); }}>目标</button>
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); chooseCommand("plan"); }}>计划</button>
            </> : composerMenu === "skills" ? <>
              <button type="button" role="menuitem" className="webui-composer-menu-back" onClick={() => setComposerMenu("root")}>‹ 技能</button>
              {skillsMenuLoading ? <div className="webui-composer-menu-empty">正在加载技能…</div> : skillsMenuError ? <div className="webui-composer-menu-empty" role="alert">{skillsMenuError}</div> : slashSkills.length ? slashSkills.map((skill) => <button key={skill.name} type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); insertAtCaret(`/${skill.name}`); textareaRef.current?.focus(); }}>{skill.displayName ?? skill.name}</button>) : <div className="webui-composer-menu-empty">没有已安装的技能</div>}
              <div role="separator" />
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("skills"); }}>管理技能</button>
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("skills"); }}>添加技能</button>
            </> : <>
              <button type="button" role="menuitem" className="webui-composer-menu-back" onClick={() => setComposerMenu("root")}>‹ 插件</button>
              {pluginsLoading ? <div className="webui-composer-menu-empty">正在加载插件…</div> : pluginsError ? <div className="webui-composer-menu-empty" role="alert">{pluginsError}</div> : installedPlugins.length ? installedPlugins.map((plugin) => <button key={plugin.name} type="button" role="menuitem" title={plugin.description} onClick={() => { setComposerMenu(undefined); insertAtCaret(`@${plugin.name}`); textareaRef.current?.focus(); }}>{plugin.displayName}</button>) : <div className="webui-composer-menu-empty">{pluginManagement ? "没有已安装的插件" : "插件目录暂不可用"}</div>}
              <div role="separator" />
              <button type="button" role="menuitem" onClick={() => { setComposerMenu(undefined); onOpenPluginManagement?.("plugins"); }}>添加插件</button>
            </>}
          </div>
        ) : null}
        <form
          onSubmit={submit}
          onDragOver={(event) => { if (event.dataTransfer.files.length) event.preventDefault(); }}
          onDrop={(event) => { if (event.dataTransfer.files.length) { event.preventDefault(); void addFiles(event.dataTransfer.files); } }}
          data-webui-composer="true"
          className="w-full"
        >
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
                  onChange={(event) => {
                    const next = event.target.value;
                    handleDraftChange(next);
                    const caret = event.target.selectionStart;
                    mentionCaretRef.current = caret;
                    const nextMentionRange = findWebuiMentionRange(next, caret);
                    if (nextMentionRange) {
                      setComposerMenu(undefined);
                      setPermissionMenuOpen(false);
                    }
                    setMentionRange(nextMentionRange);
                  }}
                  onPaste={(event) => {
                    const pastedFiles = Array.from(event.clipboardData.items).flatMap((item) => item.kind === "file" ? [item.getAsFile()].filter((file): file is File => file !== null) : []);
                    if (pastedFiles.length) { event.preventDefault(); void addFiles(pastedFiles); return; }
                    const pastedText = event.clipboardData.getData("text/plain").trim();
                    if (/^https?:\/\/\S+$/iu.test(pastedText)) {
                      event.preventDefault();
                      const start = event.currentTarget.selectionStart;
                      const end = event.currentTarget.selectionEnd;
                      pendingMentionCaretRef.current = start;
                      onDraftChange(`${draft.slice(0, start)}${draft.slice(end)}`);
                      setUrlReferences((current) => [...current, { id: crypto.randomUUID(), url: pastedText }]);
                    }
                  }}
                  onClick={(event) => {
                    const nextMentionRange = findWebuiMentionRange(event.currentTarget.value, event.currentTarget.selectionStart);
                    if (nextMentionRange) {
                      setComposerMenu(undefined);
                      setPermissionMenuOpen(false);
                    }
                    setMentionRange(nextMentionRange);
                  }}
                  onKeyUp={(event) => {
                    if (["ArrowDown", "ArrowUp", "Enter", "Escape"].includes(event.key)) return;
                    setMentionRange(findWebuiMentionRange(event.currentTarget.value, event.currentTarget.selectionStart));
                  }}
                  onKeyDown={(event) => {
                    if (mentionRange && mentionSuggestions.length > 0) {
                      if (event.key === "Escape") { event.preventDefault(); setMentionRange(undefined); return; }
                      if (event.key === "ArrowDown") { event.preventDefault(); setMentionIndex((current) => (current + 1) % mentionSuggestions.length); return; }
                      if (event.key === "ArrowUp") { event.preventDefault(); setMentionIndex((current) => (current - 1 + mentionSuggestions.length) % mentionSuggestions.length); return; }
                      if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); const choice = mentionSuggestions[mentionIndex]; if (choice) chooseMention(choice); return; }
                    }
                    if (event.key === "Escape" && composerMenu) { event.preventDefault(); setComposerMenu(undefined); return; }
                    if (event.key === "Escape" && permissionMenuOpen) { event.preventDefault(); setPermissionMenuOpen(false); return; }
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
                {mentionRange && mentionSuggestions.length > 0 ? (
                  <div className="webui-composer-mention-menu" role="listbox" aria-label="提及列表" data-webui-mention-menu="true">
                    {mentionSuggestions.map((choice, index) => (
                      <Fragment key={`${choice.section}:${choice.kind}:${choice.kind === "agent" ? choice.session.sessionId : choice.kind === "file" ? choice.path : choice.kind === "plugin" ? choice.name : choice.label}`}>
                        {(index === 0 || mentionSuggestions[index - 1]?.section !== choice.section) ? <div className="webui-composer-mention-section" role="presentation">{choice.section}</div> : null}
                        <button type="button" role="option" aria-selected={index === mentionIndex} className="webui-composer-mention-option" onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setMentionIndex(index)} onClick={() => chooseMention(choice)}>
                          <span>{choice.label}</span>
                          {choice.kind === "plugin" && choice.detail ? <small>{choice.detail}</small> : null}
                        </button>
                      </Fragment>
                    ))}
                  </div>
                ) : null}
                {attachments.length > 0 ? (
                  <div className="webui-composer-attachments" data-webui-composer-attachments="true">
                    {attachments.map((attachment) => <div key={attachment.id} className={`webui-composer-attachment${attachment.kind === "image" ? " is-image" : ""}`}>
                      {attachment.kind === "image" ? <img src={attachment.dataUrl} alt={attachment.fileName} /> : <span className="webui-composer-attachment-type">{attachment.fileName.split(".").pop()?.toUpperCase() ?? "FILE"}</span>}
                      <span className="webui-composer-attachment-name" title={attachment.fileName}>{attachment.fileName}</span>
                      <button type="button" aria-label={`移除 ${attachment.fileName}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}>×</button>
                    </div>)}
                    {urlReferences.map((reference) => <div key={reference.id} className="webui-composer-url-reference">
                      <span aria-hidden="true">↗</span>
                      <input aria-label="URL 引用" value={reference.url} onChange={(event) => setUrlReferences((current) => current.map((item) => item.id === reference.id ? { ...item, url: event.target.value } : item))} />
                      <button type="button" aria-label="移除 URL 引用" onClick={() => setUrlReferences((current) => current.filter((item) => item.id !== reference.id))}>×</button>
                    </div>)}
                    {attachmentBusy ? <span className="webui-composer-attachment-loading" role="status">正在读取文件…</span> : null}
                  </div>
                ) : urlReferences.length > 0 ? <div className="webui-composer-attachments" data-webui-composer-attachments="true">{urlReferences.map((reference) => <div key={reference.id} className="webui-composer-url-reference"><span aria-hidden="true">↗</span><input aria-label="URL 引用" value={reference.url} onChange={(event) => setUrlReferences((current) => current.map((item) => item.id === reference.id ? { ...item, url: event.target.value } : item))} /><button type="button" aria-label="移除 URL 引用" onClick={() => setUrlReferences((current) => current.filter((item) => item.id !== reference.id))}>×</button></div>)}</div> : null}
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
                  aria-label="添加附件或技能"
                  aria-expanded={Boolean(composerMenu)}
                  aria-haspopup="menu"
                  data-testid="composer-add-menu"
                  className="webui-icon-button text-icon_default_tertiary"
                  onClick={() => {
                    setPermissionMenuOpen(false);
                    setMentionRange(undefined);
                    setComposerMenu((current) => current ? undefined : "root");
                  }}
                >
                  <WebuiIconAttach />
                </button>
                <div className="webui-composer-permission-wrap">
                  <button
                    type="button"
                    className="webui-composer-permission-button"
                    aria-label="授权模式"
                    aria-haspopup="menu"
                    aria-expanded={permissionMenuOpen}
                    disabled={permissionUnavailable || permissionBusy || !permissionMode}
                    title={permissionUnavailable ? "授权模式当前不可用" : undefined}
                    data-testid="composer-permission-mode"
                    onClick={() => {
                      setComposerMenu(undefined);
                      setMentionRange(undefined);
                      setPermissionMenuOpen((open) => !open);
                    }}
                  >
                    <span aria-hidden="true">↪</span>
                    <span>{permissionMode ? PERMISSION_MODE_LABEL[permissionMode] : permissionUnavailable ? "授权不可用" : "读取授权模式…"}</span>
                  </button>
                  {permissionMenuOpen ? <div className="webui-composer-permission-menu" role="menu" aria-label="授权模式" onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); setPermissionMenuOpen(false); } }}>
                    {(["default", "auto", "bypassPermissions"] as const).map((mode) => <button key={mode} type="button" role="menuitemradio" aria-checked={permissionMode === mode} disabled={permissionBusy} onClick={() => void changePermissionMode(mode)}>
                      <span>{mode === "default" ? "♧" : mode === "auto" ? "♢" : "↪"}</span>
                      <span>{PERMISSION_MODE_LABEL[mode]}</span>
                      <span className="webui-composer-permission-check" aria-hidden="true">{permissionMode === mode ? "✓" : ""}</span>
                    </button>)}
                  </div> : null}
                </div>
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
