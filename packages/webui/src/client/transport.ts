import type {
  WebuiClientCreateSessionRequest,
  WebuiClientCreateSessionResult,
  WebuiClientMessageLoader,
  WebuiClientMessagePage,
  WebuiClientMessageSender,
  WebuiClientSessionLoader,
  WebuiClientSessionPage,
  WebuiClientSessionResumer,
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
  loadSessions: WebuiClientSessionLoader;
  loadMessages: WebuiClientMessageLoader;
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
  selectModel: (request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly sessionId?: string;
  }) => Promise<{ readonly success?: boolean }>;
  getSessionUsage: (request: {
    readonly id: string;
  }) => Promise<Record<string, unknown>>;
  getAccountStatus: (request?: {
    readonly sessionId?: string;
  }) => Promise<Record<string, unknown>>;
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

  return {
    loadSessions: (cursor) =>
      request<WebuiClientSessionPage>("listSessions", {
        name: "main",
        ...(cursor ? { cursor } : {}),
      }),
    loadMessages: ({ id, before }) =>
      request<WebuiClientMessagePage>("getMessages", {
        id,
        ...(before ? { before } : {}),
      }),
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
    selectModel: (body) => request("selectModel", body),
    getSessionUsage: (body) => request("getSessionUsage", body),
    getAccountStatus: (body) => request("getAccountStatus", body ?? {}),
    runCommand: (body) => request("runCommand", body),
  };
}
