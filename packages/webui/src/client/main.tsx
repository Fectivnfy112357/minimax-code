import { createRoot, type Root } from "react-dom/client";
import { WebuiClientFoundationApp } from "./app.js";
import { createWebuiTransport } from "./transport.js";

declare const document: {
  getElementById(elementId: string): HTMLElement | null;
};
declare const location: { readonly host: string };

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
const transport = createWebuiTransport(runtimeConfig);
const root: Root = createRoot(rootElement);
root.render(
  <WebuiClientFoundationApp
    label="webui-foundation"
    hostLabel={location.host}
    loadSessions={transport.loadSessions}
    loadMessages={transport.loadMessages}
    createSession={transport.createSession}
    sendMessage={transport.sendMessage}
    enqueueMessage={transport.enqueueMessage}
    resumeSession={transport.resumeSession}
    watchEvents={transport.watchEvents}
    listPendingPermissions={transport.listPendingPermissions}
    getPendingQuestionnaire={transport.getPendingQuestionnaire}
    replyPermission={transport.replyPermission}
    replyQuestionnaire={transport.replyQuestionnaire}
    dismissQuestionnaire={transport.dismissQuestionnaire}
    abortSession={transport.abortSession}
    listQueueMessages={transport.listQueueMessages}
    deleteQueueItem={transport.deleteQueueItem}
    listModels={transport.listModels}
    selectModel={transport.selectModel}
    getSessionUsage={transport.getSessionUsage}
    getAccountStatus={transport.getAccountStatus}
  />,
);

export {
  WebuiClientFoundationApp,
  WebuiSessionList,
  WebuiSessionTranscript,
  subscribeToSessionHash,
} from "./app.js";
