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
  WebuiRecentProject,
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
  WebuiGetSessionDiffRequest,
  WebuiGetSessionDiffResult,
  WebuiGetTurnDiffRequest,
  WebuiGetTurnDiffResult,
  WebuiRevertTurnDiffRequest,
  WebuiRevertTurnDiffResult,
  WebuiReapplyTurnDiffRequest,
  WebuiReapplyTurnDiffResult,
  WebuiGetSessionForkOptionsRequest,
  WebuiGetSessionForkOptionsResult,
  WebuiForkSessionRequest,
  WebuiForkSessionResult,
  WebuiGetSessionRewindPreviewRequest,
  WebuiGetSessionRewindPreviewResult,
  WebuiRewindSessionRequest,
  WebuiRewindSessionResult,
  WebuiEditSessionMessageRequest,
  WebuiEditSessionMessageResult,
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalPatchRequest,
} from "./port.js";

/**
 * The exact surface of the runtime `cliService` the WebUI talks to. The
 * runtime harness is responsible for satisfying this shape; the WebUI's only
 * job is to forward requests here. Methods optional on the live cliService
 * stay optional here too — `createHarnessPortFromHost` projects them back
 * with `requireCliService` so every wire-error is a single, uniform
 * `runtime host does not expose the CLI service` message.
 *
 * Exported as the single source of truth so the assembly layer can type its
 * `cliService?: WebuiRuntimeCliService` slot without re-spelling it.
 */
export interface WebuiRuntimeCliService {
  listRecentProjects?(limit?: number): Promise<readonly WebuiRecentProject[]>;
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
    request: WebuiGetSessionForkOptionsRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionForkOptionsResult>;
  forkSession(
    request: WebuiForkSessionRequest,
    context?: Record<string, never>,
  ): Promise<WebuiForkSessionResult>;
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
  getSessionDiff(
    request: WebuiGetSessionDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionDiffResult>;
  getTurnDiff(
    request: WebuiGetTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetTurnDiffResult>;
  revertTurnDiff(
    request: WebuiRevertTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiRevertTurnDiffResult>;
  reapplyTurnDiff(
    request: WebuiReapplyTurnDiffRequest,
    context?: Record<string, never>,
  ): Promise<WebuiReapplyTurnDiffResult>;
  getSessionRewindPreview(
    request: WebuiGetSessionRewindPreviewRequest,
    context?: Record<string, never>,
  ): Promise<WebuiGetSessionRewindPreviewResult>;
  rewindSession(
    request: WebuiRewindSessionRequest,
    context?: Record<string, never>,
  ): Promise<WebuiRewindSessionResult>;
  editSessionMessage(
    request: WebuiEditSessionMessageRequest,
    context?: Record<string, never>,
  ): Promise<WebuiEditSessionMessageResult>;
  isGoalEnabled(): boolean;
  getGoal(sessionId: string): Promise<WebuiGoal | undefined>;
  createGoal(request: WebuiGoalCreateRequest): Promise<WebuiGoal>;
  patchGoal(
    sessionId: string,
    patch: Omit<WebuiGoalPatchRequest, "sessionId">,
  ): Promise<WebuiGoal>;
  clearGoal(sessionId: string): Promise<boolean>;
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
  /**
   * Compaction is opt-in on the live harness: the `CliService` exposes it
   * only when the host has a meaningful reducer, and the WebUI surface
   * surfaces `runtime host does not expose requestCompaction` for any host
   * that omits it. The runner's `/compact` path therefore can't assume the
   * method always exists, which is why the port's `requestCompaction` is
   * a required harness-port method: the assembly is responsible for
   * projecting an `optional` cliService hook into a `required` port entry,
   * and failing closed otherwise. See `createHarnessPortFromHost` for the
   * nested-guard pattern that turns that `?` into a clear error.
   */
  requestCompaction?(request: {
    readonly name: string;
    readonly id: string;
    readonly reason: "ui_request";
    readonly customInstructions?: string;
  }): Promise<Record<string, unknown>>;
}

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
  /**
   * Source of every harness command the WebUI maps to operations. Owned by
   * the runtime host; the WebUI only needs the structural shape to forward.
   */
  readonly cliService?: WebuiRuntimeCliService;
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
      return requireCliService(host).listSessions(request, {});
    },
    async listRecentProjects(request) {
      const service = requireCliService(host);
      if (!service.listRecentProjects) throw new Error("runtime host does not expose project listing");
      return service.listRecentProjects(request.limit ?? 100);
    },
    async getSessionTree(request) {
      return requireCliService(host).getSessionTree(request, {});
    },
    async archiveSession(request) {
      return requireCliService(host).archiveSession(request, {});
    },
    async deleteSession(request) {
      return requireCliService(host).deleteSession(request, {});
    },
    async updateSession(request) {
      return requireCliService(host).updateSession(request, {});
    },
    async getSessionForkOptions(request) {
      return requireCliService(host).getSessionForkOptions(request, {});
    },
    async forkSession(request) {
      return requireCliService(host).forkSession(request, {});
    },
    async createSession(request) {
      return requireCliService(host).createSession(request, {});
    },
    async getSession(request) {
      return requireCliService(host).getSession(request, {});
    },
    async getMessages(request) {
      return requireCliService(host).getMessages(request, {});
    },
    async getSessionDiff(request) {
      return requireCliService(host).getSessionDiff(request, {});
    },
    async getTurnDiff(request) {
      return requireCliService(host).getTurnDiff(request, {});
    },
    async revertTurnDiff(request) {
      return requireCliService(host).revertTurnDiff(request, {});
    },
    async reapplyTurnDiff(request) {
      return requireCliService(host).reapplyTurnDiff(request, {});
    },
    async getSessionRewindPreview(request) {
      return requireCliService(host).getSessionRewindPreview(request, {});
    },
    async rewindSession(request) {
      return requireCliService(host).rewindSession(request, {});
    },
    async editSessionMessage(request) {
      return requireCliService(host).editSessionMessage(request, {});
    },
    async isGoalEnabled() {
      return { enabled: requireCliService(host).isGoalEnabled() };
    },
    async getGoal(request) {
      return requireCliService(host).getGoal(request.sessionId);
    },
    async createGoal(request) {
      return requireCliService(host).createGoal(request);
    },
    async patchGoal(request) {
      const { sessionId, ...patch } = request;
      return requireCliService(host).patchGoal(sessionId, patch);
    },
    async clearGoal(request) {
      return { success: await requireCliService(host).clearGoal(request.sessionId) };
    },
    async listWorkspaceFileTree(request) {
      return requireCliService(host).listWorkspaceFileTree!(request) as Promise<readonly WebuiWorkspaceFile[]>;
    },
    async readWorkspaceFile(request) {
      return requireCliService(host).readWorkspaceFile!(request) as Promise<WebuiWorkspaceFileContent>;
    },
    async getWorkspaceEnvironment(request) {
      const cliService = requireCliService(host);
      if (!cliService.getWorkspaceGitEnvironment)
        throw new Error("runtime host does not expose Workspace git state");
      const { metadata, changes } = await cliService.getWorkspaceGitEnvironment(request.workspaceDir);
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
      const cliService = requireCliService(host);
      if (!cliService.mutateWorkspaceGit)
        throw new Error("runtime host does not expose Workspace git mutations");
      return cliService.mutateWorkspaceGit(request);
    },
    async readCanvas(request) {
      return requireCliService(host).readCanvas!(request) as Promise<WebuiCanvasDocument>;
    },
    async applyCanvas(request) {
      return requireCliService(host).applyCanvas!(request as never) as Promise<{ readonly operationId: string; readonly document: WebuiCanvasDocument }>;
    },
    async sendMessage(request, signal) {
      return requireCliService(host).sendMessage(request, signal ? { signal } : {});
    },
    async enqueueMessage(request) {
      return requireCliService(host).enqueueMessage(request, {});
    },
    async resumeSession(request, signal) {
      return requireCliService(host).resumeSession(request, signal ? { signal } : {});
    },
    watchEvents(signal) {
      return requireCliService(host).watchEvents(signal);
    },
    async listPendingPermissions() {
      return requireCliService(host).listPendingPermissions();
    },
    async getPendingQuestionnaire(request) {
      return requireCliService(host).getPendingQuestionnaire(request);
    },
    async replyPermission(request) {
      return requireCliService(host).replyPermission({
        name: request.name,
        requestId: request.requestId,
        reply: permissionReplyValue(request.reply),
      });
    },
    async replyQuestionnaire(request) {
      return requireCliService(host).replyQuestionnaire(request);
    },
    async dismissQuestionnaire(request) {
      return requireCliService(host).dismissQuestionnaire(request);
    },
    async abortSession(request) {
      return requireCliService(host).abortSession(request);
    },
    async listQueueMessages(request) {
      return requireCliService(host).listQueueMessages(request);
    },
    async deleteQueueItem(request) {
      return requireCliService(host).deleteQueueItem(request);
    },
    async listModels(request) {
      return requireCliService(host).listModels(request);
    },
    async selectModel(request) {
      return requireCliService(host).selectModel(request);
    },
    async listSkills(request) {
      // cliService.listSkills returns the full `SkillInfo[]` shape; map it
      // down to the WebUI's minimal projection. `displayDescription` and
      // i18n keys win over the raw `description` so the popover matches the
      // desktop's translated copy.
      const result = await requireCliService(host).listSkills(request ?? {});
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
      return requireCliService(host).getSessionUsage(request);
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
      return requireCliService(host).getAccountStatus(request);
    },
    async listUserModelProviders() {
      return requireCliService(host).listUserModelProviders();
    },
    async createUserModelProvider(request) {
      return requireCliService(host).createUserModelProvider(request);
    },
    async updateUserModelProvider(request) {
      return requireCliService(host).updateUserModelProvider(request);
    },
    async deleteUserModelProvider(providerId) {
      return requireCliService(host).deleteUserModelProvider({ providerId });
    },
    async testUserModelProvider(providerId) {
      return requireCliService(host).testUserModelProvider({ providerId });
    },
    async testUserModel(request) {
      return requireCliService(host).testUserModel({ providerId: request.providerId, modelId: request.modelId });
    },
    async discoverUserModelsCandidate(request) {
      return requireCliService(host).discoverUserModelsCandidate(request);
    },
    async saveUserModelProviderCandidate(request) {
      return requireCliService(host).saveUserModelProviderCandidate(request);
    },
    async listProviderPresets() {
      return requireCliService(host).listProviderPresets();
    },
    async getMiniMaxApiKeyStatus() {
      return requireCliService(host).getMiniMaxApiKeyStatus();
    },
    async upsertMiniMaxApiKey(request) {
      return requireCliService(host).upsertMiniMaxApiKey(request);
    },
    async getCodexOAuthStatus() {
      return requireCliService(host).getCodexOAuthStatus();
    },
    async requestCompaction(request) {
      // `cliService.requestCompaction` is optional on the harness. The
      // outer `cliService` guard stays even though the rest of the harness
      // port now goes through `requireCliService`: this is the one method
      // that the runner explicitly drives, so the failure message has to
      // be specific (the `/compact` slash command tells the user the host
      // does not support conversation compaction; folding the two errors
      // into one would only mention the CLI service).
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

/**
 * Resolve the runtime host's `cliService` slot. Every harness port method
 * that has no equivalent on the auth/quota/check-in side flows through this
 * helper so the failure message is the same as it was before the batch-C
 * seam work.
 */
function requireCliService(host: WebuiRuntimeHostHandle): WebuiRuntimeCliService {
  if (!host.cliService)
    throw new Error("runtime host does not expose the CLI service");
  return host.cliService;
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
