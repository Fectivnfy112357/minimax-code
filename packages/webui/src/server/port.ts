// Harness seam for the WebUI service.
//
// The service uses this port to reach the harness layer; the real
// implementation is wired to the in-process runtime host (ADR 0001) and its
// `CliService` facade. Tests substitute a scripted stand-in so the access
// control, transport, envelope and shutdown story can be exercised without
// owning a real database (ADR 0006).
//
// The ticket only needs `version()`: assembly steps 5 (tool capabilities)
// and 10 (send/stream) belong to later tickets, so the surface stays
// minimal and never pretends to be the full application facade.

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

export interface WebuiSessionLookupRequest { readonly id: string; }
export interface WebuiSessionInfo {
  readonly sessionId?: string;
  readonly agentName?: string;
  readonly title?: string;
  readonly createdAt?: number;
  readonly updatedAt?: number;
  readonly workspaceDir?: string;
  readonly [key: string]: unknown;
}
export interface WebuiSessionLookupResult { readonly session?: WebuiSessionInfo; }
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

export interface WebuiHarnessPort {
  version(): WebuiVersionInfo;
  listSessions(request: WebuiSessionListRequest): Promise<WebuiSessionPage>;
  getSession(request: WebuiSessionLookupRequest): Promise<WebuiSessionLookupResult>;
  getMessages(request: WebuiMessagesRequest): Promise<WebuiMessagesResult>;
  /**
   * Release anything the port owns. The service calls this after closing
   * every transport-side resource so the harness can tear itself down in
   * the order step 13 of the assembly checklist requires.
   */
  close(): Promise<void>;
}
