import { runWebuiCommand } from "./commands/runner.js";
import type { WebuiHarnessPort } from "./port.js";
import {
  projectContextSnapshot,
  projectSessionStream,
  projectUsage,
} from "./projections/index.js";
import type { WebuiOperationHandler } from "./operation-contract.js";
import type { WebuiTerminalManager } from "./terminal.js";

export type WebuiOperationPort = Pick<
  WebuiHarnessPort,
  | "version"
  | "listSessions"
  | "getSessionTree"
  | "archiveSession"
  | "deleteSession"
  | "updateSession"
  | "getSessionForkOptions"
  | "forkSession"
  | "createSession"
  | "getSession"
  | "getMessages"
  | "getSessionDiff"
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
  | "isGoalEnabled"
  | "getGoal"
  | "createGoal"
  | "patchGoal"
  | "clearGoal"
  | "listWorkspaceFileTree"
  | "readWorkspaceFile"
  | "getWorkspaceEnvironment"
  | "mutateWorkspaceGit"
  | "readCanvas"
  | "applyCanvas"
  | "sendMessage"
  | "enqueueMessage"
  | "resumeSession"
  | "watchEvents"
  | "listPendingPermissions"
  | "getPendingQuestionnaire"
  | "replyPermission"
  | "replyQuestionnaire"
  | "dismissQuestionnaire"
  | "abortSession"
  | "listQueueMessages"
  | "deleteQueueItem"
  | "listModels"
  | "selectModel"
  | "listSkills"
  | "getSessionUsage"
  | "getUsageQuota"
  | "getSigninPanel"
  | "claimSignin"
  | "getAccountStatus"
  | "listUserModelProviders"
  | "createUserModelProvider"
  | "updateUserModelProvider"
  | "deleteUserModelProvider"
  | "testUserModelProvider"
  | "testUserModel"
  | "discoverUserModelsCandidate"
  | "saveUserModelProviderCandidate"
  | "listProviderPresets"
  | "getMiniMaxApiKeyStatus"
  | "upsertMiniMaxApiKey"
  | "getCodexOAuthStatus"
  | "requestCompaction"
  | "invalidateAuth"
>;

export type WebuiOperationHandlers = Record<string, WebuiOperationHandler<unknown>>;

export function createOperationHandlers(
  port: WebuiOperationPort,
  terminal?: WebuiTerminalManager,
): WebuiOperationHandlers {
  const handlers: WebuiOperationHandlers = {
    createSession: async (_context, body) => ({
      body: await port.createSession(body as never),
    }),
    listWorkspaceFileTree: async (_context, body) => ({
      body: await port.listWorkspaceFileTree!(body as never) as unknown as Record<string, unknown>,
    }),
    readWorkspaceFile: async (_context, body) => ({
      body: await port.readWorkspaceFile!(body as never) as unknown as Record<string, unknown>,
    }),
    readCanvas: async (_context, body) => ({
      body: await port.readCanvas!(body as never) as unknown as Record<string, unknown>,
    }),
    applyCanvas: async (_context, body) => ({
      body: await port.applyCanvas!(body as never) as unknown as Record<string, unknown>,
    }),
    getWorkspaceEnvironment: async (_context, body) => ({
      body: await port.getWorkspaceEnvironment!(body as never) as unknown as Record<string, unknown>,
    }),
    mutateWorkspaceGit: async (_context, body) => ({
      body: await port.mutateWorkspaceGit!(body as never),
    }),
    createTerminal: async (_context, body) => ({
      body: terminal!.create(String((body as Record<string, unknown>).workspaceDir ?? process.cwd())),
    }),
    listTerminals: async () => ({
      body: terminal!.list() as unknown as Record<string, unknown>,
    }),
    writeTerminal: async (_context, body) => {
      const value = body as Record<string, unknown>;
      return { body: terminal!.write(String(value.terminalId), String(value.data ?? "")) };
    },
    resizeTerminal: async (_context, body) => {
      const value = body as Record<string, unknown>;
      return { body: terminal!.resize(String(value.terminalId), Number(value.cols), Number(value.rows)) };
    },
    disposeTerminal: async (_context, body) => ({
      body: terminal!.dispose(String((body as Record<string, unknown>).terminalId)),
    }),
    watchTerminal: (_context, body) => ({
      stream: {
        ok: true,
        source: terminal!.watch(
          String((body as Record<string, unknown>).terminalId),
          _context.signal,
        ) as unknown as AsyncIterable<Record<string, unknown>>,
      },
    }),
    archiveSession: async (_context, body) => ({ body: await port.archiveSession(body as never) }),
    deleteSession: async (_context, body) => ({ body: await port.deleteSession(body as never) }),
    updateSession: async (_context, body) => ({ body: await port.updateSession(body as never) }),
    getSessionForkOptions: async (_context, body) => ({ body: await port.getSessionForkOptions(body as never) }),
    forkSession: async (_context, body) => ({ body: await port.forkSession(body as never) }),
    abortSession: async (_context, body) => ({ body: await port.abortSession(body as never) }),
    listQueueMessages: async (_context, body) => ({ body: await port.listQueueMessages(body as never) }),
    deleteQueueItem: async (_context, body) => ({ body: await port.deleteQueueItem(body as never) }),
    listModels: async (_context, body) => ({ body: await port.listModels(body as never) }),
    selectModel: async (_context, body) => ({ body: await port.selectModel(body as never) }),
    listSkills: async (_context, body) => ({ body: await port.listSkills(body as never) }),
    getSessionUsage: async (_context, body) => ({ body: await port.getSessionUsage(body as never) }),
    getUsageQuota: async (_context, body) => ({ body: await port.getUsageQuota(body as never) }),
    getSigninPanel: async () => ({ body: await port.getSigninPanel() }),
    claimSignin: async () => ({ body: await port.claimSignin() }),
    getAccountStatus: async (_context, body) => ({ body: await port.getAccountStatus(body as never) }),
    listUserModelProviders: async () => ({ body: await port.listUserModelProviders() }),
    createUserModelProvider: async (_context, body) => ({ body: await port.createUserModelProvider(body as never) }),
    updateUserModelProvider: async (_context, body) => ({ body: await port.updateUserModelProvider(body as never) }),
    deleteUserModelProvider: async (_context, body) => ({ body: await port.deleteUserModelProvider((body as Record<string, unknown>).providerId as string) }),
    testUserModelProvider: async (_context, body) => ({ body: await port.testUserModelProvider((body as Record<string, unknown>).providerId as string) }),
    testUserModel: async (_context, body) => ({ body: await port.testUserModel(body as never) }),
    discoverUserModelsCandidate: async (_context, body) => ({ body: await port.discoverUserModelsCandidate(body as never) }),
    saveUserModelProviderCandidate: async (_context, body) => ({ body: await port.saveUserModelProviderCandidate(body as never) }),
    listProviderPresets: async () => ({ body: await port.listProviderPresets() }),
    getMiniMaxApiKeyStatus: async () => ({ body: await port.getMiniMaxApiKeyStatus() }),
    upsertMiniMaxApiKey: async (_context, body) => ({ body: await port.upsertMiniMaxApiKey(body as never) }),
    getCodexOAuthStatus: async () => ({ body: await port.getCodexOAuthStatus() }),
    runCommand: async (_context, body) => ({ body: await runWebuiCommand(port, body as never) }),
    signOut: async () => {
      if (!port.invalidateAuth) throw new Error("auth invalidation is unavailable");
      await port.invalidateAuth();
      return { body: { success: true as const } };
    },
    watchEvents: (context) => ({
      stream: { ok: true, source: port.watchEvents(context.signal) },
    }),
    listPendingPermissions: async () => ({ body: await port.listPendingPermissions() }),
    getPendingQuestionnaire: async (_context, body) => ({ body: await port.getPendingQuestionnaire(body as never) }),
    replyPermission: async (_context, body) => ({ body: await port.replyPermission(body as never) }),
    replyQuestionnaire: async (_context, body) => ({ body: await port.replyQuestionnaire(body as never) }),
    dismissQuestionnaire: async (_context, body) => ({ body: await port.dismissQuestionnaire(body as never) }),
    version: () => ({ body: port.version() }),
    getSession: async (_context, body) => ({ body: await port.getSession(body as never) }),
    getMessages: async (_context, body) => {
      const result = await port.getMessages(body as never);
      const messages = result.messages ?? [];
      const turnId =
        [...messages].reverse().find((message) => message.turnId)?.turnId ?? "";
      return {
        body: {
          ...result,
          contextSnapshot: projectContextSnapshot({
            active: false,
            messages: messages.map((message) => ({
              kind: message.kind,
              timestamp: message.timestamp,
              rawJson: JSON.stringify(message),
            })),
          }) as unknown as Record<string, unknown>,
          usage: projectUsage(messages, turnId),
        },
      };
    },
    getSessionDiff: async (_context, body) => ({ body: await port.getSessionDiff!(body as never) }),
    getTurnDiff: async (_context, body) => ({ body: await port.getTurnDiff!(body as never) }),
    revertTurnDiff: async (_context, body) => ({ body: await port.revertTurnDiff!(body as never) }),
    reapplyTurnDiff: async (_context, body) => ({ body: await port.reapplyTurnDiff!(body as never) }),
    getSessionRewindPreview: async (_context, body) => ({ body: await port.getSessionRewindPreview!(body as never) }),
    rewindSession: async (_context, body) => ({ body: await port.rewindSession!(body as never) }),
    editSessionMessage: async (_context, body) => ({ body: await port.editSessionMessage!(body as never) }),
    isGoalEnabled: async () => ({ body: await port.isGoalEnabled!() }),
    getGoal: async (_context, body) => ({ body: await port.getGoal!(body as never) }),
    createGoal: async (_context, body) => ({ body: await port.createGoal!(body as never) }),
    patchGoal: async (_context, body) => ({ body: await port.patchGoal!(body as never) }),
    clearGoal: async (_context, body) => ({ body: await port.clearGoal!(body as never) }),
    listSessions: async (_context, body) => ({ body: await port.listSessions(body as never) }),
    getSessionTree: async (_context, body) => ({ body: await port.getSessionTree(body as never) }),
    sendMessage: async (context, body) => {
      const stream = await port.sendMessage(body as never, context.signal);
      return {
        stream: stream.ok
          ? { ...stream, source: projectSessionStream(stream.source) }
          : stream,
      };
    },
    enqueueMessage: async (_context, body) => ({ body: await port.enqueueMessage(body as never) }),
    resumeSession: async (context, body) => {
      const stream = await port.resumeSession(body as never, context.signal);
      return {
        stream: stream.ok
          ? { ...stream, source: projectSessionStream(stream.source) }
          : stream,
      };
    },
  };

  return handlers;
}
