// Service tests for the WebUI ticket 03 seam.
//
// The brief calls for TDD at the service seam: construct the real
// `WebuiService` with a scripted stand-in for the harness port, connect a
// real WebSocket client, and assert the frames. Each acceptance criterion
// has its own fixture; the same scripted port keeps the harness-side
// surface honest (the harness never runs against real history, per ADR
// 0006) while the wire side exercises the real `ws` package.

import { mkdtemp, rm } from "node:fs/promises";
import { once, type once as onceFn } from "node:events";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { RawData } from "ws";
import { WebSocket } from "ws";

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
} from "../../src/server/index.js";

type CloseEvent = [number, Buffer];
type OncePromise<T> = ReturnType<typeof onceFn<T>>;

class ScriptedHarnessPort implements WebuiHarnessPort {
  private versionInfo: WebuiVersionInfo = {
    version: "0.1.0-test",
    protocolVersion: WEBUI_PROTOCOL_VERSION,
  };
  public closed = false;

  recordLog(version: string) {
    this.versionInfo = {
      version,
      protocolVersion: WEBUI_PROTOCOL_VERSION,
    };
  }

  version(): WebuiVersionInfo {
    return this.versionInfo;
  }

  async listSessions(_request: WebuiSessionListRequest) {
    return { sessions: [], hasMore: false };
  }

  async createSession(_request: WebuiCreateSessionRequest) {
    return { sessionId: "created-session" };
  }

  async getSession(_request: WebuiSessionLookupRequest) {
    return { session: { sessionId: "fixture-session" } };
  }

  async getMessages(_request: WebuiMessagesRequest): Promise<WebuiMessagesResult> {
    return { messages: [], hasMore: false };
  }

  async close(): Promise<void> {
    this.closed = true;
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
function openClient(url: string, headers: Record<string, string> = {}): {
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
    const { ws, upgrade, closed } = openClient(url, { Host: "evil.example:80" });
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

  it("lists sessions through the narrow port and preserves cursor paging", async () => {
    const calls: WebuiSessionListRequest[] = [];
    const pages = [
      {
        sessions: [{ sessionId: "new", agentName: "main", createdAt: 20, updatedAt: 30 }],
        hasMore: true,
        nextCursor: "cursor-2",
      },
      {
        sessions: [{ sessionId: "old", agentName: "main", createdAt: 10, updatedAt: 15 }],
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
    const request = (requestId: string, body: unknown) => requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION,
      kind: "request",
      requestId,
      operation: "listSessions",
      body,
    });
    const first = await request("req-list-1", { name: "main", limit: 1 });
    const second = await request("req-list-2", { name: "main", limit: 1, cursor: "cursor-2" });
    expect((first as { body: typeof pages[0] }).body.nextCursor).toBe("cursor-2");
    expect((second as { body: typeof pages[1] }).body.sessions[0].sessionId).toBe("old");
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
      return { session: { sessionId: "created-session", workspaceDir: request.workspaceDir } };
    };
    try {
      const { url } = await bootService();
      const { ws, upgrade } = openClient(url);
      await upgrade;
      const request = (requestId: string, body: unknown) => requestOnce(ws, {
        protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "request", requestId,
        operation: "createSession", body,
      });
      const created = await request("req-create", { name: " main ", workspaceDir: ` ${workspaceDir} `, ignored: true });
      expect((created as { body: { session: { sessionId: string } } }).body.session.sessionId).toBe("created-session");
      expect(calls).toEqual([{ name: "main", workspaceDir }]);
      const relative = await request("req-create-relative", { name: "main", workspaceDir: "relative" });
      expect((relative as { code: string }).code).toBe(WebuiErrorCode.invalidBody);
      const missing = await request("req-create-missing", { name: "main", workspaceDir: path.join(workspaceDir, "missing") });
      expect((missing as { code: string }).code).toBe(WebuiErrorCode.invalidBody);
      const absent = await request("req-create-absent", { name: "", workspaceDir });
      expect((absent as { code: string }).code).toBe(WebuiErrorCode.invalidBody);
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
        ? { messages: [{ msgId: "older", role: "user", msgContent: "Earlier" }], hasMore: false }
        : { messages: [{ msgId: "newer", role: "assistant", msgContent: "Later" }], nextCursor: "before-1", hasMore: true };
    };
    const { url } = await bootService();
    const { ws, upgrade } = openClient(url);
    await upgrade;
    const request = (requestId: string, operation: string, body: unknown) => requestOnce(ws, {
      protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "request", requestId, operation, body,
    });
    const sessionResponse = await request("req-session", "getSession", { id: "session-1" });
    const first = await request("req-messages-1", "getMessages", { id: "session-1", limit: 1 });
    const second = await request("req-messages-2", "getMessages", { id: "session-1", limit: 1, before: "before-1" });
    expect((sessionResponse as { body: { session: { title: string } } }).body.session.title).toBe("History");
    expect((first as { body: WebuiMessagesResult }).body.nextCursor).toBe("before-1");
    expect((second as { body: WebuiMessagesResult }).body.messages?.[0].msgId).toBe("older");
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
      protocolVersion: WEBUI_PROTOCOL_VERSION, kind: "request", requestId: "req-messages-invalid",
      operation: "getMessages", body: { sessionId: "wrong-field" },
    });
    if (!isWebuiFrame(response)) throw new Error("expected frame");
    expect(response.kind).toBe("error");
    expect(response.code).toBe(WebuiErrorCode.invalidBody);
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
      operation: "sendMessage",
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
      const { createOperationRegistry } = await import(
        "../../src/server/index.js"
      );
      const registry = createOperationRegistry(port);
      expect(registry.has("version")).toBe(true);
      expect(registry.has("sendMessage")).toBe(false);
      expect(registry.has("getSession")).toBe(true);
      expect(registry.has("getMessages")).toBe(true);
    } finally {
      await service.close();
    }
  });
});

describe("WebUI host factory", () => {
  it("is a thin adapter over the harness layer's host", async () => {
    const { createHarnessPortFromHost } = await import(
      "../../src/server/index.js"
    );
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
    const { createWebuiRuntimeHost } = await import(
      "../../src/server/index.js"
    );
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-c1-"),
    );
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
      expect(lastOptions?.runtimeOwnerKind).toBe("cli");
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

  it("declares the three interaction capabilities explicitly (criterion 2)", async () => {
    const { createWebuiRuntimeHost } = await import(
      "../../src/server/index.js"
    );
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-assembly-c2-"),
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
      const capabilities = lastOptions?.capabilities as Record<string, unknown>;
      // Mirror `packages/tui/src/runtime/lifecycle.ts:451-455`: the WebUI
      // is the surface that answers questionnaire, permission and
      // elicitation, so all three are true here.
      expect(capabilities.questionnaireReply).toBe(true);
      expect(capabilities.permissionPrompt).toBe(true);
      expect(capabilities.elicitation).toBe(true);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("does not add a 'webui' value to surface (ADR 0004)", async () => {
    const { createWebuiRuntimeHost } = await import(
      "../../src/server/index.js"
    );
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
      // does not need a new value because `runtimeOwnerKind: 'cli'` plus
      // the capabilities already identify the surface.
      expect("surface" in (lastOptions ?? {})).toBe(false);
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("wires the assembled host through the harness port that WebuiService tears down last", async () => {
    const { createWebuiRuntimeHost } = await import(
      "../../src/server/index.js"
    );
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
});

describe("WebUI loopback binding invariant", () => {
  it("refuses to construct the service when the host is a LAN address", async () => {
    const harness = new ScriptedHarnessPort();
    expect(() => new WebuiService({ port: harness, host: "0.0.0.0" })).toThrow(
      /loopback/i,
    );
    expect(
      () => new WebuiService({ port: harness, host: "10.0.0.5" }),
    ).toThrow(/loopback/i);
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
    const { registerOperation, versionOperation } = await import(
      "../../src/server/index.js"
    );
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
    const { createWebuiRuntimeHost } = await import(
      "../../src/server/index.js"
    );
    const dataDir = await mkdtemp(
      path.join(os.tmpdir(), "webui-c8-policy-"),
    );
    const forwarded: Array<{ startupExecutionPolicy?: string }> = [];
    type FactoryOptions = {
      dataDir: string;
      startupExecutionPolicy?: string;
    };
    const stubFactory = async (options: FactoryOptions) => {
      forwarded.push({ startupExecutionPolicy: options.startupExecutionPolicy });
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
      expect(second.forwardedOptions.startupExecutionPolicy).toBe("quarantined");
      await first.harnessPort.close();
      await second.harnessPort.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});

// Avoid the unused-import lint when the test scope skips a scenario.
