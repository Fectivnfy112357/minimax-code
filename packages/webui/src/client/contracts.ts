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
  WebuiEditSessionMessageRequest,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiFileDiffInfoView,
  WebuiForkSessionRequest,
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalEnabledResult,
  WebuiGoalPatchRequest,
  WebuiGoalSessionRequest,
  WebuiGoalStatus,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiModelEntry,
  WebuiPendingPermission,
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
  WebuiTurnDiffView,
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

export type {
  WebuiEditSessionMessageRequest,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiFileDiffInfoView,
  WebuiForkSessionRequest,
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
  WebuiModelEntry,
  WebuiPendingPermission,
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
  WebuiTurnDiffView,
};