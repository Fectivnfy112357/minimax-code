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
  WebuiModelEntry,
} from "./port.js";

export interface WebuiRuntimeHostHandle {
  readonly apiHost: { close(): Promise<void> };
  readonly appVersion?: string;
  readonly dataDir?: string;
  readonly invalidateAuth?: () => void;
  readonly cliService?: {
    listSessions(
      request: WebuiSessionListRequest,
      context?: Record<string, never>,
    ): Promise<WebuiSessionPage>;
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
    async getAccountStatus(request) {
      if (!host.cliService)
        throw new Error("runtime host does not expose the CLI service");
      return host.cliService.getAccountStatus(request);
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
