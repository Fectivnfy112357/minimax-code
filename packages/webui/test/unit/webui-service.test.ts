// Service tests for the WebUI loopback service and runtime seam.
//
// The brief calls for TDD at the service seam: construct the real
// `WebuiService` with a scripted stand-in for the harness port, connect a
// real WebSocket client, and assert the frames. Each acceptance criterion
// has its own fixture; the same scripted port keeps the harness-side
// surface honest (the harness never runs against real history, per ADR
// 0006) while the wire side exercises the real `ws` package.

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { once, type once as onceFn } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RawData } from "ws";
import { WebSocket } from "ws";

import { updateLocalModelSelection } from "@mavis/config";
import {
  resetDefaultLocalRuntimeConfig,
} from "@mavis/local-runtime-v2";

import {
  WebuiErrorCode,
  WEBUI_PROTOCOL_VERSION,
  WebuiService,
  isWebuiFrame,
  type WebuiHarnessPort,
  type WebuiMessagesRequest,
  type WebuiMessagesResult,
  type WebuiCreateSessionRequest,
  type WebuiSessionLookupRequest,
  type WebuiSessionListRequest,
  type WebuiVersionInfo,
  type WebuiSendMessageRequest,
  type WebuiSendMessageResult,
  type WebuiResumeSessionRequest,
  type WebuiStreamResult,
  type WebuiRuntimeEvent,
  type WebuiPermissionDecision,
} from "../../src/server/index.js";
import { createWebuiTransport } from "../../src/client/transport.js";
import { WebuiTerminalManager } from "../../src/server/terminal.js";

type CloseEvent = [number, Buffer];
type OncePromise<T> = ReturnType<typeof onceFn<T>>;

class ScriptedHarnessPort implements WebuiHarnessPort {
  private versionInfo: WebuiVersionInfo = {
    version: "0.1.0-test",
    protocolVersion: WEBUI_PROTOCOL_VERSION,
  };
  public closed = false;
  public sendResult: WebuiSendMessageResult = {
    ok: true,
    source: [{ dataJson: '{"type":10}' }, { dataJson: "[DONE]" }],
  };
  public resumeResult: WebuiStreamResult = {
    ok: true,
    source: [{ dataJson: '{"type":10}' }, { dataJson: "[DONE]" }],
  };
  public lastResumeRequest: WebuiResumeSessionRequest | undefined;
  public lastEnqueueRequest: Record<string, unknown> | undefined;
  public lastPermissionReply: Record<string, unknown> | undefined;
  public lastQuestionnaireReply: Record<string, unknown> | undefined;
  public lastQuestionnaireDismissal: Record<string, unknown> | undefined;
  public abortCalls = 0;
  public sendObserved: Promise<void>;
  private resolveSendObserved!: () => void;

  constructor() {
    this.sendObserved = new Promise<void>((resolve) => {
      this.resolveSendObserved = resolve;
    });
  }

  recordLog(version: string) {
    this.versionInfo = {
      version,
      protocolVersion: WEBUI_PROTOCOL_VERSION,
    };
  }

  version(): WebuiVersionInfo {
    return this.versionInfo;
  }

  async listSessions(request: WebuiSessionListRequest) {
    if (request.onlyArchived) return { sessions: [{ sessionId: "archived-fixture", agentName: "main", createdAt: 1, updatedAt: 2, archived: true, title: "Archived fixture" }], hasMore: false };
    return { sessions: [], hasMore: false };
  }

  async archiveSession() { return { success: true }; }
  async deleteSession() { return { success: true }; }

  async createSession(_request: WebuiCreateSessionRequest) {
    return { sessionId: "created-session" };
  }

  async getSession(_request: WebuiSessionLookupRequest) {
    return { session: { sessionId: "fixture-session" } };
  }

  async getMessages(
    _request: WebuiMessagesRequest,
  ): Promise<WebuiMessagesResult> {
    return { messages: [], hasMore: false };
  }

  async listWorkspaceFileTree() {
    return [{ path: "README.md", name: "README.md", kind: "file" }];
  }

  async getWorkspaceEnvironment() {
    return { isGitRepo: true, branch: "fixture", changedFiles: 1, insertions: 2, deletions: 1, lineStatsStatus: "ready" as const, canPush: true };
  }

  async mutateWorkspaceGit() {
    return { success: true };
  }

  async readWorkspaceFile(request: { readonly workspaceDir: string; readonly path: string }) {
    if (request.path.includes("..")) throw new Error("Path traversal denied");
    return { type: "text" as const, content: "fixture content\n" };
  }

  async readCanvas() {
    return { schemaVersion: 1, canvasId: "canvas-fixture", sessionId: "fixture-session", changeSeq: 0, nodes: [], updatedAtMs: 0 };
  }

  async applyCanvas(request: { readonly sessionId: string; readonly operation: Record<string, unknown> }) {
    return { operationId: String(request.operation.operationId ?? "fixture-operation"), document: await this.readCanvas() };
  }

  async sendMessage(
    _request: WebuiSendMessageRequest,
  ): Promise<WebuiSendMessageResult> {
    this.resolveSendObserved();
    return this.sendResult;
  }

  async enqueueMessage(request: Record<string, unknown>) {
    this.lastEnqueueRequest = request;
    return { itemId: "queued-fixture", status: "queued", position: 1 };
  }

  async resumeSession(
    request: WebuiResumeSessionRequest,
  ): Promise<WebuiStreamResult> {
    this.lastResumeRequest = request;
    return this.resumeResult;
  }

  async *watchEvents(signal?: AbortSignal): AsyncIterable<WebuiRuntimeEvent> {
    yield {
      type: "session.start",
      payload: { sessionId: "fixture-session", agentName: "main" },
      timestamp: Date.now(),
      source: "test",
    };
    await new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  async listPendingPermissions() {
    return { requests: [] };
  }

  async getPendingQuestionnaire() {
    return {};
  }

  async replyPermission(request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: WebuiPermissionDecision;
  }) {
    this.lastPermissionReply = request;
    return { success: true };
  }

  async replyQuestionnaire(request: Record<string, unknown>) {
    this.lastQuestionnaireReply = request;
    return { ok: true };
  }

  async dismissQuestionnaire(request: Record<string, unknown>) {
    this.lastQuestionnaireDismissal = request;
    return { ok: true };
  }

  async abortSession() {
    this.abortCalls += 1;
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
      claim_id: "stub",
      claim_result: 2,
      day_no: 1,
      points: 0,
      expire_at_ms: 0,
      panel: { scene: 0, days: [] },
    };
  }

  async getAccountStatus() {
    return { available: true };
  }

  async listUserModelProviders() { return [{ providerId: "fixture-provider", name: "Fixture" }]; }
  async createUserModelProvider(request: Record<string, unknown>) { return { success: true, providerId: request.providerId }; }
  async updateUserModelProvider() { return { success: true }; }
  async deleteUserModelProvider() { return { success: true }; }
  async testUserModelProvider() { return { success: true, status: { state: "ok" } }; }
  async testUserModel() { return { success: true, status: { state: "ok" } }; }
  async discoverUserModelsCandidate() { return []; }
  async saveUserModelProviderCandidate() { return { success: true }; }
  async listProviderPresets() { return []; }
  async getMiniMaxApiKeyStatus() { return { hasApiKey: false }; }
  async upsertMiniMaxApiKey() { return { success: true }; }
  async getCodexOAuthStatus() { return { connected: false }; }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class ClosingSocket {
  private readonly listeners = new Map<
    string,
    Array<(event: unknown) => void>
  >();
  private closed = false;

  constructor(_url: string) {
    queueMicrotask(() => this.emit("open", {}));
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(_data: string): void {
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.emit("close", {});
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

// Build a WebSocket client and capture every observable lifecycle event
// synchronously, so a test that observes a refusal can never lose the
// close race against the error-and-close pair the `ws` library emits
// back to back for a refused handshake.
//
// The `ws` library surfaces an upgrade refusal both as an `error`
// event and as the rejection of any `events.once(ws, "open")` listener;
// both fire from the same `process.nextTick`. `error` is attached
// unconditionally so the EventEmitter contract does not throw, but
// `once(ws, "error")` is *not* taken: the rejection arrives via the
// upgrade promise so callers can branch on its message. `close` is
// taken up-front because the library emits it on the same tick as
// `error`; attaching it after the rejection has already landed loses
// the event and the test hangs.
function openClient(
  url: string,
  headers: Record<string, string> = {},
): {
  ws: WebSocket;
  upgrade: OncePromise<unknown>;
  closed: Promise<{ code: number; reason: string }>;
} {
  const ws = new WebSocket(url, { headers });
  ws.on("error", () => undefined);
  const upgrade = once(ws, "open"); // rejects with the refusal; must be awaited
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once("close", (code, reason) =>
      resolve({ code, reason: reason.toString("utf8") }),
    );
  });
  return { ws, upgrade, closed };
}

function requestOnce(ws: WebSocket, request: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onMessage = (raw: RawData) => {
      ws.off("message", onMessage);
      ws.off("error", onError);
      try {
        resolve(JSON.parse(raw.toString("utf8")));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error: Error) => {
      ws.off("message", onMessage);
      reject(error);
    };
    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.send(JSON.stringify(request));
  });
}

function awaitClose(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => {
      resolve({ code, reason: reason.toString("utf8") });
    });
  });
}

describe("WebUI service", () => {
  it("turns a node-pty native load failure into an actionable error", () => {
    const manager = new WebuiTerminalManager(() => { throw new Error("Failed to load native module: pty.node"); });
    expect(() => manager.create("/tmp")).toThrow(/node-gyp rebuild/);
  });
  let port: ScriptedHarnessPort;
  let service: WebuiService;

  beforeEach(() => {
    port = new ScriptedHarnessPort();
  });

  afterEach(async () => {
    if (service) {
      try {
        await service.close();
      } catch {
        // close after a refused upgrade may already have torn down the listener.
      }
    }
  });

  async function bootService(): Promise<{
    url: string;
    credential: { token: string };
  }> {
    service = new WebuiService({ port });
    const info = await service.start();
    expect(info.host).toBe("127.0.0.1");
    expect(info.tcpPort).toBeGreaterThan(0);
    expect(info.protocolVersion).toBe(WEBUI_PROTOCOL_VERSION);
    expect(typeof info.credential.token).toBe("string");
    return {
      url: `${info.boundUrl}/?token=${encodeURIComponent(info.credential.token)}`,
      credential: info.credential,
    };
  }

  // Awaits the upgrade promise and asserts the rejection carries the
  // expected guard. The promise is consumed on every refusal path, so the
  // `ws` library's refused-handshake rejection never escapes as an
  // unhandled event. The regex is matched against the rejection's
  // `message`, which the `ws` library populates from the HTTP status
  // line of the refused response (`Unexpected server response: 401`,
  // `... : 403`, etc.).
  async function assertRefusal(
    upgrade: OncePromise<unknown>,
    pattern: RegExp,
  ): Promise<void> {
    try {
      await upgrade;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!pattern.test(message)) {
        throw new Error(
          `expected upgrade to refuse with ${pattern}; got: ${message}`,
        );
      }
      return;
    }
    throw new Error(`expected upgrade to refuse with ${pattern}; it resolved`);
  }

  it("refuses connections missing the per-start credential", async () => {
    await bootService();
    const info = service.info();
    const url = `ws://127.0.0.1:${info.tcpPort}`;
    const { ws, upgrade, closed } = openClient(url);
    await assertRefusal(upgrade, /401/);
    expect((await closed).code).not.toBe(1000);
  });

  it("refuses connections that present a wrong credential", async () => {
    await bootService();
    const info = service.info();
    const url = `ws://127.0.0.1:${info.tcpPort}/?token=definitely-not-it`;
    const { ws, upgrade, closed } = openClient(url);
    await assertRefusal(upgrade, /401/);
    expect((await closed).code).not.toBe(1000);
  });

  it("refuses connections with a non-loopback Host header", async () => {
    await bootService();
    const info = service.info();
    const url = `ws://127.0.0.1:${info.tcpPort}/?token=${info.credential.token}`;
    const { ws, upgrade, closed } = openClient(url, {
      Host: "evil.example:80",
    });
    await assertRefusal(upgrade, /403/);
    expect((await closed).code).not.toBe(1000);
  });

  it("refuses connections with a non-loopback Origin header", async () => {
    await bootService();
    const info = service.info();
    const url = `ws://127.0.0.1:${info.tcpPort}/?token=${info.credential.token}`;
    const { ws, upgrade, closed } = openClient(url, {
      Origin: "https://evil.example",
    });
    await assertRefusal(upgrade, /403/);
    expect((await closed).code).not.toBe(1000);
  });

  it("answers a version query over the wire with the harness-reported version", async () => {
    port.recordLog("0.3.1-fixture");
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-version-1",
      operation: "version",
      body: undefined,
    };
    const response = await requestOnce(ws, request);
    expect(isWebuiFrame(response)).toBe(true);
    if (!isWebuiFrame(response)) return;
    expect(response.kind).toBe("response");
    expect(response.protocolVersion).toBe(WEBUI_PROTOCOL_VERSION);
    expect(response.requestId).toBe("req-version-1");
    const body = response.body as { version: string; protocolVersion: number };
    expect(body.version).toBe("0.3.1-fixture");
    expect(body.protocolVersion).toBe(WEBUI_PROTOCOL_VERSION);
    ws.close();
  });

  it("streams sendMessage as ordered event frames and preserves mixed frame bodies", async () => {
    port.sendResult = {
      ok: true,
      source: [
        { dataJson: '{"type":10}' },
        {
          dataJson:
            '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"Hi"}}',
          cursor: "c1",
        },
        {
          dataJson:
            '{"type":"session_status","session_status":{"type":"finished"}}',
        },
        { messageActionDeltas: [{ action: "open" }] },
        { dataJson: "[DONE]" },
      ],
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const frames: unknown[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        try {
          const frame = JSON.parse(raw.toString("utf8")) as {
            kind: string;
            body?: { dataJson?: string };
          };
          frames.push(frame);
          if (frame.kind === "event" && frame.body?.dataJson === "[DONE]")
            resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-send",
        operation: "sendMessage",
        body: { id: "session-1", content: "hello" },
      }),
    );
    await completed;
    expect(frames).toHaveLength(5);
    expect(
      frames.every((frame) => (frame as { kind: string }).kind === "event"),
    ).toBe(true);
    expect(
      (frames[1] as { body: { dataJson: string; cursor: string } }).body
        .dataJson,
    ).toContain('"type":6');
    expect((frames[1] as { body: { cursor: string } }).body.cursor).toBe("c1");
    expect(
      (frames[3] as { body: { messageActionDeltas: unknown[] } }).body
        .messageActionDeltas,
    ).toHaveLength(1);
    ws.close();
  });

  it("enqueues a message through the same authenticated operation surface", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const response = await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-enqueue",
      operation: "enqueueMessage",
      body: { id: "session-1", content: "wait behind the active turn" },
    });
    expect(response).toMatchObject({
      kind: "response",
      requestId: "req-enqueue",
      body: { itemId: "queued-fixture", status: "queued", position: 1 },
    });
    expect(port.lastEnqueueRequest).toEqual({
      id: "session-1",
      content: "wait behind the active turn",
    });
    ws.close();
  });

  it("returns a running stream iterator when its WebSocket connection closes", async () => {
    let returned = false;
    const pendingIterator: AsyncIterator<{ readonly dataJson?: string }> = {
      next: () =>
        new Promise<IteratorResult<{ readonly dataJson?: string }>>(
          () => undefined,
        ),
      return: async () => {
        returned = true;
        return { done: true, value: undefined };
      },
    };
    port.sendResult = {
      ok: true,
      source: { [Symbol.asyncIterator]: () => pendingIterator },
    };
    const { url } = await bootService();
    const { ws, upgrade, closed } = openClient(url);
    await upgrade;
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-cancel-stream",
        operation: "sendMessage",
        body: { id: "session-1", content: "long running" },
      }),
    );
    await port.sendObserved;
    ws.close();
    await closed;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(returned).toBe(true);
    expect(port.abortCalls).toBe(0);
  });

  it("drives the fresh-page list, selection, history and send sequence over one credential", async () => {
    port.listSessions = async () => ({
      sessions: [
        {
          sessionId: "fresh-session",
          agentName: "main",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      hasMore: false,
    });
    port.getMessages = async (request) => ({
      messages: [
        {
          msgId: "history-1",
          role: "assistant",
          msgContent: `history for ${request.id}`,
        },
      ],
      hasMore: false,
    });
    port.sendResult = {
      ok: true,
      source: [
        { dataJson: '{"type":10}' },
        {
          dataJson:
            '{"type":6,"agent_message_chunk":{"msg_id":"reply-1","msg_content":"reply"}}',
        },
        { dataJson: "[DONE]" },
      ],
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = (requestId: string, operation: string, body: unknown) =>
      requestOnce(ws, {
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId,
        operation,
        body,
      });
    const listed = await request("req-page-list", "listSessions", {
      name: "main",
    });
    const selectedId = (
      listed as { body: { sessions: Array<{ sessionId: string }> } }
    ).body.sessions[0]!.sessionId;
    expect(selectedId).toBe("fresh-session");
    const history = await request("req-page-history", "getMessages", {
      id: selectedId,
    });
    expect(
      (history as { body: { messages: Array<{ msgContent?: string }> } }).body
        .messages[0]!.msgContent,
    ).toBe("history for fresh-session");

    const frames: Array<{ kind: string; body?: { dataJson?: string } }> = [];
    const completed = new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        try {
          const frame = JSON.parse(
            raw.toString("utf8"),
          ) as (typeof frames)[number];
          frames.push(frame);
          if (frame.body?.dataJson === "[DONE]") resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-page-send",
        operation: "sendMessage",
        body: { id: selectedId, content: "hello" },
      }),
    );
    await completed;
    expect(frames.map((frame) => frame.body?.dataJson)).toEqual([
      '{"type":10}',
      '{"type":6,"agent_message_chunk":{"msg_id":"reply-1","msg_content":"reply"}}',
      "[DONE]",
    ]);

    port.sendResult = {
      ok: false,
      status: 409,
      body: { key: "delivery_closed", message: "The turn delivery is closed." },
    };
    const refused = await request("req-page-refused", "sendMessage", {
      id: selectedId,
      content: "again",
    });
    expect(refused).toMatchObject({
      kind: "error",
      requestId: "req-page-refused",
      code: "delivery_closed",
    });
    ws.close();
  });

  it("executes the shipped client transport against the real service", async () => {
    const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-transport-"),
    );
    port.listSessions = async () => ({
      sessions: [
        {
          sessionId: "transport-session",
          agentName: "main",
          createdAt: 1,
          updatedAt: 2,
        },
      ],
      hasMore: false,
    });
    port.getMessages = async (request) => ({
      messages: [
        {
          msgId: "transport-history",
          role: "assistant",
          msgContent: `history for ${request.id}`,
        },
      ],
      hasMore: false,
    });
    port.createSession = async () => ({ sessionId: "transport-created" });
    port.sendResult = {
      ok: true,
      source: [
        { dataJson: '{"type":10}' },
        {
          dataJson:
            '{"type":6,"agent_message_chunk":{"msg_id":"reply","msg_content":"hello"}}',
        },
        { dataJson: "[DONE]" },
      ],
    };
    try {
      const { credential } = await bootService();
      const transport = createWebuiTransport({
        websocketUrl: service.info().boundUrl,
        token: credential.token,
        webSocket: WebSocket as unknown as NonNullable<
          Parameters<typeof createWebuiTransport>[0]["webSocket"]
        >,
      });
      const listed = await transport.loadSessions();
      const selectedId = listed.sessions[0]?.sessionId;
      expect(selectedId).toBe("transport-session");
      const history = await transport.loadMessages({ id: selectedId! });
      expect(history.messages?.[0]?.msgContent).toBe(
        "history for transport-session",
      );
      const created = await transport.createSession({
        name: "main",
        workspaceDir,
      });
      expect(created.sessionId).toBe("transport-created");
      const frames: string[] = [];
      await transport.sendMessage(
        { id: selectedId!, content: "hello" },
        (frame) => frames.push(frame.dataJson ?? ""),
      );
      expect(frames).toEqual([
        '{"type":10}',
        '{"type":6,"agent_message_chunk":{"msg_id":"reply","msg_content":"hello"}}',
        "[DONE]",
      ]);
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects request and stream promises when the client socket closes without a response", async () => {
    const transport = createWebuiTransport({
      websocketUrl: "ws://127.0.0.1:1",
      token: "fixture-token",
      webSocket: ClosingSocket,
    });
    await expect(transport.loadSessions()).rejects.toThrow(
      "WebUI connection closed before the response",
    );
    await expect(
      transport.sendMessage(
        { id: "session", content: "hello" },
        () => undefined,
      ),
    ).rejects.toThrow("WebUI connection closed before [DONE]");
  });

  it("turns an refused send result into a client-visible error", async () => {
    port.sendResult = {
      ok: false,
      status: 409,
      body: { key: "delivery_closed", message: "The turn delivery is closed." },
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const response = await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-refused",
      operation: "sendMessage",
      body: { id: "session-1", content: "hello" },
    });
    expect(response).toMatchObject({
      kind: "error",
      requestId: "req-refused",
      code: "delivery_closed",
      message: "The turn delivery is closed.",
    });
    ws.close();
  });

  it("streams resumeSession as ordered event frames and forwards the cursor the client supplies", async () => {
    // resumeSession shares the wire shape of sendMessage (the harness
    // contract returns the same iterable source — see
    // `cli-service.ts:294-301`). The service forwards the body verbatim
    // and the registered handler resolves to `{stream: ...}` so the
    // service's `for await` loop emits `event` frames with the harness's
    // frames as the body.
    port.resumeResult = {
      ok: true,
      source: [
        { dataJson: '{"type":10}' },
        {
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"replayed","msg_content":"after-c1"}}',
          cursor: "c2",
        },
        { dataJson: "[DONE]" },
      ],
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const frames: unknown[] = [];
    const completed = new Promise<void>((resolve, reject) => {
      ws.on("message", (raw) => {
        try {
          const frame = JSON.parse(raw.toString("utf8")) as {
            kind: string;
            body?: { dataJson?: string; cursor?: string };
          };
          frames.push(frame);
          if (frame.kind === "event" && frame.body?.dataJson === "[DONE]")
            resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-resume",
        operation: "resumeSession",
        body: { id: "session-1", afterCursor: "c1" },
      }),
    );
    await completed;
    expect(frames).toHaveLength(3);
    expect((frames[1] as { body: { cursor: string } }).body.cursor).toBe("c2");
    // The body the service forwarded to the port is the body the client
    // sent — including `afterCursor`. The harness is what eventually
    // honours it; the service does not rewrite or strip it.
    expect(port.lastResumeRequest).toEqual({
      id: "session-1",
      afterCursor: "c1",
    });
    ws.close();
  });

  it("lets the server-side turn keep running when the client WebSocket closes mid-stream", async () => {
    // Closing a tab must unsubscribe without stopping the turn. The
    // service wires each operation to a per-request `for await` loop
    // (see `service.ts:#handleMessage`), which calls `sendFrame` for
    // every harness frame. `sendFrame` no-ops once the socket is closed,
    // but the harness source keeps emitting until it is exhausted, and
    // the server-side promise of `entry.handle(...)` resolves when the
    // source is done. We assert that promise resolves after the client
    // closes, which means the turn ran to completion on the server
    // side even though the client went away.
    let resolveHarness!: () => void;
    const harnessDone = new Promise<void>((resolve) => {
      resolveHarness = resolve;
    });
    let harnessFrameCount = 0;
    const slowSource = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            harnessFrameCount += 1;
            // Emit three frames then close. The second frame is what
            // the client receives before it closes the socket; the
            // third only lands server-side.
            if (harnessFrameCount === 1)
              return { value: { dataJson: '{"type":10}' }, done: false };
            if (harnessFrameCount === 2)
              return {
                value: {
                  dataJson:
                    '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"partial"}}',
                },
                done: false,
              };
            resolveHarness();
            return { value: { dataJson: "[DONE]" }, done: true };
          },
        };
      },
    };
    port.sendResult = { ok: true, source: slowSource };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const receivedBeforeClose = new Promise<unknown>((resolve) => {
      ws.on("message", (raw) => {
        try {
          const frame = JSON.parse(raw.toString("utf8")) as {
            kind: string;
            body?: { dataJson?: string };
          };
          if (frame.body?.dataJson?.includes("partial")) resolve(frame);
        } catch {
          // ignore parse errors
        }
      });
    });
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-midstream-close",
        operation: "sendMessage",
        body: { id: "session-1", content: "hello" },
      }),
    );
    // Wait for the client to receive a frame, then close mid-stream.
    await receivedBeforeClose;
    ws.close();
    // The harness stream must still drain to completion on the server
    // side even though the client went away. If it were tied to the
    // socket lifecycle this promise would never resolve.
    await harnessDone;
    expect(harnessFrameCount).toBe(3);
  });

  it("serves the built client only with the credential and injects runtime configuration", async () => {
    const { credential } = await bootService();
    const response = await fetch(
      `http://127.0.0.1:${service.info().tcpPort}/?token=${encodeURIComponent(credential.token)}`,
    );
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("__WEBUI_CONFIG__");
    expect(html).toContain(credential.token);
    expect(html).toContain("client.js");
    expect(
      (await fetch(`http://127.0.0.1:${service.info().tcpPort}/`)).status,
    ).toBe(401);
  });

  it("serves the linked assets without a credential when dev mode is on", async () => {
    // This is the test that would have caught the blank page. The served
    // HTML references `./styles.css` and `./client.js` as relative URLs —
    // a real browser resolves them without ever seeing the `?token=`
    // query. Without dev mode the asset requests 401 and the page is
    // unstyled; with dev mode they must succeed without inventing query
    // parameters.
    //
    // The assets are read from the `clientDir` override so the test does
    // not depend on which source-layout path `findClientDirectory()`
    // happens to pick — both modes are exercised against the same
    // hermetic fixture.
    const fixtureDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-clientdir-"),
    );
    const { writeFile } = await import("node:fs/promises");
    await writeFile(
      path.join(fixtureDir, "index.html"),
      "<!doctype html><html><head></head><body data-fixture='true'></body></html>",
    );
    await writeFile(path.join(fixtureDir, "client.js"), "// client-fixture");
    await writeFile(
      path.join(fixtureDir, "styles.css"),
      "/* styles-fixture */",
    );
    try {
      const devService = new WebuiService({
        port,
        dev: true,
        clientDir: fixtureDir,
      });
      try {
        await devService.start();
        const port1 = devService.info().tcpPort;
        for (const path of ["/", "/client.js", "/styles.css"]) {
          const response = await fetch(`http://127.0.0.1:${port1}${path}`);
          expect(response.status, `dev-mode GET ${path}`).toBe(200);
        }
      } finally {
        await devService.close();
      }
      // Default mode still requires the credential on the same paths.
      const prodService = new WebuiService({
        port,
        clientDir: fixtureDir,
      });
      try {
        await prodService.start();
        const port2 = prodService.info().tcpPort;
        for (const path of ["/", "/client.js", "/styles.css"]) {
          const response = await fetch(`http://127.0.0.1:${port2}${path}`);
          expect(response.status, `default-mode GET ${path}`).toBe(401);
        }
      } finally {
        await prodService.close();
      }
    } finally {
      await rm(fixtureDir, { recursive: true, force: true });
    }
  });

  it("reads assets from the supplied clientDir override rather than the discovered path", async () => {
    // The brief asks for the built-artifact path to be testable so the
    // blank-page regression cannot come back. We stage a small fixture
    // and assert the override reaches the served page without the
    //    credential the previous mode demanded.
    const workspaceDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-clientdir-"),
    );
    try {
      const { writeFile } = await import("node:fs/promises");
      await writeFile(
        path.join(workspaceDir, "index.html"),
        "<!doctype html><html><head></head><body data-fixture='true'></body></html>",
      );
      await writeFile(
        path.join(workspaceDir, "client.js"),
        "// client-fixture",
      );
      await writeFile(
        path.join(workspaceDir, "styles.css"),
        "/* styles-fixture */",
      );
      service = new WebuiService({
        port,
        dev: true,
        clientDir: workspaceDir,
      });
      await service.start();
      const tcpPort = service.info().tcpPort;
      const html = await (await fetch(`http://127.0.0.1:${tcpPort}/`)).text();
      expect(html).toContain("data-fixture='true'");
      const js = await (
        await fetch(`http://127.0.0.1:${tcpPort}/client.js`)
      ).text();
      expect(js).toBe("// client-fixture");
      const css = await (
        await fetch(`http://127.0.0.1:${tcpPort}/styles.css`)
      ).text();
      expect(css).toBe("/* styles-fixture */");
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("accepts a websocket upgrade without a credential when dev mode is on", async () => {
    // The HTTP asset path is only half of the contract — the WebSocket
    // upgrade must follow the same gate so the runtime configuration the
    // page boots with can actually connect.
    service = new WebuiService({ port, dev: true });
    await service.start();
    const url = `ws://127.0.0.1:${service.info().tcpPort}`;
    const { upgrade } = openClient(url);
    await upgrade;
  });

  it("lists sessions through the narrow port and preserves cursor paging", async () => {
    const calls: WebuiSessionListRequest[] = [];
    const pages = [
      {
        sessions: [
          { sessionId: "new", agentName: "main", createdAt: 20, updatedAt: 30 },
        ],
        hasMore: true,
        nextCursor: "cursor-2",
      },
      {
        sessions: [
          { sessionId: "old", agentName: "main", createdAt: 10, updatedAt: 15 },
        ],
        hasMore: false,
      },
    ];
    port.listSessions = async (request) => {
      calls.push(request);
      return pages[calls.length - 1];
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = (requestId: string, body: unknown) =>
      requestOnce(ws, {
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId,
        operation: "listSessions",
        body,
      });
    const first = await request("req-list-1", { name: "main", limit: 1 });
    const second = await request("req-list-2", {
      name: "main",
      limit: 1,
      cursor: "cursor-2",
    });
    expect((first as { body: (typeof pages)[0] }).body.nextCursor).toBe(
      "cursor-2",
    );
    expect(
      (second as { body: (typeof pages)[1] }).body.sessions[0].sessionId,
    ).toBe("old");
    expect(calls).toEqual([
      { name: "main", limit: 1 },
      { name: "main", limit: 1, cursor: "cursor-2" },
    ]);
    ws.close();
  });

  it("creates a session only with an existing absolute directory and forwards the narrow request", async () => {
    const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "webui-create-"));
    const calls: WebuiCreateSessionRequest[] = [];
    port.createSession = async (request) => {
      calls.push(request);
      return {
        session: {
          sessionId: "created-session",
          workspaceDir: request.workspaceDir,
        },
      };
    };
    try {
      const { url } = await bootService();
      const { ws, upgrade } = openClient(url);
      await upgrade;
      const request = (requestId: string, body: unknown) =>
        requestOnce(ws, {
          protocolVersion: WEBUI_PROTOCOL_VERSION,
          kind: "request",
          requestId,
          operation: "createSession",
          body,
        });
      const created = await request("req-create", {
        name: " main ",
        workspaceDir: ` ${workspaceDir} `,
        teamModeOff: false,
        ignored: true,
      });
      expect(
        (created as { body: { session: { sessionId: string } } }).body.session
          .sessionId,
      ).toBe("created-session");
      expect(calls).toEqual([{ name: "main", workspaceDir, teamModeOff: false }]);
      const relative = await request("req-create-relative", {
        name: "main",
        workspaceDir: "relative",
      });
      expect((relative as { code: string }).code).toBe(
        WebuiErrorCode.invalidBody,
      );
      const currentDirectory = await request("req-create-current-directory", {
        name: "main",
        workspaceDir: ".",
      });
      expect((currentDirectory as { code: string }).code).toBe(
        WebuiErrorCode.invalidBody,
      );
      expect(calls).toHaveLength(1);
      const missing = await request("req-create-missing", {
        name: "main",
        workspaceDir: path.join(workspaceDir, "missing"),
      });
      expect((missing as { code: string }).code).toBe(
        WebuiErrorCode.invalidBody,
      );
      const absent = await request("req-create-absent", {
        name: "",
        workspaceDir,
      });
      expect((absent as { code: string }).code).toBe(
        WebuiErrorCode.invalidBody,
      );
      expect(calls).toHaveLength(1);
      ws.close();
    } finally {
      await rm(workspaceDir, { recursive: true, force: true });
    }
  });

  it("rejects a session-list body without the required harness name", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const response = await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-list-invalid",
      operation: "listSessions",
      body: { limit: 10 },
    });
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.invalidBody);
    ws.close();
  });

  it("opens a session and reads message history with the CLI-level id and before cursor", async () => {
    const sessionCalls: WebuiSessionLookupRequest[] = [];
    const messageCalls: WebuiMessagesRequest[] = [];
    port.getSession = async (request) => {
      sessionCalls.push(request);
      return { session: { sessionId: request.id, title: "History" } };
    };
    port.getMessages = async (request) => {
      messageCalls.push(request);
      return request.before
        ? {
            messages: [{ msgId: "older", role: "user", msgContent: "Earlier" }],
            hasMore: false,
          }
        : {
            messages: [
              { msgId: "newer", role: "assistant", msgContent: "Later" },
            ],
            nextCursor: "before-1",
            hasMore: true,
          };
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = (requestId: string, operation: string, body: unknown) =>
      requestOnce(ws, {
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId,
        operation,
        body,
      });
    const sessionResponse = await request("req-session", "getSession", {
      id: "session-1",
    });
    const first = await request("req-messages-1", "getMessages", {
      id: "session-1",
      limit: 1,
    });
    const second = await request("req-messages-2", "getMessages", {
      id: "session-1",
      limit: 1,
      before: "before-1",
    });
    expect(
      (sessionResponse as { body: { session: { title: string } } }).body.session
        .title,
    ).toBe("History");
    expect((first as { body: WebuiMessagesResult }).body.nextCursor).toBe(
      "before-1",
    );
    expect(
      (second as { body: WebuiMessagesResult }).body.messages?.[0].msgId,
    ).toBe("older");
    expect(sessionCalls).toEqual([{ id: "session-1" }]);
    expect(messageCalls).toEqual([
      { id: "session-1", limit: 1 },
      { id: "session-1", limit: 1, before: "before-1" },
    ]);
    ws.close();
  });

  it("rejects session history bodies that use sessionId instead of id", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const response = await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-messages-invalid",
      operation: "getMessages",
      body: { sessionId: "wrong-field" },
    });
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.invalidBody);
    ws.close();
  });

  it("routes workspace and canvas operations through the harness port", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = (requestId: string, operation: string, body: unknown) =>
      requestOnce(ws, { protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "request", requestId, operation, body });
    const tree = await request("req-tree", "listWorkspaceFileTree", { workspaceDir: "/tmp" });
    const content = await request("req-read", "readWorkspaceFile", { workspaceDir: "/tmp", path: "README.md" });
    const canvas = await request("req-canvas", "readCanvas", { sessionId: "fixture-session" });
    const applied = await request("req-apply", "applyCanvas", { sessionId: "fixture-session", operation: { operationId: "op-1", mutations: [] } });
    expect((tree as { body: Array<{ path: string }> }).body[0]?.path).toBe("README.md");
    expect((content as { body: { content: string } }).body.content).toContain("fixture content");
    expect((canvas as { body: { sessionId: string } }).body.sessionId).toBe("fixture-session");
    expect((applied as { body: { operationId: string } }).body.operationId).toBe("op-1");
    const denied = await request("req-read-denied", "readWorkspaceFile", { workspaceDir: "/tmp", path: "../../etc/passwd" });
    expect((denied as { kind: string }).kind).toBe("error");
    ws.close();
  });

  it("rejects a request whose operation is outside the allowlist", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-unknown",
      operation: "not-an-operation",
      body: {},
    };
    const response = await requestOnce(ws, request);
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.unknownOperation);
    ws.close();
  });

  it("rejects a version request whose body carries fields", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-version-with-body",
      operation: "version",
      body: { sneaky: true },
    };
    const response = await requestOnce(ws, request);
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.invalidBody);
    ws.close();
  });

  it("rejects frames whose protocolVersion does not match the service", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = {
      protocolVersion: 99,
      kind: "request",
      requestId: "req-bad-protocol",
      operation: "version",
      body: undefined,
    };
    const response = await requestOnce(ws, request);
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.protocolMismatch);
    ws.close();
  });

  it("rejects frames that are not valid JSON", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const responsePromise = new Promise<unknown>((resolve, reject) => {
      const onMessage = (raw: RawData) => {
        ws.off("message", onMessage);
        ws.off("error", onError);
        try {
          resolve(JSON.parse(raw.toString("utf8")));
        } catch (error) {
          reject(error);
        }
      };
      const onError = (error: Error) => {
        ws.off("message", onMessage);
        reject(error);
      };
      ws.on("message", onMessage);
      ws.once("error", onError);
      ws.send("this is not json");
    });
    const response = await responsePromise;
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.invalidEnvelope);
    ws.close();
  });

  it("shuts down in order: refuse operations, then close connections, then close the harness port", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-before-shutdown",
      operation: "version",
      body: undefined,
    };
    const response = await requestOnce(ws, request);
    if (!isWebuiFrame(response) || response.kind !== "response")
      throw new Error("version query should have answered before shutdown");

    const closePromise = service.close();
    const closeObserved = awaitClose(ws);
    const [info] = await Promise.all([closeObserved, closePromise]);
    expect(info.code).toBeGreaterThanOrEqual(1000);
    expect(port.closed).toBe(true);
    // A second close is a no-op (the first already refused new operations).
    await service.close();
  });

  it("does not accept requests after shutdown has been requested", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    // Drive the shutdown and assert the in-flight connection is closed.
    await service.close();
    const closeEvent = await awaitClose(ws);
    expect(closeEvent.code).toBeGreaterThanOrEqual(1000);
    expect(port.closed).toBe(true);
  });

  it("forwards global runtime events on a connection-scoped watcher", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const event = new Promise<Record<string, unknown>>((resolve, reject) => {
      const onMessage = (raw: RawData) => {
        try {
          const frame = JSON.parse(raw.toString("utf8")) as Record<
            string,
            unknown
          >;
          if (frame.kind === "event") {
            ws.off("error", onError);
            resolve(frame);
          }
        } catch (error) {
          reject(error);
        }
      };
      const onError = (error: Error) => {
        ws.off("message", onMessage);
        reject(error);
      };
      ws.on("message", onMessage);
      ws.once("error", onError);
    });
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "watch-events",
        operation: "watchEvents",
      }),
    );
    const frame = await event;
    expect(frame.requestId).toBe("watch-events");
    expect(frame.body).toMatchObject({ type: "session.start", source: "test" });
    ws.close();
  });

  it("routes permission and questionnaire answers to the running harness turn", async () => {
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;

    await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "reply-permission",
      operation: "replyPermission",
      body: {
        name: "main",
        requestId: "permission-1",
        reply: "allowOnce",
      },
    });
    await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "reply-questionnaire",
      operation: "replyQuestionnaire",
      body: {
        name: "main",
        requestId: "questionnaire-1",
        schemaVersion: 1,
        answers: [
          {
            stepId: "purpose",
            selectedOptionIds: [],
            selectedOther: true,
            otherText: "Keep the current behavior",
          },
        ],
      },
    });
    await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "dismiss-questionnaire",
      operation: "dismissQuestionnaire",
      body: { name: "main", requestId: "questionnaire-1" },
    });

    expect(port.lastPermissionReply).toEqual({
      name: "main",
      requestId: "permission-1",
      reply: "allowOnce",
    });
    expect(port.lastQuestionnaireReply).toEqual({
      name: "main",
      requestId: "questionnaire-1",
      schemaVersion: 1,
      answers: [
        {
          stepId: "purpose",
          selectedOptionIds: [],
          selectedOther: true,
          otherText: "Keep the current behavior",
        },
      ],
    });
    expect(port.lastQuestionnaireDismissal).toEqual({
      name: "main",
      requestId: "questionnaire-1",
    });
    ws.close();
  });

  it("keeps two tab subscriptions independent when one tab closes", async () => {
    const { url } = await bootService();
    const first = openClient(url);
    const second = openClient(url);
    await Promise.all([first.upgrade, second.upgrade]);

    const watch = (ws: WebSocket, requestId: string) => {
      const event = new Promise<Record<string, unknown>>((resolve, reject) => {
        const onMessage = (raw: RawData) => {
          try {
            const frame = JSON.parse(raw.toString("utf8")) as Record<
              string,
              unknown
            >;
            if (frame.requestId === requestId && frame.kind === "event") {
              ws.off("error", onError);
              resolve(frame);
            }
          } catch (error) {
            reject(error);
          }
        };
        const onError = (error: Error) => {
          ws.off("message", onMessage);
          reject(error);
        };
        ws.on("message", onMessage);
        ws.once("error", onError);
      });
      ws.send(
        JSON.stringify({
          protocolVersion: WEBUI_PROTOCOL_VERSION,
          kind: "request",
          requestId,
          operation: "watchEvents",
          body: {},
        }),
      );
      return event;
    };

    const [firstEvent, secondEvent] = await Promise.all([
      watch(first.ws, "watch-first"),
      watch(second.ws, "watch-second"),
    ]);
    expect(firstEvent).toMatchObject({
      requestId: "watch-first",
      body: { type: "session.start", payload: { sessionId: "fixture-session" } },
    });
    expect(secondEvent).toMatchObject({
      requestId: "watch-second",
      body: { type: "session.start", payload: { sessionId: "fixture-session" } },
    });

    first.ws.close();
    await first.closed;
    const response = await requestOnce(second.ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "version-after-first-tab-close",
      operation: "version",
      body: undefined,
    });
    expect(response).toMatchObject({
      kind: "response",
      requestId: "version-after-first-tab-close",
    });
    second.ws.close();
  });
});

describe("WebUI operation allowlist", () => {
  it("enforces structural validation on every request body", async () => {
    const port = new ScriptedHarnessPort();
    const service = new WebuiService({ port });
    try {
      await service.start();
      // The transport already exercises this with the ws test; here we
      // exercise the operations module directly so the test stays in
      // scope for future operations without spinning up another server.
      const { createOperationRegistry } =
        await import("../../src/server/index.js");
      const registry = createOperationRegistry(port);
      expect(registry.has("version")).toBe(true);
      expect(registry.has("sendMessage")).toBe(true);
      expect(registry.has("enqueueMessage")).toBe(true);
      expect(registry.has("getSession")).toBe(true);
      expect(registry.has("getMessages")).toBe(true);
      expect(registry.has("getWorkspaceEnvironment")).toBe(true);
      expect(registry.has("mutateWorkspaceGit")).toBe(true);
      // resumeSession sits next to sendMessage in the allowlist because it
      // shares the same wire shape (the brief's "resume is not a second
      // transport"). It must be registered, validator-bound, and reachable
      // through the same `entry.handle(...)` plumbing.
      expect(registry.has("resumeSession")).toBe(true);
      expect(registry.has("watchEvents")).toBe(true);
      expect(registry.has("replyPermission")).toBe(true);
      expect(registry.has("abortSession")).toBe(true);
      expect(registry.has("listModels")).toBe(true);
      expect(registry.has("getAccountStatus")).toBe(true);
      for (const operation of [
        "archiveSession", "deleteSession", "listUserModelProviders", "createUserModelProvider",
        "updateUserModelProvider", "deleteUserModelProvider", "testUserModelProvider", "testUserModel",
        "discoverUserModelsCandidate", "saveUserModelProviderCandidate", "listProviderPresets",
        "getMiniMaxApiKeyStatus", "upsertMiniMaxApiKey", "getCodexOAuthStatus",
      ]) expect(registry.has(operation)).toBe(true);
    } finally {
      await service.close();
    }
  });

  it("routes provider reads and writes through the registry without exposing secrets", async () => {
    const { createOperationRegistry } = await import("../../src/server/index.js");
    const port = new ScriptedHarnessPort();
    const registry = createOperationRegistry(port);
    const result = async (name: string, body: unknown) => (await registry.get(name)?.handle({ requestId: name }, body)) as { readonly body: unknown };
    expect(await result("listUserModelProviders", undefined)).toMatchObject({ body: [{ providerId: "fixture-provider" }] });
    expect(await result("createUserModelProvider", { providerId: "synthetic-provider" })).toMatchObject({ body: { success: true } });
    expect(await result("updateUserModelProvider", { providerId: "synthetic-provider" })).toMatchObject({ body: { success: true } });
    expect(await result("deleteUserModelProvider", { providerId: "synthetic-provider" })).toMatchObject({ body: { success: true } });
    expect(await result("testUserModelProvider", { providerId: "fixture-provider" })).toMatchObject({ body: { success: true } });
    expect(await result("testUserModel", { providerId: "fixture-provider", modelId: "fixture-model" })).toMatchObject({ body: { success: true } });
    expect(await result("discoverUserModelsCandidate", { providerId: "fixture-provider" })).toMatchObject({ body: [] });
    expect(await result("saveUserModelProviderCandidate", { providerId: "synthetic-provider" })).toMatchObject({ body: { success: true } });
    expect(await result("listProviderPresets", undefined)).toMatchObject({ body: [] });
    expect(await result("getMiniMaxApiKeyStatus", undefined)).toMatchObject({ body: { hasApiKey: false } });
    expect(await result("getCodexOAuthStatus", undefined)).toMatchObject({ body: { connected: false } });
  });

  it("routes workspace environment reads and git mutations through the registry", async () => {
    const { createOperationRegistry } = await import("../../src/server/index.js");
    const registry = createOperationRegistry(new ScriptedHarnessPort());
    const result = async (name: string, body: unknown) => (await registry.get(name)?.handle({ requestId: name }, body)) as { readonly body: unknown };
    expect(await result("getWorkspaceEnvironment", { workspaceDir: "/tmp/project" })).toMatchObject({ body: { isGitRepo: true, branch: "fixture", changedFiles: 1 } });
    expect(await result("mutateWorkspaceGit", { workspaceDir: "/tmp/project", action: "commit", message: "fixture" })).toMatchObject({ body: { success: true } });
  });
});

describe("WebUI host factory", () => {
  it("is a thin adapter over the harness layer's host", async () => {
    const { createHarnessPortFromHost } =
      await import("../../src/server/index.js");
    const apiHost = {
      closeCalls: 0,
      async close(): Promise<void> {
        this.closeCalls += 1;
      },
    };
    const fakeHost = {
      apiHost,
      dataDir: "/tmp/data",
      appVersion: "1.2.3",
    };
    const harness = createHarnessPortFromHost(fakeHost);
    expect(harness.version().version).toBe("1.2.3");
    await harness.close();
    expect(apiHost.closeCalls).toBe(1);
    // Idempotent close: a second call does not re-close the host.
    await harness.close();
    expect(apiHost.closeCalls).toBe(1);
  });
});

describe("WebUI runtime host assembly", () => {
  it("creates exactly one host per process with the assembly step 6 owner combination", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "webui-assembly-c1-"));
    let calls = 0;
    let lastOptions: Record<string, unknown> | undefined;
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        appVersion: "0.4.2-assembly-test",
        factory: async (options) => {
          calls += 1;
          lastOptions = { ...options };
          return {
            apiHost: { close: async () => undefined },
            dataDir: options.dataDir,
            appVersion: "0.4.2-assembly-test",
          };
        },
      });
      await assembled.harnessPort.close();
      expect(calls).toBe(1);
      expect(lastOptions?.runtimeOwnerKind).toBe("tui");
      expect(lastOptions?.capabilityProfile).toBe("cli");
      expect(lastOptions?.runtimeMode).toBe("clean");
      expect(lastOptions?.startupExecutionPolicy).toBe("quarantined");
      expect(lastOptions?.dataDir).toBe(dataDir);
      expect(lastOptions?.appVersion).toBe("0.4.2-assembly-test");
      const capabilities = lastOptions?.capabilities as Record<string, unknown>;
      expect(capabilities.cliEmbedded).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("exposes the usage quota client on both the host and the harness port", async () => {
    // `scripts/run-webui-server.mjs` builds the service port from
    // `assembled.host`, not from `assembled.harnessPort` — if the quota
    // client lives only on the harness port, the live panel fails with
    // "runtime host does not expose the usage quota client".
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-quota-"),
    );
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        appVersion: "0.4.2-assembly-test",
        factory: async (options) => ({
          apiHost: { close: async () => undefined },
          dataDir: options.dataDir,
          appVersion: "0.4.2-assembly-test",
        }),
      });
      expect(assembled.host.getUsageQuota).toBeTypeOf("function");
      expect(assembled.harnessPort.getUsageQuota).toBeTypeOf("function");
      expect(assembled.host.getSigninPanel).toBeTypeOf("function");
      expect(assembled.host.claimSignin).toBeTypeOf("function");
      expect(assembled.harnessPort.getSigninPanel).toBeTypeOf("function");
      expect(assembled.harnessPort.claimSignin).toBeTypeOf("function");
      await assembled.harnessPort.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("hands the runtime an auth context getter and invalidator for managed login", async () => {
    // Assembly step 3 of `docs/webui-v1-scope.md`. Managed MiniMax login has no
    // API key, so without this pair the resolver throws "managed OAuth bearer is
    // not synced" and every turn dies at the agent preflight — even with the
    // credential sitting in the data directory.
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-auth-"),
    );
    const scopeDirectory = path.join(dataDir, "cli-auth", "prod", "cn");
    let lastOptions: Record<string, unknown> | undefined;
    try {
      await mkdir(scopeDirectory, { recursive: true });
      await writeFile(
        path.join(scopeDirectory, "cli-auth.scope.json"),
        `${JSON.stringify({ version: 1, updatedAtMs: 1, region: "cn", buildEnv: "prod" })}\n`,
        "utf8",
      );
      await writeFile(
        path.join(scopeDirectory, "local-runtime.auth.json"),
        `${JSON.stringify({
          version: 1,
          updatedAtMs: 1,
          auth: { accessToken: "assembled-token", realUserID: "user-1" },
        })}\n`,
        "utf8",
      );

      const assembled = await createWebuiRuntimeHost({
        dataDir,
        factory: async (options) => {
          lastOptions = { ...options };
          return { apiHost: { close: async () => undefined }, dataDir };
        },
      });
      await assembled.harnessPort.close();

      const getter = lastOptions?.authContextGetter as
        (() => { accessToken?: string } | undefined) | undefined;
      const invalidator = lastOptions?.authContextInvalidator as
        ((rejectedAccessToken?: string) => void) | undefined;
      expect(typeof getter).toBe("function");
      expect(typeof invalidator).toBe("function");
      expect(getter?.()?.accessToken).toBe("assembled-token");
      // A token the runtime rejected is not handed back a second time.
      invalidator?.("assembled-token");
      expect(getter?.()).toBeUndefined();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("declares the three interaction capabilities explicitly (criterion 2)", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "webui-assembly-c2-"));
    let lastOptions: Record<string, unknown> | undefined;
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        factory: async (options) => {
          lastOptions = { ...options };
          return {
            apiHost: { close: async () => undefined },
            dataDir: options.dataDir,
          };
        },
      });
      await assembled.harnessPort.close();
      const capabilities = lastOptions?.capabilities as Record<string, unknown>;
      // Mirror `packages/tui/src/runtime/lifecycle.ts:451-455`: the WebUI
      // is the surface that answers questionnaire, permission and
      // elicitation, so all three are true here.
      expect(capabilities.questionnaireReply).toBe(true);
      expect(capabilities.permissionPrompt).toBe(true);
      expect(capabilities.elicitation).toBe(true);
      expect(lastOptions?.enableLiveMcp).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not add a 'webui' value to surface (ADR 0004)", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-surface-"),
    );
    let lastOptions: Record<string, unknown> | undefined;
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        factory: async (options) => {
          lastOptions = { ...options };
          return {
            apiHost: { close: async () => undefined },
            dataDir: options.dataDir,
          };
        },
      });
      await assembled.harnessPort.close();
      // The assembly intentionally omits `surface`; ADR 0004 forbids
      // extending the `surface` enum, and assembly step 4 says the WebUI
      // does not need a new value because `runtimeOwnerKind: 'tui'` plus
      // the capabilities already identify the surface.
      expect("surface" in (lastOptions ?? {})).toBe(false);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("wires the assembled host through the harness port that WebuiService tears down last", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-port-"),
    );
    let apiHostClosed = false;
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        factory: async (options) => ({
          apiHost: {
            async close(): Promise<void> {
              apiHostClosed = true;
            },
          },
          dataDir: options.dataDir,
        }),
      });
      expect(assembled.harnessPort.close).toBeTypeOf("function");
      expect(assembled.harnessPort.version).toBeTypeOf("function");
      await assembled.harnessPort.close();
      expect(apiHostClosed).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("assembles tool capabilities explicitly and releases both owners on shutdown", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-tools-"),
    );
    const calls: string[] = [];
    let forwarded: Record<string, unknown> | undefined;
    const browserAdapter = {
      async execute(): Promise<unknown> {
        return { success: true, url: "https://example.test" };
      },
    };
    try {
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        mcodeToolsRequested: true,
        browserToolExposure: "both",
        browserProvider: {
          adapter: browserAdapter,
          close: () => {
            calls.push("browser");
          },
        },
        mcodeTools: {
          prepare: async () => ({
            requested: true,
            ready: true,
            category: "ready" as const,
            ensureCommandPath: () => calls.push("command-path"),
            dispose: async () => {
              calls.push("broker");
            },
          }),
        },
        factory: async (options) => {
          forwarded = { ...options };
          return {
            apiHost: {
              close: async () => {
                calls.push("runtime");
              },
            },
            dataDir: options.dataDir,
          };
        },
      });
      const config = (
        forwarded?.configGetter as () => {
          beta?: Record<string, unknown>;
        }
      )();
      expect(config.beta?.mcodeTools).toBe(true);
      expect(config.beta?.browserUseTooling).toBe(true);
      expect(forwarded?.browserAdapter).toBe(browserAdapter);
      expect(forwarded?.browserToolExposure).toBe("both");
      expect(calls).toContain("command-path");
      await assembled.harnessPort.close();
      expect(calls).toEqual(["command-path", "runtime", "broker", "browser"]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("reads a newly persisted default model through the live runtime config getter", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-model-config-") ,
    );
    let readConfig: (() => { readonly defaultModel?: string }) | undefined;
    try {
      vi.stubEnv("MINIMAX_DATA_DIR", dataDir);
      vi.stubEnv("DISABLE_GIT_AUTO_CONFIG", "1");
      await writeFile(
        path.join(dataDir, "config.yaml"),
        "defaultModel: minimax/MiniMax-M2.7\n",
        "utf8",
      );
      resetDefaultLocalRuntimeConfig();
      const assembled = await createWebuiRuntimeHost({
        dataDir,
        factory: async (options) => {
          readConfig = options.configGetter;
          return {
            apiHost: { close: async () => undefined },
            dataDir: options.dataDir,
          };
        },
      });

      expect(readConfig?.().defaultModel).toBe("minimax/MiniMax-M2.7");
      await updateLocalModelSelection({
        modelKey: "minimax/MiniMax-M3",
        variant: "thinking",
        contextLimit: 512_000,
      });
      expect(readConfig?.().defaultModel).toBe("minimax/MiniMax-M3");

      await assembled.harnessPort.close();
    } finally {
      resetDefaultLocalRuntimeConfig();
      vi.unstubAllEnvs();
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("releases capability owners when host creation fails", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-startup-failure-"),
    );
    const calls: string[] = [];
    try {
      await expect(
        createWebuiRuntimeHost({
          dataDir,
          browserProvider: {
            adapter: {
              async execute(): Promise<unknown> {
                return undefined;
              },
            },
            close: () => {
              calls.push("browser");
            },
          },
          mcodeToolsRequested: true,
          mcodeTools: {
            prepare: async () => ({
              requested: true,
              ready: true,
              category: "ready" as const,
              ensureCommandPath: () => undefined,
              dispose: async () => {
                calls.push("broker");
              },
            }),
          },
          factory: async () => {
            throw new Error("host creation failed");
          },
        }),
      ).rejects.toThrow("host creation failed");
      expect(calls).toEqual(["broker", "browser"]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("closes the partially created host when command-path setup fails", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-command-failure-"),
    );
    const calls: string[] = [];
    try {
      await expect(
        createWebuiRuntimeHost({
          dataDir,
          browserProvider: {
            adapter: {
              async execute(): Promise<unknown> {
                return undefined;
              },
            },
            close: () => {
              calls.push("browser");
            },
          },
          mcodeToolsRequested: true,
          mcodeTools: {
            prepare: async () => ({
              requested: true,
              ready: true,
              category: "ready" as const,
              ensureCommandPath: () => {
                throw new Error("command path failed");
              },
              dispose: async () => {
                calls.push("broker");
              },
            }),
          },
          factory: async (options) => ({
            apiHost: {
              close: async () => {
                calls.push("runtime");
              },
            },
            dataDir: options.dataDir,
          }),
        }),
      ).rejects.toThrow("command path failed");
      expect(calls).toEqual(["runtime", "broker", "browser"]);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

describe("WebUI loopback binding invariant", () => {
  it("refuses to construct the service when the host is a LAN address", async () => {
    const harness = new ScriptedHarnessPort();
    expect(() => new WebuiService({ port: harness, host: "0.0.0.0" })).toThrow(
      /loopback/i,
    );
    expect(() => new WebuiService({ port: harness, host: "10.0.0.5" })).toThrow(
      /loopback/i,
    );
    expect(
      () => new WebuiService({ port: harness, host: "evil.example" }),
    ).toThrow(/loopback/i);
  });

  it("accepts the documented loopback addresses", async () => {
    const harness = new ScriptedHarnessPort();
    for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
      const candidate = new WebuiService({ port: harness, host });
      await candidate.close();
    }
  });
});

describe("WebUI operation body validation", () => {
  it("rejects null and array bodies on the version operation (criterion 5)", async () => {
    const { versionOperation } = await import("../../src/server/index.js");
    const nullResult = versionOperation.validate(null);
    expect(nullResult.ok).toBe(false);
    if (nullResult.ok) throw new Error("null should not be accepted");
    expect(nullResult.code).toBe(WebuiErrorCode.invalidBody);

    const arrayResult = versionOperation.validate([]);
    expect(arrayResult.ok).toBe(false);
    if (arrayResult.ok) throw new Error("[] should not be accepted");
    expect(arrayResult.code).toBe(WebuiErrorCode.invalidBody);

    const objectResult = versionOperation.validate({});
    expect(objectResult.ok).toBe(false);
    if (objectResult.ok) throw new Error("{} should not be accepted");
    expect(objectResult.code).toBe(WebuiErrorCode.invalidBody);

    const stringResult = versionOperation.validate("not-a-body");
    expect(stringResult.ok).toBe(false);
    if (stringResult.ok) throw new Error("string should not be accepted");
    expect(stringResult.code).toBe(WebuiErrorCode.invalidBody);

    const undefinedResult = versionOperation.validate(undefined);
    expect(undefinedResult.ok).toBe(true);
    if (!undefinedResult.ok) throw new Error("undefined should be accepted");
    expect(undefinedResult.body).toBeUndefined();
  });

  it("refuses to register an operation without a body validator", async () => {
    const { registerOperation, versionOperation } =
      await import("../../src/server/index.js");
    const registry = new Map();
    const validatorlessOperation = {
      name: "noValidator",
      // no validate function — registration must fail closed
    } as unknown as { name: string; validate: unknown };
    expect(() =>
      registerOperation(registry, {
        operation: validatorlessOperation,
        handle: () => ({ body: undefined }),
      }),
    ).toThrow(/validator/i);
    expect(registry.size).toBe(0);

    // Sanity check: the real version operation still registers.
    registerOperation(registry, {
      operation: versionOperation,
      handle: () => ({ body: { version: "1", protocolVersion: 1 } }),
    });
    expect(registry.has("version")).toBe(true);
  });
});

describe("WebUI shutdown order (criterion 7)", () => {
  it("refuses new operations before closing connections, and closes connections before the harness port", async () => {
    // A recording port that logs the order in which the service calls
    // its lifecycle hooks. This is the assertion surface for step 13 of
    // the assembly checklist.
    const events: string[] = [];
    let resolveConnectionClosed!: () => void;
    const connectionClosedGate = new Promise<void>((resolve) => {
      resolveConnectionClosed = resolve;
    });
    const recordingPort: WebuiHarnessPort = {
      version() {
        return { version: "0.4.2-shutdown-test", protocolVersion: 1 };
      },
      async listSessions() {
        return { sessions: [], hasMore: false };
      },
      async createSession() {
        return { sessionId: "shutdown" };
      },
      async getSession() {
        return { session: { sessionId: "shutdown" } };
      },
      async getMessages() {
        return { messages: [], hasMore: false };
      },
      async enqueueMessage() {
        return { itemId: "shutdown-queued", status: "queued", position: 1 };
      },
      async close() {
        // The service awaits wsServer.close() and httpServer.close()
        // before calling port.close(), so by the time we land here the
        // transport is fully drained. Wait for the connection close
        // event to be observed before recording port.close so the
        // ordering assertion is deterministic.
        await connectionClosedGate;
        events.push("port.close");
      },
    };
    const localService = new WebuiService({ port: recordingPort });
    const localInfo = await localService.start();
    const url = `${localInfo.boundUrl}/?token=${encodeURIComponent(
      localInfo.credential.token,
    )}`;
    const { ws, upgrade } = openClient(url);
    await upgrade;
    // Send a successful request first so we know the registry was
    // accepting before shutdown started.
    const request = {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-pre-shutdown",
      operation: "version",
      body: undefined,
    };
    const preShutdown = await requestOnce(ws, request);
    if (!isWebuiFrame(preShutdown) || preShutdown.kind !== "response")
      throw new Error("version query should have answered before shutdown");

    // The service's `close()` calls `terminate()` synchronously on
    // every connection, then awaits wsServer.close() (which itself
    // waits for the connections to be torn down), then httpServer.close(),
    // and finally `port.close()`. The connection's `close` event fires
    // before wsServer.close() resolves; capture it and unblock the
    // recording port.
    const connectionClosed = awaitClose(ws).then((closeEvent) => {
      events.push(`connection.terminate:${closeEvent.code}`);
      resolveConnectionClosed();
    });
    await localService.close();
    await connectionClosed;
    // `connection.terminate:*` must precede `port.close`: the service
    // refuses new work, drops connections, then tears down the host.
    const terminateIndex = events.findIndex((event) =>
      event.startsWith("connection.terminate:"),
    );
    const portIndex = events.indexOf("port.close");
    expect(terminateIndex).toBeGreaterThanOrEqual(0);
    expect(portIndex).toBeGreaterThan(terminateIndex);
  });

  it("does not execute any handler after `close()` flips `accepting`", async () => {
    // A port whose `close()` blocks on a gate. The recording version
    // method observes whether `version()` is called from the registry
    // after `close()` has flipped `accepting`; the registry only calls
    // `port.version()` from the `version` operation handler. The test
    // counts `version()` calls: baseline + zero post-shutdown.
    let releaseCloseGate!: () => void;
    const closeGate = new Promise<void>((resolve) => {
      releaseCloseGate = resolve;
    });
    let versionCalls = 0;
    const recordingPort: WebuiHarnessPort = {
      version() {
        versionCalls += 1;
        return { version: "0.4.2-shutdown-gate", protocolVersion: 1 };
      },
      async listSessions() {
        return { sessions: [], hasMore: false };
      },
      async createSession() {
        return { sessionId: "shutdown" };
      },
      async getSession() {
        return { session: { sessionId: "shutdown" } };
      },
      async getMessages() {
        return { messages: [], hasMore: false };
      },
      async enqueueMessage() {
        return {
          itemId: "shutdown-gate-queued",
          status: "queued",
          position: 1,
        };
      },
      async close() {
        await closeGate;
      },
    };
    const localService = new WebuiService({ port: recordingPort });
    const localInfo = await localService.start();
    const url = `${localInfo.boundUrl}/?token=${encodeURIComponent(
      localInfo.credential.token,
    )}`;
    const { ws, upgrade } = openClient(url);
    await upgrade;
    // Baseline: registry answers one request, calls `port.version()`
    // exactly once.
    const baseline = await requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId: "req-baseline",
      operation: "version",
      body: undefined,
    });
    if (!isWebuiFrame(baseline) || baseline.kind !== "response")
      throw new Error("baseline request should have answered");
    const baselineCalls = versionCalls;

    // Flip `accepting` synchronously without awaiting the rest of
    // shutdown. The service's `close()` does this immediately so any
    // handler invocation after this point short-circuits with the
    // `shuttingDown` error frame.
    const closePromise = localService.close();
    // Yield a microtask so the synchronous parts of `close()` land.
    await Promise.resolve();

    // Capture the next frame the service writes. The service will
    // either refuse the in-flight request with `shuttingDown` (handler
    // ran with `accepting === false`) or the connection will be torn
    // down (handler did not run, the connection is gone). Either path
    // proves no further `port.version()` call.
    const nextFrame = new Promise<unknown>((resolve) => {
      const onMessage = (raw: RawData) => {
        ws.off("message", onMessage);
        resolve(JSON.parse(raw.toString("utf8")));
      };
      ws.on("message", onMessage);
    });
    const closed = awaitClose(ws);
    ws.send(
      JSON.stringify({
        protocolVersion: WEBUI_PROTOCOL_VERSION,
        kind: "request",
        requestId: "req-after-shutdown",
        operation: "version",
        body: undefined,
      }),
    );
    const result = await Promise.race([nextFrame, closed]);
    releaseCloseGate();
    await closePromise;
    // The crucial assertion: no operation handler ran after
    // `accepting === false`. Whether the service replied with a
    // `shuttingDown` error frame (handler short-circuited) or the
    // connection was torn down before the reply arrived (handler did
    // not even start), the version counter must not have advanced.
    expect(versionCalls).toBe(baselineCalls);
    // Distinguish between the frame outcome (the second request was
    // answered) and the close outcome (the connection died first). The
    // close event carries a numeric `code`; a frame carries a string
    // `code` in the WebUI envelope.
    if (typeof result === "object" && result && "kind" in result) {
      expect(isWebuiFrame(result)).toBe(true);
      if (!isWebuiFrame(result)) throw new Error("expected frame");
      expect(result.kind).toBe("error");
      expect(result.code).toBe(WebuiErrorCode.shuttingDown);
    } else {
      // Close event outcome: handler was prevented from running.
      expect(result).toMatchObject({ code: expect.any(Number) });
    }
  });
});

describe("WebUI assembly unconditionally forwards the quarantined startup policy (criterion 8)", () => {
  // This test pins the seam the assembly actually controls: the value of
  // `startupExecutionPolicy` that `createWebuiRuntimeHost` hands to the
  // harness factory on every boot. It does NOT prove that the harness
  // refrains from executing persisted jobs — that contract lives behind
  // `isLocalRuntimeStartupExecutionEnabled(options.startupExecutionPolicy)`
  // in `packages/local-runtime-v2/src/runtime.ts:831`, which gates the
  // background-runtime boot. Pinning the forwarded value here is the
  // WebUI's part of that joint contract; coverage for the harness's
  // gating lives in `packages/local-runtime-v2`.
  it("sets startupExecutionPolicy to 'quarantined' on every boot, including a second boot against the same dataDir", async () => {
    const { createWebuiRuntimeHost } =
      await import("../../src/server/index.js");
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "webui-c8-policy-"));
    const forwarded: Array<{ startupExecutionPolicy?: string }> = [];
    type FactoryOptions = {
      dataDir: string;
      startupExecutionPolicy?: string;
    };
    const stubFactory = async (options: FactoryOptions) => {
      forwarded.push({
        startupExecutionPolicy: options.startupExecutionPolicy,
      });
      return {
        apiHost: { close: async () => undefined },
        dataDir: options.dataDir,
      };
    };
    try {
      const first = await createWebuiRuntimeHost({
        dataDir,
        factory: stubFactory,
      });
      const second = await createWebuiRuntimeHost({
        dataDir,
        factory: stubFactory,
      });
      // Both boots forward the quarantined policy unconditionally. The
      // second boot here proves the value is not derived from "is there
      // state on disk?" but is the same constant the assembly applies to
      // any boot.
      expect(forwarded).toEqual([
        { startupExecutionPolicy: "quarantined" },
        { startupExecutionPolicy: "quarantined" },
      ]);
      expect(first.forwardedOptions.startupExecutionPolicy).toBe("quarantined");
      expect(second.forwardedOptions.startupExecutionPolicy).toBe(
        "quarantined",
      );
      await first.harnessPort.close();
      await second.harnessPort.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

// Avoid the unused-import lint when the test scope skips a scenario.
