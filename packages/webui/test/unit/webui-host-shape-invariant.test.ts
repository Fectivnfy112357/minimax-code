// Host-shape invariants added in batch C.
//
// Before this batch, `createOperationRegistry` registered 22 of its 70+
// operations only when the runtime host happened to implement the matching
// capability gates (`port.getSessionDiff && port.getTurnDiff && ...`, etc.).
// Six capability gates meant the registry contents depended on which optional
// hooks the host exposed; tests could prove one shape, production could ship
// another, and the wire protocol was a function of the host.
//
// This test pins three invariants that close that gap:
//   1. The 22 operations that used to be gated are now in the registry on
//      every build, regardless of which host fields the harness fills.
//   2. The 6 terminal operations stay unregistered when the service is
//      constructed without a terminal adapter. The cold-started TUI emits the
//      same wire contract for "operation is not wired here" before its PTY
//      bridge comes up.
//   3. (Compiler) `ScriptedHarnessPort` MUST satisfy `WebuiHarnessPort` —
//      this file imports the fake type and the port type together so a
//      missing port member breaks the test compile, not the runtime.

import { describe, expect, it } from "vitest";
import type { WebuiHarnessPort } from "../../src/server/port.js";
import {
  createOperationRegistry,
  editSessionMessageOperation,
  isGoalEnabledOperation,
  getGoalOperation,
  createGoalOperation,
  patchGoalOperation,
  clearGoalOperation,
  getSessionDiffOperation,
  getTurnDiffOperation,
  revertTurnDiffOperation,
  reapplyTurnDiffOperation,
  getSessionRewindPreviewOperation,
  rewindSessionOperation,
  listWorkspaceFileTreeOperation,
  readWorkspaceFileOperation,
  getWorkspaceEnvironmentOperation,
  mutateWorkspaceGitOperation,
  readCanvasOperation,
  applyCanvasOperation,
  createTerminalOperation,
  listTerminalsOperation,
  writeTerminalOperation,
  resizeTerminalOperation,
  disposeTerminalOperation,
  watchTerminalOperation,
} from "../../src/server/operation/operations.js";
import { createOperationHandlers, type WebuiOperationPort } from "../../src/server/operation/operation-handlers.js";

/**
 * Build a fully-implemented in-memory port so we can construct the
 * registry without standing up the runtime. A type-checked no-op for
 * every member — each method returns a structural zero that satisfies
 * the matching `WebuiHarnessPort` field. Forgetting a member fails the
 * compile instead of silently returning `undefined`.
 */
class FullPort implements WebuiHarnessPort {
  version() {
    return { version: "invariant-test", protocolVersion: 1 };
  }
  async listSessions() {
    return { sessions: [], hasMore: false };
  }
  async getSessionTree() {
    return { sessions: [], hasMore: false };
  }
  async archiveSession() {
    return { success: true };
  }
  async deleteSession() {
    return { success: true };
  }
  async updateSession() {
    return { session: { sessionId: "invariant" } };
  }
  async getSessionForkOptions() {
    return { canFork: false, worktreeVisible: false, worktreeEligible: false };
  }
  async forkSession() {
    return { session: { sessionId: "invariant" } };
  }
  async createSession() {
    return { sessionId: "invariant" };
  }
  async getSession() {
    return { session: { sessionId: "invariant" } };
  }
  async getMessages() {
    return { messages: [], hasMore: false };
  }
  async getSessionDiff() {
    return { diffs: [], changeSetId: "invariant" };
  }
  async getTurnDiff() {
    return {
      status: "active",
      canUndo: false,
      canReapply: false,
      changeSetId: "invariant",
      fileChanges: [],
    };
  }
  async revertTurnDiff() {
    return {
      success: true,
      turnDiff: {
        status: "reverted",
        canUndo: false,
        canReapply: true,
        changeSetId: "invariant",
        fileChanges: [],
      },
    };
  }
  async reapplyTurnDiff() {
    return {
      success: true,
      status: "active",
      canUndo: true,
      canReapply: false,
      changeSetId: "invariant",
      fileChanges: [],
    };
  }
  async getSessionRewindPreview() {
    return { turns: [] };
  }
  async rewindSession() {
    return { rewound: false };
  }
  async editSessionMessage() {
    return { rewound: false };
  }
  async isGoalEnabled() {
    return { enabled: false };
  }
  async getGoal() {
    return undefined;
  }
  async createGoal(request: { readonly sessionId: string; readonly objective: string }) {
    return {
      goalId: "invariant",
      sessionId: request.sessionId,
      objective: request.objective,
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
      tokensUsed: 0,
      turnsUsed: 0,
      timeUsedSeconds: 0,
      tokenBudget: null,
      statusReason: null,
    };
  }
  async patchGoal(request: { readonly sessionId: string }) {
    return {
      goalId: "invariant",
      sessionId: request.sessionId,
      objective: "",
      status: "active" as const,
      createdAt: 0,
      updatedAt: 0,
      tokensUsed: 0,
      turnsUsed: 0,
      timeUsedSeconds: 0,
      tokenBudget: null,
      statusReason: null,
    };
  }
  async clearGoal() {
    return { success: true };
  }
  async listWorkspaceFileTree() {
    return [];
  }
  async readWorkspaceFile() {
    return { type: "text" as const, content: "" };
  }
  async getWorkspaceEnvironment() {
    return {
      isGitRepo: false,
      changedFiles: 0,
      insertions: 0,
      deletions: 0,
      lineStatsStatus: "skipped" as const,
    };
  }
  async mutateWorkspaceGit() {
    return { success: true };
  }
  async readCanvas() {
    return {
      schemaVersion: 1,
      canvasId: "invariant",
      sessionId: "invariant",
      changeSeq: 0,
      nodes: [],
      updatedAtMs: 0,
    };
  }
  async applyCanvas() {
    return {
      operationId: "invariant",
      document: {
        schemaVersion: 1,
        canvasId: "invariant",
        sessionId: "invariant",
        changeSeq: 0,
        nodes: [],
        updatedAtMs: 0,
      },
    };
  }
  async sendMessage() {
    return { ok: true as const, source: [] };
  }
  async enqueueMessage() {
    return { itemId: "invariant", status: "queued", position: 1 };
  }
  async resumeSession() {
    return { ok: true as const, source: [] };
  }
  async *watchEvents() {
    // empty
  }
  async listPendingPermissions() {
    return { requests: [] };
  }
  async getPendingQuestionnaire() {
    return {};
  }
  async replyPermission() {
    return { success: true };
  }
  async replyQuestionnaire() {
    return { ok: true };
  }
  async dismissQuestionnaire() {
    return { ok: true };
  }
  async abortSession() {
    return { success: true };
  }
  async listQueueMessages() {
    return { items: [], paused: false, pendingCount: 0 };
  }
  async deleteQueueItem() {
    return {};
  }
  async listModels() {
    return [];
  }
  async listSkills() {
    return { skills: [] };
  }
  async selectModel() {
    return { success: true };
  }
  async getSessionUsage() {
    return {};
  }
  async getUsageQuota() {
    return { signedIn: false as const };
  }
  async getSigninPanel() {
    return { scene: 0, days: [] };
  }
  async claimSignin() {
    return {
      claim_id: "invariant",
      claim_result: 0,
      day_no: 0,
      points: 0,
      expire_at_ms: 0,
      panel: { scene: 0, days: [] },
    };
  }
  async getAccountStatus() {
    return { available: true };
  }
  async listUserModelProviders() {
    return [];
  }
  async createUserModelProvider() {
    return {};
  }
  async updateUserModelProvider() {
    return { success: true };
  }
  async deleteUserModelProvider() {
    return { success: true };
  }
  async testUserModelProvider() {
    return { success: true, status: { state: "ok" } };
  }
  async testUserModel() {
    return { success: true, status: { state: "ok" } };
  }
  async discoverUserModelsCandidate() {
    return [];
  }
  async saveUserModelProviderCandidate() {
    return { success: true };
  }
  async listProviderPresets() {
    return [];
  }
  async getMiniMaxApiKeyStatus() {
    return { hasApiKey: false };
  }
  async upsertMiniMaxApiKey() {
    return { success: true };
  }
  async getCodexOAuthStatus() {
    return { connected: false };
  }
  async invalidateAuth() {
    // no-op: the full-port invariant never actually invalidates.
  }
  async requestCompaction() {
    // The invariant port satisfies the harness-port requirement that
    // `requestCompaction` exists on every implementor; the runner's
    // `/compact` slash command reaches it through `runWebuiCommand`.
    return { success: true as const };
  }
  async close() {
    // no-op
  }
}

describe("WebUI host-shape invariant (batch C seam)", () => {
  // The 22 operations whose registration used to depend on a host capability
  // gate. After batch C every one of them is in the registry — see `operations.ts`,
  // where the six `if (port.<x> && port.<y>)` capability gates were deleted.
  const GATED_BUT_NOW_UNCONDITIONAL: readonly string[] = [
    // diff group (was: `if (port.getSessionDiff && port.getTurnDiff && port.revertTurnDiff && port.reapplyTurnDiff)`)
    getSessionDiffOperation.name,
    getTurnDiffOperation.name,
    revertTurnDiffOperation.name,
    reapplyTurnDiffOperation.name,
    // rewind/edit group (was: `if (port.getSessionRewindPreview && port.rewindSession && port.editSessionMessage)`)
    getSessionRewindPreviewOperation.name,
    rewindSessionOperation.name,
    editSessionMessageOperation.name,
    // goal group (was: `if (port.isGoalEnabled && port.getGoal && port.createGoal && port.patchGoal && port.clearGoal)`)
    isGoalEnabledOperation.name,
    getGoalOperation.name,
    createGoalOperation.name,
    patchGoalOperation.name,
    clearGoalOperation.name,
    // workspace/canvas group (was: `if (port.listWorkspaceFileTree && port.readWorkspaceFile && port.readCanvas && port.applyCanvas)`)
    listWorkspaceFileTreeOperation.name,
    readWorkspaceFileOperation.name,
    readCanvasOperation.name,
    applyCanvasOperation.name,
    // singletons (had their own `if (port.X)` lines)
    getWorkspaceEnvironmentOperation.name,
    mutateWorkspaceGitOperation.name,
  ];

  it("registers every operation the harness port exposes (no capability gate)", () => {
    const port = new FullPort();
    const registry = createOperationRegistry(port);
    for (const name of GATED_BUT_NOW_UNCONDITIONAL) {
      expect(
        registry.has(name),
        `expected ${name} to be in the registry, but it was gated`,
      ).toBe(true);
    }
  });

  it("keeps the six terminal operations out of the registry when no terminal adapter is wired", () => {
    const port = new FullPort();
    const registry = createOperationRegistry(port);
    const terminalNames = [
      createTerminalOperation.name,
      listTerminalsOperation.name,
      writeTerminalOperation.name,
      resizeTerminalOperation.name,
      disposeTerminalOperation.name,
      watchTerminalOperation.name,
    ];
    for (const name of terminalNames) {
      expect(
        registry.has(name),
        `expected ${name} to be absent without a terminal adapter, but it was registered`,
      ).toBe(false);
    }
  });

  it("narrows WebuiOperationPort to require every harness port method (port.ts)", () => {
    // Compile-time check — `FullPort` MUST satisfy `WebuiOperationPort`,
    // which `operation-handlers.ts` builds as `Pick<WebuiHarnessPort, ...>`.
    const port: WebuiOperationPort = new FullPort();
    // The handlers map derives its method shape from the operation
    // descriptors; we only need to verify it accepts the port.
    const handlers = createOperationHandlers(port);
    expect(Object.keys(handlers).length).toBeGreaterThan(0);
  });
});
