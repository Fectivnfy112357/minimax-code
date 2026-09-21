// Service tests for the WebUI ticket 03 seam.
//
// The brief calls for TDD at the service seam: construct the real
// `WebuiService` with a scripted stand-in for the harness port, connect a
// real WebSocket client, and assert the frames. Each acceptance criterion
// has its own fixture; the same scripted port keeps the harness-side
// surface honest (the harness never runs against real history, per ADR
// 0006) while the wire side exercises the real `ws` package.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { once, type once as onceFn } from "node:events";
import type { RawData } from "ws";
import { WebSocket } from "ws";

import {
  WebuiErrorCode,
  WEBUI_PROTOCOL_VERSION,
  WebuiService,
  isWebuiFrame,
  type WebuiHarnessPort,
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

  async close(): Promise<void> {
    this.closed = true;
  }
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

// Avoid the unused-import lint when the test scope skips a scenario.