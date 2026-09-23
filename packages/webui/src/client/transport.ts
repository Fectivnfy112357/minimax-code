import type {
  WebuiClientCreateSessionRequest,
  WebuiClientCreateSessionResult,
  WebuiClientMessageLoader,
  WebuiClientMessagePage,
  WebuiClientMessageSender,
  WebuiClientSessionLoader,
  WebuiClientSessionPage,
  WebuiClientSessionResumer,
  WebuiClientSessionTreeLoader,
  WebuiClientSessionTreePage,
} from "./app.js";
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

type WireFrame = {
  readonly kind: string;
  readonly requestId: string;
  readonly body?: unknown;
  readonly message?: string;
};

export interface WebuiSocket {
  addEventListener(
    type: "open" | "message" | "error" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
  send(data: string): void;
  close(): void;
}

export interface WebuiTransportOptions {
  readonly websocketUrl: string;
  readonly token: string;
  readonly webSocket?: new (url: string) => WebuiSocket;
}

export type WebuiClientRuntimeEvent = WebuiRuntimeEvent;
export type WebuiClientEventWatcher = (
  onEvent: (event: WebuiClientRuntimeEvent) => void,
  onReconnect?: () => void,
) => () => void;

function defaultWebSocket(): new (url: string) => WebuiSocket {
  return WebSocket as unknown as new (url: string) => WebuiSocket;
}

export function createWebuiTransport({
  websocketUrl: baseWebsocketUrl,
  token,
  webSocket = defaultWebSocket(),
}: WebuiTransportOptions): {
  version: () => Promise<WebuiVersionInfo>;
  loadSessions: WebuiClientSessionLoader;
  loadSessionTree: WebuiClientSessionTreeLoader;
  listArchivedSessions: () => Promise<WebuiClientSessionPage>;
  archiveSession: (request: { readonly id: string }) => Promise<{ readonly success?: boolean }>;
  deleteSession: (request: { readonly id: string }) => Promise<{ readonly success?: boolean }>;
  loadMessages: WebuiClientMessageLoader;
  listWorkspaceFileTree: (request: { readonly workspaceDir: string; readonly path?: string }) => Promise<readonly import("../server/port.js").WebuiWorkspaceFile[]>;
  readWorkspaceFile: (request: { readonly workspaceDir: string; readonly path: string }) => Promise<import("../server/port.js").WebuiWorkspaceFileContent>;
  getWorkspaceEnvironment: (request: { readonly workspaceDir: string }) => Promise<import("../server/port.js").WebuiWorkspaceEnvironment>;
  mutateWorkspaceGit: (request: import("../server/port.js").WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>;
  readCanvas: (request: { readonly sessionId: string }) => Promise<import("../server/port.js").WebuiCanvasDocument>;
  applyCanvas: (request: { readonly sessionId: string; readonly operation: Record<string, unknown> }) => Promise<{ readonly operationId: string; readonly document: import("../server/port.js").WebuiCanvasDocument }>;
  createTerminal: (request: { readonly workspaceDir: string }) => Promise<{ readonly terminalId: string; readonly status: string }>;
  listTerminals: () => Promise<readonly Record<string, unknown>[]>;
  writeTerminal: (request: { readonly terminalId: string; readonly data: string }) => Promise<{ readonly success: boolean }>;
  disposeTerminal: (request: { readonly terminalId: string }) => Promise<{ readonly success: boolean }>;
  watchTerminal: (request: { readonly terminalId: string }, onFrame: (frame: { readonly terminalId: string; readonly data: string; readonly exited: boolean }) => void) => () => void;
  createSession: (
    request: WebuiClientCreateSessionRequest,
  ) => Promise<WebuiClientCreateSessionResult>;
  sendMessage: WebuiClientMessageSender;
  enqueueMessage: (
    request: WebuiEnqueueMessageRequest,
  ) => Promise<WebuiEnqueueMessageResult>;
  resumeSession: WebuiClientSessionResumer;
  watchEvents: WebuiClientEventWatcher;
  listPendingPermissions: () => Promise<{
    readonly requests: readonly WebuiPendingPermission[];
  }>;
  getPendingQuestionnaire: (request: {
    readonly name: string;
    readonly sessionId: string;
  }) => Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  replyPermission: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: "allowOnce" | "allowAlways" | "deny";
  }) => Promise<WebuiInteractionReplyResult>;
  replyQuestionnaire: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: readonly WebuiQuestionnaireAnswer[];
  }) => Promise<WebuiInteractionReplyResult>;
  dismissQuestionnaire: (request: {
    readonly name: string;
    readonly requestId: string;
  }) => Promise<WebuiInteractionReplyResult>;
  abortSession: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  listQueueMessages: (request: { readonly id: string }) => Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  deleteQueueItem: (request: {
    readonly id: string;
    readonly itemId: string;
  }) => Promise<{ readonly item?: WebuiQueueItem }>;
  listModels: (request?: {
    readonly sessionId?: string;
  }) => Promise<readonly WebuiModelEntry[]>;
  listSkills: (request?: {
    readonly agentName?: string;
  }) => Promise<{
    readonly skills: readonly {
      readonly name: string;
      readonly displayName?: string;
      readonly description?: string;
    }[];
  }>;
  selectModel: (request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly contextLimit?: number;
    readonly sessionId?: string;
  }) => Promise<{ readonly success?: boolean }>;
  getSessionUsage: (request: {
    readonly id: string;
  }) => Promise<Record<string, unknown>>;
  getUsageQuota: (request?: {
    readonly forceRefresh?: boolean;
  }) => Promise<import("../server/port.js").WebuiUsageQuotaResult>;
  getSigninPanel: () => Promise<import("../server/port.js").WebuiSigninPanelView>;
  claimSignin: () => Promise<import("../server/port.js").WebuiClaimSigninView>;
  getAccountStatus: (request?: {
    readonly sessionId?: string;
  }) => Promise<Record<string, unknown>>;
  listUserModelProviders: () => Promise<readonly Record<string, unknown>[]>;
  createUserModelProvider: (request: Record<string, unknown>) => Promise<unknown>;
  updateUserModelProvider: (request: Record<string, unknown>) => Promise<unknown>;
  deleteUserModelProvider: (providerId: string) => Promise<unknown>;
  testUserModelProvider: (providerId: string) => Promise<unknown>;
  testUserModel: (request: { readonly providerId: string; readonly modelId: string }) => Promise<unknown>;
  discoverUserModelsCandidate: (request: Record<string, unknown>) => Promise<unknown>;
  saveUserModelProviderCandidate: (request: Record<string, unknown>) => Promise<unknown>;
  listProviderPresets: () => Promise<readonly Record<string, unknown>[]>;
  getMiniMaxApiKeyStatus: () => Promise<Record<string, unknown>>;
  upsertMiniMaxApiKey: (request: { readonly apiKey: string; readonly saveAndUse?: boolean }) => Promise<unknown>;
  getCodexOAuthStatus: () => Promise<Record<string, unknown>>;
  signOut: () => Promise<{ readonly success?: boolean }>;
  runCommand: (request: {
    readonly command: "help" | "new" | "compact" | "status" | "usage" | "model";
    readonly input?: string;
    readonly sessionId?: string;
    readonly agentName?: string;
    readonly workspaceDir?: string;
  }) => Promise<Record<string, unknown>>;
} {
  const websocketUrl = () =>
    `${baseWebsocketUrl.replace(/\/$/u, "")}/?token=${encodeURIComponent(token)}`;

  function request<T>(operation: string, body: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const ws = new webSocket(websocketUrl());
      const requestId = crypto.randomUUID();
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(error);
      };
      ws.addEventListener("open", () =>
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            kind: "request",
            requestId,
            operation,
            body,
          }),
        ),
      );
      ws.addEventListener("message", (event) => {
        let frame: WireFrame;
        try {
          frame = JSON.parse(String(event.data)) as WireFrame;
        } catch {
          fail(new Error("WebUI returned invalid JSON"));
          return;
        }
        if (frame.requestId !== requestId) return;
        if (frame.kind === "error") {
          fail(new Error(frame.message ?? "WebUI request refused"));
          return;
        }
        if (frame.kind !== "response") return;
        settled = true;
        ws.close();
        resolve(frame.body as T);
      });
      ws.addEventListener("close", () =>
        fail(new Error("WebUI connection closed before the response")),
      );
      ws.addEventListener("error", () =>
        fail(new Error("WebUI connection failed")),
      );
    });
  }

  // `sendMessage` and `resumeSession` share the same wire shape: the
  // operation returns an `event`-framed iterable that ends with a
  // `[DONE]` payload (see `session-stream-delivery.ts` and the brief's
  // "two facts that make this ticket small"). One helper keeps the
  // close/error race in lockstep across both operations.
  function stream(
    operation: string,
    body: unknown,
    onFrame: (frame: WebuiStreamFrame) => void,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new webSocket(websocketUrl());
      const requestId = crypto.randomUUID();
      let settled = false;
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        ws.close();
        reject(error);
      };
      ws.addEventListener("open", () =>
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            kind: "request",
            requestId,
            operation,
            body,
          }),
        ),
      );
      ws.addEventListener("message", (event) => {
        let frame: WireFrame;
        try {
          frame = JSON.parse(String(event.data)) as WireFrame;
        } catch {
          fail(new Error("WebUI returned invalid JSON"));
          return;
        }
        if (frame.requestId !== requestId) return;
        if (frame.kind === "error") {
          fail(new Error(frame.message ?? `${operation} refused`));
          return;
        }
        if (frame.kind !== "event") return;
        const streamFrame = frame.body as WebuiStreamFrame;
        onFrame(streamFrame);
        if (streamFrame.dataJson === "[DONE]") {
          settled = true;
          ws.close();
          resolve();
        }
      });
      ws.addEventListener("close", () =>
        fail(new Error("WebUI connection closed before [DONE]")),
      );
      ws.addEventListener("error", () =>
        fail(new Error("WebUI connection failed")),
      );
    });
  }

  function watchEvents(
    onEvent: (event: WebuiClientRuntimeEvent) => void,
    onReconnect?: () => void,
  ): () => void {
    let stopped = false;
    let socket: WebuiSocket | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      if (stopped) return;
      const ws = new webSocket(websocketUrl());
      socket = ws;
      const requestId = crypto.randomUUID();
      ws.addEventListener("open", () => {
        if (stopped) return;
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            kind: "request",
            requestId,
            operation: "watchEvents",
            body: {},
          }),
        );
        onReconnect?.();
      });
      ws.addEventListener("message", (event) => {
        if (stopped) return;
        let frame: WireFrame;
        try {
          frame = JSON.parse(String(event.data)) as WireFrame;
        } catch {
          return;
        }
        if (frame.requestId !== requestId || frame.kind !== "event") return;
        const body = frame.body;
        if (body && typeof body === "object" && !Array.isArray(body))
          onEvent(body as WebuiClientRuntimeEvent);
      });
      ws.addEventListener("close", () => {
        if (stopped) return;
        reconnectTimer = setTimeout(connect, 250);
      });
      ws.addEventListener("error", () => undefined);
    };
    connect();
    return () => {
      stopped = true;
      if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
      socket?.close();
    };
  }

  function watchTerminal(requestBody: { readonly terminalId: string }, onFrame: (frame: { readonly terminalId: string; readonly data: string; readonly exited: boolean }) => void): () => void {
    let stopped = false;
    const ws = new webSocket(websocketUrl());
    const requestId = crypto.randomUUID();
    ws.addEventListener("open", () => ws.send(JSON.stringify({ protocolVersion: 1, kind: "request", requestId, operation: "watchTerminal", body: requestBody })));
    ws.addEventListener("message", (event) => {
      if (stopped) return;
      let frame: WireFrame;
      try { frame = JSON.parse(String(event.data)) as WireFrame; } catch { return; }
      if (frame.requestId === requestId && frame.kind === "event" && frame.body && typeof frame.body === "object") onFrame(frame.body as { terminalId: string; data: string; exited: boolean });
    });
    return () => { stopped = true; ws.close(); };
  }

  return {
    version: () => request<WebuiVersionInfo>("version", undefined),
    loadSessions: (cursor) =>
      request<WebuiClientSessionPage>("listSessions", {
        name: "main",
        ...(cursor ? { cursor } : {}),
      }),
    loadSessionTree: (cursor) =>
      request<WebuiClientSessionTreePage>("getSessionTree", {
        name: "main",
        limit: 50,
        ...(cursor ? { cursor } : {}),
      }),
    listArchivedSessions: () => request<WebuiClientSessionPage>("listSessions", { name: "main", includeArchived: true, onlyArchived: true }),
    archiveSession: (body) => request("archiveSession", body),
    deleteSession: (body) => request("deleteSession", body),
    loadMessages: ({ id, before }) =>
      request<WebuiClientMessagePage>("getMessages", {
        id,
        ...(before ? { before } : {}),
      }),
    listWorkspaceFileTree: (body) => request("listWorkspaceFileTree", body),
    readWorkspaceFile: (body) => request("readWorkspaceFile", body),
    getWorkspaceEnvironment: (body) => request("getWorkspaceEnvironment", body),
    mutateWorkspaceGit: (body) => request("mutateWorkspaceGit", body),
    readCanvas: (body) => request("readCanvas", body),
    applyCanvas: (body) => request("applyCanvas", body),
    createTerminal: (body) => request("createTerminal", body),
    listTerminals: () => request("listTerminals", {}),
    writeTerminal: (body) => request("writeTerminal", body),
    disposeTerminal: (body) => request("disposeTerminal", body),
    watchTerminal,
    createSession: (body) => request("createSession", body),
    sendMessage: (body, onFrame) => stream("sendMessage", body, onFrame),
    enqueueMessage: (body) => request("enqueueMessage", body),
    resumeSession: (body, onFrame) => stream("resumeSession", body, onFrame),
    watchEvents,
    listPendingPermissions: () => request("listPendingPermissions", {}),
    getPendingQuestionnaire: (body) => request("getPendingQuestionnaire", body),
    replyPermission: (body) => request("replyPermission", body),
    replyQuestionnaire: (body) => request("replyQuestionnaire", body),
    dismissQuestionnaire: (body) => request("dismissQuestionnaire", body),
    abortSession: (body) => request("abortSession", body),
    listQueueMessages: (body) => request("listQueueMessages", body),
    deleteQueueItem: (body) => request("deleteQueueItem", body),
    listModels: (body) => request("listModels", body ?? {}),
    listSkills: (body) => request("listSkills", body ?? {}),
    selectModel: (body) => request("selectModel", body),
    getSessionUsage: (body) => request("getSessionUsage", body),
    getUsageQuota: (body) => request("getUsageQuota", body ?? {}),
    getSigninPanel: () => request("getSigninPanel", {}),
    claimSignin: () => request("claimSignin", {}),
    getAccountStatus: (body) => request("getAccountStatus", body ?? {}),
    listUserModelProviders: () => request("listUserModelProviders", undefined),
    createUserModelProvider: (body) => request("createUserModelProvider", body),
    updateUserModelProvider: (body) => request("updateUserModelProvider", body),
    deleteUserModelProvider: (providerId) => request("deleteUserModelProvider", { providerId }),
    testUserModelProvider: (providerId) => request("testUserModelProvider", { providerId }),
    testUserModel: (body) => request("testUserModel", body),
    discoverUserModelsCandidate: (body) => request("discoverUserModelsCandidate", body),
    saveUserModelProviderCandidate: (body) => request("saveUserModelProviderCandidate", body),
    listProviderPresets: () => request("listProviderPresets", undefined),
    getMiniMaxApiKeyStatus: () => request("getMiniMaxApiKeyStatus", undefined),
    upsertMiniMaxApiKey: (body) => request("upsertMiniMaxApiKey", body),
    getCodexOAuthStatus: () => request("getCodexOAuthStatus", undefined),
    signOut: () => request("signOut", {}),
    runCommand: (body) => request("runCommand", body),
  };
}
