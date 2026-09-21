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
import type { WebuiStreamFrame } from "../server/port.js";

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
  resumeSession: WebuiClientSessionResumer;
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
    resumeSession: (body, onFrame) =>
      stream("resumeSession", body, onFrame),
  };
}
