import { createRoot, type Root } from "react-dom/client";
import {
  WebuiClientFoundationApp,
  type WebuiClientCreateSessionRequest,
  type WebuiClientCreateSessionResult,
  type WebuiClientMessagePage,
  type WebuiClientMessageLoader,
  type WebuiClientMessageSender,
  type WebuiClientSessionLoader,
  type WebuiClientSessionPage,
} from "./app.js";
import type { WebuiStreamFrame } from "../server/port.js";

declare const document: {
  getElementById(elementId: string): HTMLElement | null;
};

const rootElement = document.getElementById("webui-root");
if (!rootElement) throw new Error("WebUI mount node #webui-root is missing");
interface WebuiRuntimeConfig {
  websocketUrl: string;
  token: string;
}
const config = (
  globalThis as unknown as { __WEBUI_CONFIG__?: WebuiRuntimeConfig }
).__WEBUI_CONFIG__;
if (!config) throw new Error("WebUI runtime configuration is missing");
const runtimeConfig = config;
type WireFrame = {
  readonly kind: string;
  readonly requestId: string;
  readonly body?: unknown;
  readonly message?: string;
};

function websocketUrl(): string {
  return `${runtimeConfig.websocketUrl.replace(/\/$/u, "")}/?token=${encodeURIComponent(runtimeConfig.token)}`;
}

function request<T>(operation: string, body: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl());
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
    ws.addEventListener("error", () =>
      fail(new Error("WebUI connection failed")),
    );
  });
}

function createTransport(): {
  loadSessions: WebuiClientSessionLoader;
  loadMessages: WebuiClientMessageLoader;
  createSession: (
    request: WebuiClientCreateSessionRequest,
  ) => Promise<WebuiClientCreateSessionResult>;
  sendMessage: WebuiClientMessageSender;
} {
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
    sendMessage: (body, onFrame) =>
      new Promise((resolve, reject) => {
        const ws = new WebSocket(websocketUrl());
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
              operation: "sendMessage",
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
            fail(new Error(frame.message ?? "send refused"));
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
        ws.addEventListener("error", () =>
          fail(new Error("WebUI connection failed")),
        );
      }),
  };
}
const transport = createTransport();
const root: Root = createRoot(rootElement);
root.render(
  <WebuiClientFoundationApp
    label="webui-foundation"
    loadSessions={transport.loadSessions}
    loadMessages={transport.loadMessages}
    createSession={transport.createSession}
    sendMessage={transport.sendMessage}
  />,
);

export {
  WebuiClientFoundationApp,
  WebuiSessionList,
  WebuiSessionTranscript,
  subscribeToSessionHash,
} from "./app.js";
