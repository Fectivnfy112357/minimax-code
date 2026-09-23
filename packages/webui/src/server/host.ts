// Wires the harness layer to the WebUI service.
//
// The harness port's `version()` reads the version that the runtime host was
// started with (`appVersion`). The host itself is owned by the runtime
// package, not by the WebUI, so this module is a thin adapter: it accepts
// a host, extracts the version, and exposes the close hook on the harness
// port so the service can shut down the host in the order step 13 of the
// assembly checklist requires.
//
// The host shape is structural so the WebUI does not need to bundle the
// whole harness layer to type-check; the runtime assembly passes the host
// directly at process start.

import { WEBUI_PROTOCOL_VERSION } from "./envelope.js";
import type {
  WebuiHarnessPort,
  WebuiSessionListRequest,
  WebuiSessionPage,
  WebuiSessionTreeRequest,
  WebuiSessionTreePage,
  WebuiCreateSessionRequest,
  WebuiCreateSessionResult,
  WebuiVersionInfo,
  WebuiSendMessageRequest,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiSendMessageResult,
  WebuiResumeSessionRequest,
  WebuiStreamResult,
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
  WebuiQuestionnaireAnswer,
  WebuiRuntimeEvent,
  WebuiInteractionReplyResult,
  WebuiPermissionDecision,
  WebuiQueueItem,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceEnvironment,
  WebuiWorkspaceGitMutationRequest,
  WebuiCanvasDocument,
  WebuiModelEntry,
} from "./port.js";

export interface WebuiRuntimeHostHandle {
  readonly apiHost: { close(): Promise<void> };
  readonly appVersion?: string;
  readonly dataDir?: string;
  readonly invalidateAuth?: () => void;
  /**
   * Cloud quota for the usage panel. Backed by `usage-quota.ts`, not the
   * harness — the assembly supplies the client alongside the host.
   */
  readonly getUsageQuota?: (request?: {
    readonly forceRefresh?: boolean;
  }) => Promise<import("./port.js").WebuiUsageQuotaResult>;
  /**
   * Daily check-in status/claim. Backed by `check-in.ts` (cloud), supplied
   * by the assembly alongside the host.
   */
  readonly getSigninPanel?: () => Promise<import("./port.js").WebuiSigninPanelView>;
  readonly claimSignin?: () => Promise<import("./port.js").WebuiClaimSigninView>;
  readonly cliService?: {
    listSessions(
      request: WebuiSessionListRequest,
      context?: Record<string, never>,
    ): Promise<WebuiSessionPage>;
    getSessionTree(
      request: WebuiSessionTreeRequest,
      context?: Record<string, never>,
    ): Promise<WebuiSessionTreePage>;
    archiveSession(
      request: { readonly id: string },
      context?: Record<string, never>,
    ): Promise<{ readonly success?: boolean }>;
    deleteSession(
      request: { readonly id: string },
      context?: Record<string, never>,
    ): Promise<{ readonly success?: boolean }>;
    updateSession(
      request: import("./port.js").WebuiUpdateSessionRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiUpdateSessionResult>;
    getSessionForkOptions(
      request: import("./port.js").WebuiGetSessionForkOptionsRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiGetSessionForkOptionsResult>;
    forkSession(
      request: import("./port.js").WebuiForkSessionRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiForkSessionResult>;
    createSession(
      request: WebuiCreateSessionRequest,
      context?: Record<string, never>,
    ): Promise<WebuiCreateSessionResult>;
    getSession(
      request: import("./port.js").WebuiSessionLookupRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiSessionLookupResult>;
    getMessages(
      request: import("./port.js").WebuiMessagesRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiMessagesResult>;
    listWorkspaceFileTree?(request: { readonly workspaceDir: string; readonly path?: string }): Promise<readonly WebuiWorkspaceFile[]>;
    readWorkspaceFile?(request: { readonly workspaceDir: string; readonly path: string }): Promise<WebuiWorkspaceFileContent>;
    getWorkspaceGitEnvironment?(workspaceDir: string): Promise<{ readonly metadata: Record<string, unknown>; readonly changes: Record<string, unknown> }>;
    mutateWorkspaceGit?(request: WebuiWorkspaceGitMutationRequest): Promise<Record<string, unknown>>;
    readCanvas?(request: { readonly sessionId: string }): Promise<WebuiCanvasDocument>;
    applyCanvas?(request: { readonly sessionId: string; readonly operation: Record<string, unknown> }): Promise<{ readonly operationId: string; readonly document: WebuiCanvasDocument }>;
    sendMessage(
      request: WebuiSendMessageRequest,
      context?: { readonly signal?: AbortSignal },
    ): Promise<WebuiSendMessageResult>;
    enqueueMessage(
      request: WebuiEnqueueMessageRequest,
      context?: { readonly signal?: AbortSignal },
    ): Promise<WebuiEnqueueMessageResult>;
    resumeSession(
      request: WebuiResumeSessionRequest,
      context?: { readonly signal?: AbortSignal },
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
      readonly reply: number;
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
    /**
 * The cliService returns the harness `SkillInfo[]`; the host then projects
 * it down to `WebuiSkillEntry[]` for the WebUI client. The structural type
 * spells out the wider shape (incl. `displayDescription` for i18n) so the
 * field-selection logic in `listSkills()` below type-checks.
 */
listSkills(request?: {
      readonly agentName?: string;
    }): Promise<{
      readonly skills: readonly {
        readonly name: string;
        readonly displayName?: string;
        readonly description?: string;
        readonly displayDescription?: string;
      }[];
    }>;
    selectModel(request: {
      readonly providerId: string;
      readonly modelId: string;
      readonly variant?: string;
      readonly contextLimit?: number;
      readonly sessionId?: string;
    }): Promise<{ readonly success?: boolean }>;
    getSessionUsage(request: {
      readonly id: string;
    }): Promise<Record<string, unknown>>;
    getAccountStatus(request?: {
      readonly sessionId?: string;
    }): Promise<Record<string, unknown>>;
    listUserModelProviders(): Promise<readonly Record<string, unknown>[]>;
    createUserModelProvider(request: Record<string, unknown>): Promise<unknown>;
    updateUserModelProvider(request: Record<string, unknown>): Promise<unknown>;
    deleteUserModelProvider(request: { readonly providerId: string }): Promise<unknown>;
    testUserModelProvider(request: { readonly providerId: string }): Promise<unknown>;
    testUserModel(request: { readonly providerId: string; readonly modelId: string }): Promise<unknown>;
    discoverUserModelsCandidate(request: Record<string, unknown>): Promise<unknown>;
    saveUserModelProviderCandidate(request: Record<string, unknown>): Promise<unknown>;
    listProviderPresets(): Promise<readonly Record<string, unknown>[]>;
    getMiniMaxApiKeyStatus(): Promise<Record<string, unknown>>;
    upsertMiniMaxApiKey(request: { readonly apiKey: string; readonly saveAndUse?: boolean }): Promise<unknown>;
    getCodexOAuthStatus(): Promise<Record<string, unknown>>;
    requestCompaction?(request: {
      readonly name: string;
      readonly id: string;
      readonly reason: "ui_request";
      readonly customInstructions?: string;
    }): Promise<Record<string, unknown>>;
  };
}

/**
 * Builds the harness port over the runtime host returned by the harness
 * layer. Closes the host on `port.close()` so the service can rely on
 * the port alone to tear the runtime down.
 */
export function createHarnessPortFromHost(
  handle: WebuiRuntimeHostHandle,
): WebuiHarnessPort {
  const host = handle;
  const version: WebuiVersionInfo = {
    version: host.appVersion ?? "unknown",
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    ...(host.dataDir ? { dataDir: host.dataDir } : {}),
  };
  let closed = false;
  return {
    version() {
      return version;
    },
    async invalidateAuth() {
      host.invalidateAuth?.();
    },
    async listSessions(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listSessions(request, {});
    },
    async getSessionTree(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getSessionTree(request, {});
    },
    async archiveSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.archiveSession(request, {});
    },
    async deleteSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.deleteSession(request, {});
    },
    async updateSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.updateSession(request, {});
    },
    async getSessionForkOptions(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getSessionForkOptions(request, {});
    },
    async forkSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.forkSession(request, {});
    },
    async createSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.createSession(request, {});
    },
    async getSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getSession(request, {});
    },
    async getMessages(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getMessages(request, {});
    },
    async listWorkspaceFileTree(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listWorkspaceFileTree?.(request) as Promise<readonly WebuiWorkspaceFile[]>;
    },
    async readWorkspaceFile(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.readWorkspaceFile?.(request) as Promise<WebuiWorkspaceFileContent>;
    },
    async getWorkspaceEnvironment(request) {
      if (!host.cliService?.getWorkspaceGitEnvironment)
        throw new Error("runtime host does not expose Workspace git state");
      const { metadata, changes } = await host.cliService.getWorkspaceGitEnvironment(request.workspaceDir);
      return {
        isGitRepo: changes.isGitRepo === true || metadata.isGitRepo === true,
        ...(typeof metadata.branch === "string" ? { branch: metadata.branch } : {}),
        changedFiles: typeof changes.changedFiles === "number" ? changes.changedFiles : 0,
        insertions: typeof changes.insertions === "number" ? changes.insertions : 0,
        deletions: typeof changes.deletions === "number" ? changes.deletions : 0,
        lineStatsStatus: changes.lineStatsStatus === "ready" || changes.lineStatsStatus === "partial" ? changes.lineStatsStatus : "skipped",
        ...(typeof metadata.canPush === "boolean" ? { canPush: metadata.canPush } : {}),
        ...(typeof metadata.hasRemote === "boolean" ? { hasRemote: metadata.hasRemote } : {}),
        ...(typeof metadata.hasUpstream === "boolean" ? { hasUpstream: metadata.hasUpstream } : {}),
        ...(typeof changes.error === "string" ? { changesError: changes.error } : {}),
        ...(typeof metadata.error === "string" ? { metadataError: metadata.error } : {}),
      } as WebuiWorkspaceEnvironment;
    },
    async mutateWorkspaceGit(request) {
      if (!host.cliService?.mutateWorkspaceGit)
        throw new Error("runtime host does not expose Workspace git mutations");
      return host.cliService.mutateWorkspaceGit(request);
    },
    async readCanvas(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.readCanvas?.(request) as Promise<WebuiCanvasDocument>;
    },
    async applyCanvas(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.applyCanvas?.(request as never) as Promise<{ readonly operationId: string; readonly document: WebuiCanvasDocument }>;
    },
    async sendMessage(request, signal) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.sendMessage(request, signal ? { signal } : {});
    },
    async enqueueMessage(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.enqueueMessage(request, {});
    },
    async resumeSession(request, signal) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.resumeSession(request, signal ? { signal } : {});
    },
    watchEvents(signal) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.watchEvents(signal);
    },
    async listPendingPermissions() {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listPendingPermissions();
    },
    async getPendingQuestionnaire(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getPendingQuestionnaire(request);
    },
    async replyPermission(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.replyPermission({
        name: request.name,
        requestId: request.requestId,
        reply: permissionReplyValue(request.reply),
      });
    },
    async replyQuestionnaire(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.replyQuestionnaire(request);
    },
    async dismissQuestionnaire(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.dismissQuestionnaire(request);
    },
    async abortSession(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.abortSession(request);
    },
    async listQueueMessages(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listQueueMessages(request);
    },
    async deleteQueueItem(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.deleteQueueItem(request);
    },
    async listModels(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listModels(request);
    },
    async selectModel(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.selectModel(request);
    },
    async listSkills(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      // cliService.listSkills returns the full `SkillInfo[]` shape; map it
      // down to the WebUI's minimal projection. `displayDescription` and
      // i18n keys win over the raw `description` so the popover matches the
      // desktop's translated copy.
      const result = await host.cliService.listSkills(request ?? {});
      return {
        skills: result.skills.map((skill) => ({
          name: skill.name,
          displayName: skill.displayName ?? skill.name,
          description:
            skill.displayDescription ?? skill.description ?? "",
        })),
      };
    },
    async getSessionUsage(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getSessionUsage(request);
    },
    async getUsageQuota(request) {
      if (!host.getUsageQuota)
        throw new Error("runtime host does not expose the usage quota client");
      return host.getUsageQuota(request ?? {});
    },
    async getSigninPanel() {
      if (!host.getSigninPanel)
        throw new Error("runtime host does not expose the daily check-in client");
      return host.getSigninPanel();
    },
    async claimSignin() {
      if (!host.claimSignin)
        throw new Error("runtime host does not expose the daily check-in client");
      return host.claimSignin();
    },
    async getAccountStatus(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getAccountStatus(request);
    },
    async listUserModelProviders() {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listUserModelProviders();
    },
    async createUserModelProvider(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.createUserModelProvider(request);
    },
    async updateUserModelProvider(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.updateUserModelProvider(request);
    },
    async deleteUserModelProvider(providerId) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.deleteUserModelProvider({ providerId });
    },
    async testUserModelProvider(providerId) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.testUserModelProvider({ providerId });
    },
    async testUserModel(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.testUserModel({ providerId: request.providerId, modelId: request.modelId });
    },
    async discoverUserModelsCandidate(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.discoverUserModelsCandidate(request);
    },
    async saveUserModelProviderCandidate(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.saveUserModelProviderCandidate(request);
    },
    async listProviderPresets() {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.listProviderPresets();
    },
    async getMiniMaxApiKeyStatus() {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getMiniMaxApiKeyStatus();
    },
    async upsertMiniMaxApiKey(request) {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.upsertMiniMaxApiKey(request);
    },
    async getCodexOAuthStatus() {
      if (!host.cliService) throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getCodexOAuthStatus();
    },
    async requestCompaction(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      if (!host.cliService.requestCompaction)
        throw new Error("runtime host does not expose requestCompaction");
      return host.cliService.requestCompaction(request);
    },
    async close() {
      if (closed) return;
      closed = true;
      await host.apiHost.close();
    },
  };
}

function permissionReplyValue(reply: WebuiPermissionDecision): number {
  switch (reply) {
    case "allowOnce":
      return 0;
    case "allowAlways":
      return 1;
    case "deny":
      return 2;
  }
}
