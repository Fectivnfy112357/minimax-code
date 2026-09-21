// Client entry for the WebUI package. The first version is a foundation
// only; the browser code mounts a placeholder root that records its
// presence so later tickets can replace it without changing the entry point
// the build graph sees.

import { createRoot, type Root } from "react-dom/client";
import {
  WebuiClientFoundationApp,
  type WebuiClientMessageSender,
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
function createSender(): WebuiClientMessageSender {
  return (request, onFrame) =>
    new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `${runtimeConfig.websocketUrl}/?token=${encodeURIComponent(runtimeConfig.token)}`,
      );
      const requestId = crypto.randomUUID();
      ws.addEventListener("open", () =>
        ws.send(
          JSON.stringify({
            protocolVersion: 1,
            kind: "request",
            requestId,
            operation: "sendMessage",
            body: request,
          }),
        ),
      );
      ws.addEventListener("message", (event) => {
        const frame = JSON.parse(String(event.data)) as {
          kind: string;
          requestId: string;
          body?: WebuiStreamFrame;
          message?: string;
        };
        if (frame.requestId !== requestId) return;
        if (frame.kind === "event") onFrame(frame.body!);
        else if (frame.kind === "error") {
          ws.close();
          reject(new Error(frame.message ?? "send refused"));
        }
        if (frame.kind === "event" && frame.body?.dataJson === "[DONE]") {
          ws.close();
          resolve();
        }
      });
      ws.addEventListener("error", () =>
        reject(new Error("WebUI connection failed")),
      );
    });
}
const root: Root = createRoot(rootElement);
root.render(
  <WebuiClientFoundationApp
    label="webui-foundation"
    sendMessage={createSender()}
  />,
);

export {
  WebuiClientFoundationApp,
  WebuiSessionList,
  WebuiSessionTranscript,
  subscribeToSessionHash,
} from "./app.js";
