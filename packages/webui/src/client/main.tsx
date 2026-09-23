import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { WebuiClientFoundationApp } from "./app.js";
import { createWebuiTransport } from "./transport.js";
import { route } from "./router.js";
import { LoginCard } from "./components/LoginCard.js";
import { OnboardingSteps } from "./components/OnboardingSteps.js";
import { NotFound } from "./components/NotFound.js";
import { ArchonPage } from "./components/ArchonPage.js";

declare const document: {
  getElementById(elementId: string): HTMLElement | null;
};
declare const location: { readonly host: string; readonly pathname: string; readonly hash: string; href: string };

const rootElement = document.getElementById("webui-root");
if (!rootElement) throw new Error("WebUI mount node #webui-root is missing");
interface WebuiRuntimeConfig {
  websocketUrl: string;
  token: string;
  dataDir?: string;
}
const config = (
  globalThis as unknown as { __WEBUI_CONFIG__?: WebuiRuntimeConfig }
).__WEBUI_CONFIG__;
if (!config) throw new Error("WebUI runtime configuration is missing");
const runtimeConfig = config;
const transport = createWebuiTransport(runtimeConfig);
const sessionId = new URLSearchParams(location.hash.replace(/^#/u, "")).get("session") ?? undefined;
const root: Root = createRoot(rootElement);
const app = <WebuiClientFoundationApp
    label="webui-foundation"
    hostLabel={location.host}
    loadSessions={transport.loadSessions}
    listArchivedSessions={transport.listArchivedSessions}
    loadMessages={transport.loadMessages}
    listWorkspaceFileTree={transport.listWorkspaceFileTree}
    readWorkspaceFile={transport.readWorkspaceFile}
    getWorkspaceEnvironment={transport.getWorkspaceEnvironment}
    mutateWorkspaceGit={transport.mutateWorkspaceGit}
    readCanvas={transport.readCanvas}
    applyCanvas={transport.applyCanvas}
    createTerminal={transport.createTerminal}
    listTerminals={transport.listTerminals}
    writeTerminal={transport.writeTerminal}
    disposeTerminal={transport.disposeTerminal}
    watchTerminal={transport.watchTerminal}
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
    listSkills={transport.listSkills}
    selectModel={transport.selectModel}
    getSessionUsage={transport.getSessionUsage}
    getUsageQuota={transport.getUsageQuota}
    getSigninPanel={transport.getSigninPanel}
    claimSignin={transport.claimSignin}
    getAccountStatus={transport.getAccountStatus}
    signOut={transport.signOut}
    getVersion={transport.version}
    archiveSession={transport.archiveSession}
    deleteSession={transport.deleteSession}
    listUserModelProviders={transport.listUserModelProviders}
    createUserModelProvider={transport.createUserModelProvider}
    updateUserModelProvider={transport.updateUserModelProvider}
    deleteUserModelProvider={transport.deleteUserModelProvider}
    testUserModelProvider={transport.testUserModelProvider}
    testUserModel={transport.testUserModel}
    discoverUserModelsCandidate={transport.discoverUserModelsCandidate}
    saveUserModelProviderCandidate={transport.saveUserModelProviderCandidate}
    listProviderPresets={transport.listProviderPresets}
    getMiniMaxApiKeyStatus={transport.getMiniMaxApiKeyStatus}
    upsertMiniMaxApiKey={transport.upsertMiniMaxApiKey}
    getCodexOAuthStatus={transport.getCodexOAuthStatus}
    dataDir={runtimeConfig.dataDir}
    runCommand={transport.runCommand}
  />;
const currentRoute = route(location.pathname);
root.render(
  currentRoute === "login" ? <LoginCard onContinue={() => { location.href = "/onboarding"; }} /> :
  currentRoute === "onboarding" ? <OnboardingSteps onComplete={() => { location.href = "/archon"; }} /> :
  currentRoute === "404" ? <NotFound /> : <ArchonPage>{app}</ArchonPage>,
);

export {
  WebuiClientFoundationApp,
  WebuiSessionList,
  WebuiSessionTranscript,
  subscribeToSessionHash,
} from "./app.js";
