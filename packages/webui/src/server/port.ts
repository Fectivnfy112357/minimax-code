// Harness seam for the WebUI service.
//
// The service uses this port to reach the harness layer; the real
// implementation is wired to the in-process runtime host (ADR 0001) and its
// `CliService` facade. Tests substitute a scripted stand-in so the access
// control, transport, envelope and shutdown story can be exercised without
// owning a real database (ADR 0006).
//
// Keep this projection deliberately owned by WebUI: the browser needs a
// stable wire shape, while the runtime keeps its richer process-local
// contracts private to the harness adapter.

export interface WebuiVersionInfo {
  readonly version: string;
  readonly protocolVersion: number;
}

export interface WebuiSessionListRequest {
  readonly name: string;
  readonly limit?: number;
  readonly offset?: number;
  readonly cursor?: string;
  readonly includeArchived?: boolean;
  readonly onlyArchived?: boolean;
  readonly onlyCompressed?: boolean;
  readonly includeHidden?: boolean;
  readonly includePurposePrefix?: string;
  readonly excludePurposePrefix?: string;
}

export interface WebuiSessionListItem {
  readonly sessionId: string;
  readonly agentName: string;
  readonly sessionType?: string;
  readonly archived?: boolean;
  readonly status?: unknown;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly workspaceDir?: string;
  readonly frameworkType?: string;
  readonly isDefaultWorkspace?: boolean;
  readonly visibility?: string;
  readonly sessionKind?: string;
  readonly title?: string;
  readonly parentSessionId?: string;
  readonly purpose?: string;
}

export interface WebuiSessionPage {
  readonly sessions: readonly WebuiSessionListItem[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export interface WebuiSessionLookupRequest {
  readonly id: string;
}
export interface WebuiSessionInfo {
  readonly sessionId?: string;
  readonly agentName?: string;
  readonly title?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly workspaceDir?: string;
  readonly [key: string]: unknown;
}
export interface WebuiSessionLookupResult {
  readonly session?: WebuiSessionInfo;
}
export interface WebuiCreateSessionRequest {
  readonly name: string;
  readonly workspaceDir: string;
}
export interface WebuiCreateSessionResult {
  readonly agentName?: string;
  readonly sessionId?: string;
  readonly session?: WebuiSessionInfo;
}
export interface WebuiMessage {
  readonly msgId: string;
  readonly parentMsgId?: string;
  readonly timestamp?: number;
  readonly msgContent?: string;
  readonly msgType?: number;
  readonly role?: string;
  readonly thinkingContent?: string;
  readonly thinkingDurationMs?: number;
  readonly finishReason?: string;
  readonly toolCalls?: readonly Record<string, unknown>[];
  readonly source?: string;
  readonly kind?: string;
  readonly turnId?: string;
  readonly [key: string]: unknown;
}
export interface WebuiMessagesRequest {
  readonly id: string;
  readonly limit?: number;
  readonly before?: string;
  readonly includeAttachmentReadUrls?: boolean;
}
export interface WebuiMessagesResult {
  readonly messages?: readonly WebuiMessage[];
  readonly nextCursor?: string;
  readonly lastMsgId?: string;
  readonly hasMore?: boolean;
  readonly todosJson?: string;
  readonly queryCollapseViews?: readonly Record<string, unknown>[];
  readonly turnResults?: readonly Record<string, unknown>[];
}

/** Deliberately small WebUI-owned shape; the browser does not import the harness contract. */
export interface WebuiSendMessageRequest {
  readonly id: string;
  readonly content?: string;
  readonly turnId?: string;
  readonly clientIntent?: string;
}

export interface WebuiEnqueueMessageRequest {
  readonly id: string;
  readonly content: string;
  readonly model?: Record<string, unknown>;
  readonly clientRequestId?: string;
  readonly clientIntent?: string;
}

export interface WebuiEnqueueMessageResult {
  readonly itemId?: string;
  readonly status?: string;
  readonly position?: number;
}

/**
 * Wire shape for `resumeSession` on the WebUI envelope. The harness
 * `ResumeSessionInput` is what the runtime layer ultimately consumes; this
 * type is a deliberately narrow projection so the browser can ask for a
 * resume without importing the harness contract.
 */
export interface WebuiResumeSessionRequest {
  readonly id: string;
  /** Resume from the stream cursor the client last advanced past. */
  readonly afterCursor?: string;
  /** Resume from after a specific persisted message id, when known. */
  readonly afterMsgId?: string;
  /** Drain any queued turns after the resume point. */
  readonly drainQueued?: boolean;
}

export interface WebuiPendingPermission {
  readonly requestId: string;
  readonly sessionId: string;
  readonly agentName: string;
  readonly toolName: string;
  readonly ruleContents: readonly string[];
  readonly toolInput?: string;
  readonly toolDescription?: string;
  readonly reason: string;
  readonly allowAlwaysSupported: boolean;
  readonly createdAt: number;
}

export interface WebuiQuestionnaireOption {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly recommended?: boolean;
}

export interface WebuiQuestionnaireStep {
  readonly id: string;
  readonly header?: string;
  readonly question: string;
  readonly description?: string;
  readonly selectionMode: number;
  readonly options?: readonly WebuiQuestionnaireOption[];
  readonly allowOther: boolean;
  readonly otherPlaceholder: string;
  readonly required: boolean;
}

export interface WebuiQuestionnaireRequest {
  readonly schemaVersion: number;
  readonly id: string;
  readonly title?: string;
  readonly requester?: {
    readonly sessionId: string;
    readonly runId?: string;
    readonly toolCallId?: string;
    readonly agentName?: string;
  };
  readonly presentation: {
    readonly replaceComposer: boolean;
    readonly showProgress: boolean;
    readonly allowBackNavigation: boolean;
  };
  readonly steps: readonly WebuiQuestionnaireStep[];
  readonly expiresAt?: number;
  readonly status?: number;
  readonly createdAt?: number;
  readonly mode?: string;
  readonly purpose?: number;
}

export interface WebuiQuestionnaireAnswer {
  readonly stepId: string;
  readonly selectedOptionIds?: readonly string[];
  readonly selectedOther?: boolean;
  readonly otherText?: string;
  readonly skipped?: boolean;
}

export type WebuiPermissionDecision = "allowOnce" | "allowAlways" | "deny";

export interface WebuiRuntimeEvent {
  readonly type: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: number;
  readonly source: string;
}

export type WebuiWatchEventsResult =
  | {
      readonly ok: true;
      readonly source:
        AsyncIterable<WebuiRuntimeEvent> | Iterable<WebuiRuntimeEvent>;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly body: {
        readonly key?: string;
        readonly message: string;
        readonly detail?: string;
      };
    };

export interface WebuiStreamFrame {
  readonly cursor?: string;
  readonly eventJson?: string;
  readonly dataJson?: string;
  readonly messageActionDeltas?: readonly Record<string, unknown>[];
  readonly projection?: unknown;
}

/**
 * Result envelope shared between `sendMessage` and `resumeSession`: the
 * harness session-stream contract returns an iterable source on success or
 * a structured error body on failure. The wire envelope (`event` frames
 * over a WebSocket) is the same in both cases — see the brief's "two
 * facts that make this ticket small".
 */
export type WebuiStreamResult =
  | {
      readonly ok: true;
      readonly source:
        AsyncIterable<WebuiStreamFrame> | Iterable<WebuiStreamFrame>;
    }
  | {
      readonly ok: false;
      readonly status: number;
      readonly body: {
        readonly key?: string;
        readonly message: string;
        readonly detail?: string;
      };
    };

/** `sendMessage` returns the same shape as a resume — kept as an alias. */
export type WebuiSendMessageResult = WebuiStreamResult;

export interface WebuiInteractionReplyResult {
  readonly success?: boolean;
  readonly ok?: boolean;
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly answeredAt?: number;
  readonly dismissedAt?: number;
}

export interface WebuiQueueItem {
  readonly itemId: string;
  readonly sessionId: string;
  readonly status: string;
  readonly content?: string;
  readonly source?: string;
  readonly failedReason?: string;
  readonly createdAt?: number;
  readonly startedAt?: number;
  readonly finishedAt?: number;
}

export interface WebuiModelEntry {
  readonly providerId: string;
  readonly modelId: string;
  readonly displayName?: string;
  readonly selected?: boolean;
  readonly enabled?: boolean;
  readonly variant?: string;
  readonly providerName?: string;
  readonly status?: {
    readonly state?: string;
    readonly lastErrorMessage?: string;
  };
  readonly [key: string]: unknown;
}

export interface WebuiRunCommandRequest {
  readonly command: "help" | "new" | "compact" | "status" | "usage" | "model";
  readonly input?: string;
  readonly sessionId?: string;
  readonly agentName?: string;
  readonly workspaceDir?: string;
}

export type WebuiRunCommandResult =
  | { readonly handled: true; readonly output: string; readonly data?: unknown }
  | { readonly handled: true; readonly output?: undefined; readonly data: unknown };

export interface WebuiHarnessPort {
  version(): WebuiVersionInfo;
  listSessions(request: WebuiSessionListRequest): Promise<WebuiSessionPage>;
  createSession(
    request: WebuiCreateSessionRequest,
  ): Promise<WebuiCreateSessionResult>;
  getSession(
    request: WebuiSessionLookupRequest,
  ): Promise<WebuiSessionLookupResult>;
  getMessages(request: WebuiMessagesRequest): Promise<WebuiMessagesResult>;
  sendMessage(
    request: WebuiSendMessageRequest,
    signal?: AbortSignal,
  ): Promise<WebuiSendMessageResult>;
  enqueueMessage(
    request: WebuiEnqueueMessageRequest,
  ): Promise<WebuiEnqueueMessageResult>;
  /**
   * Resume a session stream from a cursor the client previously advanced
   * past. Returns the same iterable source as `sendMessage` — the harness
   * reuses the session-stream contract for both — so the wire envelope and
   * the reducer can stay unchanged.
   */
  resumeSession(
    request: WebuiResumeSessionRequest,
    signal?: AbortSignal,
  ): Promise<WebuiStreamResult>;
  watchEvents(signal?: AbortSignal): AsyncIterable<WebuiRuntimeEvent>;
  listPendingPermissions(): Promise<{
    readonly requests: readonly WebuiPendingPermission[];
  }>;
  getPendingQuestionnaire(request: {
    readonly name: string;
    readonly sessionId: string;
  }): Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  replyPermission(request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: WebuiPermissionDecision;
  }): Promise<WebuiInteractionReplyResult>;
  replyQuestionnaire(request: {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: readonly WebuiQuestionnaireAnswer[];
  }): Promise<WebuiInteractionReplyResult>;
  dismissQuestionnaire(request: {
    readonly name: string;
    readonly requestId: string;
  }): Promise<WebuiInteractionReplyResult>;
  abortSession(request: {
    readonly id: string;
  }): Promise<{ readonly success?: boolean }>;
  listQueueMessages(request: { readonly id: string }): Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  deleteQueueItem(request: {
    readonly id: string;
    readonly itemId: string;
  }): Promise<{ readonly item?: WebuiQueueItem }>;
  listModels(request?: {
    readonly sessionId?: string;
  }): Promise<readonly WebuiModelEntry[]>;
  selectModel(request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly sessionId?: string;
  }): Promise<{ readonly success?: boolean }>;
  getSessionUsage(request: {
    readonly id: string;
  }): Promise<Record<string, unknown>>;
  getAccountStatus(request?: {
    readonly sessionId?: string;
  }): Promise<Record<string, unknown>>;
  requestCompaction(request: {
    readonly name: string;
    readonly id: string;
    readonly reason: "ui_request";
    readonly customInstructions?: string;
  }): Promise<Record<string, unknown>>;
  /**
   * Release anything the port owns. The service calls this after closing
   * every transport-side resource so the harness can tear itself down in
   * the order step 13 of the assembly checklist requires.
   */
  close(): Promise<void>;
}
