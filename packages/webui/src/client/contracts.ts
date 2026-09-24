// WebUI client contracts.
//
// Pure type surface for the client. This file owns the wire-facing types the
// client uses to talk to the runtime: session/message shapes the loader
// returns, request types the transport consumes, and the small union shapes
// the runtime protocol returns (transcript items, diff state, questionnaire /
// goal / permission). Nothing in here has runtime side effects; nothing here
// imports React or DOM globals — the type layer is the lowest in the
// dependency direction `main → components → projection → contracts`.

import type {
  WebuiCanvasDocument,
  WebuiClaimSigninView,
  WebuiEditSessionMessageRequest,
  WebuiEditSessionMessageResult,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiFileDiffInfoView,
  WebuiForkSessionRequest,
  WebuiForkSessionResult,
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalEnabledResult,
  WebuiGoalPatchRequest,
  WebuiGoalSessionRequest,
  WebuiGoalStatus,
  WebuiGetSessionDiffRequest,
  WebuiGetSessionDiffResult,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiInteractionReplyResult,
  WebuiModelEntry,
  WebuiPendingPermission,
  WebuiQueueItem,
  WebuiRecentProject,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireOption,
  WebuiQuestionnaireRequest,
  WebuiQuestionnaireStep,
  WebuiReapplyTurnDiffRequest,
  WebuiReapplyTurnDiffResult,
  WebuiRevertTurnDiffRequest,
  WebuiRevertTurnDiffResult,
  WebuiRewindSessionRequest,
  WebuiRewindSessionResult,
  WebuiRuntimeEvent,
  WebuiSigninPanelView,
  WebuiStreamFrame,
  WebuiTerminalFrame,
  WebuiTurnDiffView,
  WebuiUpdateSessionRequest,
  WebuiUpdateSessionResult,
  WebuiUsageQuotaResult,
  WebuiVersionInfo,
  WebuiWorkspaceEnvironment,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceGitMutationRequest,
} from "../server/port.js";

/* Attachment shape — used by the components layer, declared here so the
 * projection layer can return an `attachments` array without importing the
 * React component. The actual component lives at
 * `components/MessageAttachments.tsx`. */

export type WebuiMessageAttachmentType = "image" | "file";

export interface WebuiMessageAttachment {
  id: string;
  type: WebuiMessageAttachmentType;
  file_name: string;
  file_path?: string;
  preview_url?: string;
  desktop_path?: string;
  mime_type?: string;
  file_size?: number;
  /** Pre-resolved absolute URL the WebUI should render. */
  src?: string;
}

/* Model picker types — used by `components/ModelPicker.tsx` and
 * `projection/action-requests.ts`; declared here so the projection layer can
 * compose a selection request without importing the React component. */

export interface WebuiModelPickerEntry {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName?: string;
  readonly variant?: string;
  readonly supportedVariants?: readonly string[];
  readonly effortOptions?: readonly string[];
  readonly contextWindowOptions?: readonly number[];
  readonly contextWindowOptionHints?: Readonly<Record<string, string>>;
  readonly contextLimit?: number;
  readonly thinkingConfig?: { readonly mode?: string };
  readonly thinking?: { readonly effort?: string };
  readonly [key: string]: unknown;
}

export interface WebuiModelPickerDraft {
  readonly variant?: string;
  readonly contextLimit?: number;
}

/* Session & message wire types — the loader shape the transport returns. */

export interface WebuiClientMessage {
  readonly msgId: string;
  readonly parentMsgId?: string;
  readonly turnId?: string;
  readonly queryKey?: string;
  readonly timestamp?: number;
  readonly msgContent?: string;
  readonly msgType?: number;
  readonly role?: string;
  readonly thinkingContent?: string;
  readonly thinkingDurationMs?: number;
  readonly finishReason?: string;
  readonly toolCalls?: readonly Record<string, unknown>[];
  readonly attachments?: readonly WebuiMessageAttachment[];
  readonly usage?: Record<string, unknown>;
  readonly source?: string;
  readonly kind?: string;
  readonly actions?: {
    readonly fork?: boolean;
    readonly rewind?: boolean;
    readonly edit?: boolean;
  };
  readonly forkOrigin?: Record<string, unknown>;
  readonly originJson?: string;
  readonly communicationInfosJson?: string;
  readonly rawJson?: string;
  readonly fileChanges?: readonly WebuiFileDiffInfoView[];
  readonly sourceMessageId?: string;
  readonly changeSetId?: string;
  readonly turnDiffStatus?: string;
  readonly revertedAt?: number;
  readonly canUndo?: boolean;
  readonly canReapply?: boolean;
  readonly meta?: Record<string, unknown>;
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
  readonly archived?: boolean;
  readonly status?: unknown;
}

export interface WebuiClientSessionPage {
  readonly sessions: readonly WebuiClientSession[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export type WebuiClientProject = WebuiRecentProject;

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

/* Transcript & diff view models — projection outputs the components consume. */

export type WebuiTranscriptItem =
  | {
      readonly kind: "user" | "assistant" | "thinking";
      readonly text: string;
      readonly messageId: string;
      /** Turn the message belongs to: the key the runtime accepts for a turn diff. */
      readonly turnId?: string;
      readonly durationMs?: number;
      readonly diff?: WebuiTurnDiffView;
      readonly actions?: { readonly fork?: boolean; readonly rewind?: boolean; readonly edit?: boolean };
      readonly timestamp?: number;
      readonly isGoal?: boolean;
      readonly attachments?: readonly WebuiMessageAttachment[];
      readonly usage?: Record<string, unknown>;
    }
  | {
      readonly kind: "tool";
      readonly messageId: string;
      readonly turnId?: string;
      readonly tools: readonly Record<string, unknown>[];
      readonly diff?: WebuiTurnDiffView;
      readonly actions?: { readonly fork?: boolean; readonly rewind?: boolean; readonly edit?: boolean };
      readonly timestamp?: number;
      readonly isGoal?: boolean;
      readonly usage?: Record<string, unknown>;
    }
  | {
      readonly kind: "questionnaire_response";
      readonly messageId: string;
      readonly turnId?: string;
      readonly summary: import("./projection/message-parts.js").WebuiQuestionnaireResponseSummary;
      readonly timestamp?: number;
    };

/** One Desktop-style thinking/tool segment inside an assistant turn. */
export interface WebuiTranscriptProcessSegment {
  readonly messageId: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
}

export interface WebuiDiffState {
  readonly view?: WebuiTurnDiffView;
  readonly unsupported: boolean;
  readonly busy: boolean;
  readonly expanded: boolean;
  readonly reviewing: boolean;
}

export type WebuiDiffStateAction =
  | { readonly type: "loaded"; readonly view: WebuiTurnDiffView }
  | { readonly type: "unsupported" }
  | { readonly type: "begin-mutation" }
  | { readonly type: "mutation-succeeded"; readonly view: WebuiTurnDiffView }
  | { readonly type: "mutation-failed" }
  | { readonly type: "toggle-expanded" }
  | { readonly type: "toggle-review" };

/* Model picker & goal projection shapes. */

export interface WebuiModelSelectionRequest {
  readonly providerId: string;
  readonly modelId: string;
  readonly variant?: string;
  readonly contextLimit?: number;
  readonly sessionId?: string;
}

/* Transport — the single bag of methods the foundation app and the
 * composer consume. Every method here was previously an optional prop on
 * `WebuiClientFoundationAppProps`. The optional semantics are preserved:
 *   - `undefined` means "the operation is not wired" (the panel renders
 *     the affected area conditionally).
 *   - Optional fields stay optional. Optional inputs stay optional.
 *   - The transport itself is optional (so a test that renders the
 *     shell with no transport still gets a "no operations" view).
 *
 * No React imports here — this is a pure type that lives in the
 * contracts layer so the props layer (app.tsx) and the transport
 * implementation (transport.ts) both import it without crossing
 * boundaries. */

export interface WebuiTransport {
  readonly version?: () => Promise<WebuiVersionInfo>;
  readonly loadProjects?: () => Promise<readonly WebuiClientProject[]>;
  readonly listArchivedSessions?: () => Promise<WebuiClientSessionPage>;
  readonly loadSessions?: WebuiClientSessionLoader;
  readonly loadSessionTree?: WebuiClientSessionTreeLoader;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly getSessionDiff?: (
    request: WebuiGetSessionDiffRequest,
  ) => Promise<WebuiGetSessionDiffResult>;
  readonly getTurnDiff?: (
    request: WebuiGetTurnDiffRequest,
  ) => Promise<WebuiGetTurnDiffResult>;
  readonly revertTurnDiff?: (
    request: WebuiRevertTurnDiffRequest,
  ) => Promise<WebuiRevertTurnDiffResult>;
  readonly reapplyTurnDiff?: (
    request: WebuiReapplyTurnDiffRequest,
  ) => Promise<WebuiReapplyTurnDiffResult>;
  readonly getSessionRewindPreview?: (
    request: WebuiGetSessionRewindPreviewRequest,
  ) => Promise<WebuiGetSessionRewindPreviewResult>;
  readonly rewindSession?: (
    request: WebuiRewindSessionRequest,
  ) => Promise<WebuiRewindSessionResult>;
  readonly editSessionMessage?: (
    request: WebuiEditSessionMessageRequest,
  ) => Promise<WebuiEditSessionMessageResult>;
  readonly isGoalEnabled?: () => Promise<WebuiGoalEnabledResult>;
  readonly getGoal?: (
    request: WebuiGoalSessionRequest,
  ) => Promise<WebuiGoal | undefined>;
  readonly createGoal?: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;
  readonly patchGoal?: (request: WebuiGoalPatchRequest) => Promise<WebuiGoal>;
  readonly clearGoal?: (
    request: WebuiGoalSessionRequest,
  ) => Promise<{ readonly success: boolean }>;
  readonly listWorkspaceFileTree?: (request: {
    readonly workspaceDir: string;
    readonly path?: string;
  }) => Promise<readonly WebuiWorkspaceFile[]>;
  readonly readWorkspaceFile?: (request: {
    readonly workspaceDir: string;
    readonly path: string;
  }) => Promise<WebuiWorkspaceFileContent>;
  readonly getWorkspaceEnvironment?: (request: {
    readonly workspaceDir: string;
  }) => Promise<WebuiWorkspaceEnvironment>;
  readonly mutateWorkspaceGit?: (
    request: WebuiWorkspaceGitMutationRequest,
  ) => Promise<Record<string, unknown>>;
  readonly readCanvas?: (request: {
    readonly sessionId: string;
  }) => Promise<WebuiCanvasDocument>;
  readonly applyCanvas?: (request: {
    readonly sessionId: string;
    readonly operation: Record<string, unknown>;
  }) => Promise<unknown>;
  readonly createTerminal?: (request: {
    readonly workspaceDir: string;
  }) => Promise<{ readonly terminalId: string; readonly status: string }>;
  readonly listTerminals?: () => Promise<readonly Record<string, unknown>[]>;
  readonly writeTerminal?: (request: {
    readonly terminalId: string;
    readonly data: string;
  }) => Promise<unknown>;
  readonly disposeTerminal?: (request: {
    readonly terminalId: string;
  }) => Promise<unknown>;
  readonly watchTerminal?: (
    request: { readonly terminalId: string },
    onFrame: (frame: WebuiTerminalFrame) => void,
  ) => () => void;
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
  readonly listQueueMessages?: (request: {
    readonly id: string;
  }) => Promise<{
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
  }) => Promise<WebuiUsageQuotaResult>;
  readonly getSigninPanel?: () => Promise<WebuiSigninPanelView>;
  readonly claimSignin?: () => Promise<WebuiClaimSigninView>;
  readonly getAccountStatus?: (request?: {
    readonly sessionId?: string;
  }) => Promise<Record<string, unknown>>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
  readonly archiveSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly deleteSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly updateSession?: (
    request: WebuiUpdateSessionRequest,
  ) => Promise<WebuiUpdateSessionResult>;
  readonly getSessionForkOptions?: (
    request: WebuiGetSessionForkOptionsRequest,
  ) => Promise<WebuiGetSessionForkOptionsResult>;
  readonly forkSession?: (
    request: WebuiForkSessionRequest,
  ) => Promise<WebuiForkSessionResult>;
  readonly listUserModelProviders?: () => Promise<readonly Record<string, unknown>[]>;
  readonly createUserModelProvider?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly updateUserModelProvider?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly deleteUserModelProvider?: (providerId: string) => Promise<unknown>;
  readonly testUserModelProvider?: (providerId: string) => Promise<unknown>;
  readonly testUserModel?: (request: {
    readonly providerId: string;
    readonly modelId: string;
  }) => Promise<unknown>;
  readonly discoverUserModelsCandidate?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly saveUserModelProviderCandidate?: (
    request: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly listProviderPresets?: () => Promise<readonly Record<string, unknown>[]>;
  readonly getMiniMaxApiKeyStatus?: () => Promise<Record<string, unknown>>;
  readonly upsertMiniMaxApiKey?: (request: {
    readonly apiKey: string;
    readonly saveAndUse?: boolean;
  }) => Promise<unknown>;
  readonly getCodexOAuthStatus?: () => Promise<Record<string, unknown>>;
  readonly runCommand?: (request: {
    readonly command: "help" | "new" | "compact" | "status" | "usage" | "model";
    readonly input?: string;
    readonly sessionId?: string;
    readonly agentName?: string;
    readonly workspaceDir?: string;
  }) => Promise<Record<string, unknown>>;
}

export type {
  WebuiEditSessionMessageRequest,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiFileDiffInfoView,
  WebuiForkSessionRequest,
  WebuiGetSessionDiffRequest,
  WebuiGetSessionDiffResult,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalEnabledResult,
  WebuiGoalPatchRequest,
  WebuiGoalSessionRequest,
  WebuiGoalStatus,
  WebuiInteractionReplyResult,
  WebuiModelEntry,
  WebuiPendingPermission,
  WebuiQueueItem,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireOption,
  WebuiQuestionnaireRequest,
  WebuiQuestionnaireStep,
  WebuiReapplyTurnDiffRequest,
  WebuiReapplyTurnDiffResult,
  WebuiRevertTurnDiffRequest,
  WebuiRevertTurnDiffResult,
  WebuiRewindSessionRequest,
  WebuiRewindSessionResult,
  WebuiRuntimeEvent,
  WebuiStreamFrame,
  WebuiTerminalFrame,
  WebuiTurnDiffView,
};
