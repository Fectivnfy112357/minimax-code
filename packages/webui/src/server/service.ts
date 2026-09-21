// WebUI service: owns a runtime host, binds loopback, runs the wire
// envelope with access control, and shuts down in order.
//
// This is the seam ticket 03 ships. It composes:
//   * a harness port (real: script of the host's `CliService` facade;
//     test: scripted stand-in),
//   * a per-start credential,
//   * the operation registry built from the port,
//   * the access control rules described in ADR 0004.
//
// Shutdown order matches step 13 of the assembly checklist: stop accepting
// new operations, then close every connection, then close the harness.

import { createServer, type IncomingMessage, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";

import {
  createOperationRegistry,
  type WebuiOperationRegistryEntry,
} from "./operations.js";
import {
  createWebuiCredential,
  credentialMatches,
  type WebuiCredential,
} from "./credentials.js";
import {
  isWebuiFrame,
  WebuiErrorCode,
  WEBUI_PROTOCOL_VERSION,
  type WebuiErrorFrame,
  type WebuiEventFrame,
  type WebuiResponseFrame,
} from "./envelope.js";
import type { WebuiHarnessPort } from "./port.js";

export const WEBUI_MAX_MESSAGE_BYTES = 256 * 1024;
const WEBUI_CLOSE_GRACE_MS = 1000;

/**
 * Truthy env-var spellings that turn the development mode on. Anything that
 * is not on this list is ignored, so `WEBUI_DEV=0` / `WEBUI_DEV=false` /
 * unset all leave production semantics intact.
 */
function readEnvFlag(name: string): boolean {
  const raw = process.env[name];
  if (!raw) return false;
  const trimmed = raw.trim().toLowerCase();
  return (
    trimmed === "1" ||
    trimmed === "true" ||
    trimmed === "yes" ||
    trimmed === "on"
  );
}

export interface WebuiServiceOptions {
  readonly port: WebuiHarnessPort;
  /** Defaults to the protocol version the wire envelope ships. */
  readonly protocolVersion?: number;
  /**
   * Loopback host the service binds to. The service refuses to start
   * when this is anything other than `127.0.0.1`, `localhost`, `::1` or
   * `[::1]`; remote or LAN access requires a separate decision (ADR
   * 0004), not a different bind address. Defaults to `127.0.0.1`.
   */
  readonly host?: string;
  /** TCP port; `0` asks the OS for a free port. Defaults to `0`. */
  readonly tcpPort?: number;
  /** Maximum WebSocket message size in bytes. */
  readonly maxMessageBytes?: number;
  /** Optional credential override; tests supply one to assert its shape. */
  readonly credential?: WebuiCredential;
  /** Optional server factory; tests inject an HTTP server without listening. */
  readonly httpServerFactory?: () => Server;
  /**
   * Development mode: when `true`, the HTTP and WebSocket paths do not
   * require a credential so a developer can open the served page in a
   * plain browser without scraping a per-start token out of the log.
   * Host and Origin discipline stay intact (ADR 0004). Default mode keeps
   * today's per-start credential requirement.
   *
   * The env var `WEBUI_DEV=1` (also accepts `true`/`yes`/`on`) turns it
   * on for the lifecycle of the process — there is no path that flips
   * it back to off without restarting the service, so a misconfigured
   * environment cannot be widened by accident. The option wins over the
   * env var so tests can pin the boot mode without touching the
   * environment.
   */
  readonly dev?: boolean;
  /**
   * Override the directory the service reads `index.html`, `client.js`
   * and `styles.css` from. Tests inject the built-artifact path
   * (`dist-webui/client`) so they can assert the assets the served page
   * references load without inventing tokens; the dev preview launcher
   * uses it to point at the same path. When unset the service picks the
   * first existing candidate under `findClientDirectory()`.
   */
  readonly clientDir?: string;
}

export interface WebuiServiceInfo {
  readonly host: string;
  readonly tcpPort: number;
  readonly protocolVersion: typeof WEBUI_PROTOCOL_VERSION;
  readonly credential: WebuiCredential;
  readonly boundUrl: string;
}

export class WebuiService {
  private readonly port: WebuiHarnessPort;
  private readonly host: string;
  private readonly tcpPort: number;
  private readonly maxMessageBytes: number;
  private readonly credential: WebuiCredential;
  private readonly protocolVersion: number;
  private readonly dev: boolean;
  private readonly clientDirOverride: string | undefined;
  private readonly operations: ReadonlyMap<string, WebuiOperationRegistryEntry>;
  private readonly httpServer: Server;
  private readonly wsServer: WebSocketServer;
  private readonly connections = new Set<WebSocket>();
  private readonly connectionSignals = new Map<WebSocket, AbortController>();
  private accepting = true;
  private startedPromise: Promise<WebuiServiceInfo> | undefined;
  private bound: { info: WebuiServiceInfo } | undefined;

  constructor(options: WebuiServiceOptions) {
    this.port = options.port;
    this.host = options.host ?? "127.0.0.1";
    if (!isLoopbackBindAddress(this.host))
      throw new Error(
        `WebUI service may only bind to a loopback address; received ${JSON.stringify(this.host)}`,
      );
    this.tcpPort = options.tcpPort ?? 0;
    this.maxMessageBytes = options.maxMessageBytes ?? WEBUI_MAX_MESSAGE_BYTES;
    this.credential = options.credential ?? createWebuiCredential();
    this.protocolVersion = options.protocolVersion ?? WEBUI_PROTOCOL_VERSION;
    // The option is the source of truth for tests; the env var is the
    // convenience for the dev preview launcher. The option must win
    // when both are set so a test that pins `dev: false` cannot be
    // widened by a stray `WEBUI_DEV=1` in the environment.
    this.dev = options.dev ?? readEnvFlag("WEBUI_DEV");
    this.clientDirOverride = options.clientDir;
    this.operations = createOperationRegistry({
      version: () => ({
        version: this.port.version().version,
        protocolVersion: this.port.version().protocolVersion,
      }),
      listSessions: (request) => this.port.listSessions(request),
      createSession: (request) => this.port.createSession(request),
      getSession: (request) => this.port.getSession(request),
      getMessages: (request) => this.port.getMessages(request),
      sendMessage: (request, signal) => this.port.sendMessage(request, signal),
      enqueueMessage: (request) => this.port.enqueueMessage(request),
      resumeSession: (request, signal) =>
        this.port.resumeSession(request, signal),
      watchEvents: (signal) => this.port.watchEvents(signal),
      listPendingPermissions: () => this.port.listPendingPermissions(),
      getPendingQuestionnaire: (request) =>
        this.port.getPendingQuestionnaire(request),
      replyPermission: (request) => this.port.replyPermission(request),
      replyQuestionnaire: (request) => this.port.replyQuestionnaire(request),
      dismissQuestionnaire: (request) =>
        this.port.dismissQuestionnaire(request),
      abortSession: (request) => this.port.abortSession(request),
      listQueueMessages: (request) => this.port.listQueueMessages(request),
      deleteQueueItem: (request) => this.port.deleteQueueItem(request),
      listModels: (request) => this.port.listModels(request),
      selectModel: (request) => this.port.selectModel(request),
      getSessionUsage: (request) => this.port.getSessionUsage(request),
      getAccountStatus: (request) => this.port.getAccountStatus(request),
    });
    const factory = options.httpServerFactory ?? (() => createServer());
    this.httpServer = factory();
    this.wsServer = new WebSocketServer({
      noServer: true,
      maxPayload: this.maxMessageBytes,
    });
    this.httpServer.on("upgrade", this.#onUpgrade);
    this.httpServer.on("request", this.#onRequest);
    this.wsServer.on("connection", this.#onConnection);
  }

  #onRequest = (
    request: IncomingMessage,
    response: import("node:http").ServerResponse,
  ): void => {
    void this.#serveClient(request, response);
  };

  async #serveClient(
    request: IncomingMessage,
    response: import("node:http").ServerResponse,
  ): Promise<void> {
    const requestHost = (request.headers.host ?? "").toLowerCase();
    const requestOrigin = (request.headers.origin ?? "").toLowerCase();
    if (!requestHost || !isLoopbackHost(requestHost.split(":")[0] ?? "")) {
      rejectHttp(response, 403, "Forbidden Host");
      return;
    }
    if (
      requestOrigin &&
      !isAllowedOrigin(requestOrigin, this.host, this.bound?.info.tcpPort)
    ) {
      rejectHttp(response, 403, "Forbidden Origin");
      return;
    }
    const url = parseHttpUrl(request.url);
    const presented = url?.searchParams.get("token");
    if (!this.dev && !credentialMatches(this.credential, presented)) {
      rejectHttp(response, 401, "Unauthorized");
      return;
    }
    if (request.method !== "GET" || !url) {
      rejectHttp(response, 404, "Not Found");
      return;
    }
    const name =
      url.pathname === "/" || url.pathname === "/index.html"
        ? "index.html"
        : url.pathname === "/client.js"
          ? "client.js"
          : url.pathname === "/styles.css"
            ? "styles.css"
            : undefined;
    if (!name) {
      rejectHttp(response, 404, "Not Found");
      return;
    }
    try {
      const clientDir = findClientDirectory(this.clientDirOverride);
      let body = await readFile(path.join(clientDir, name), "utf8");
      if (name === "index.html") {
        const config = JSON.stringify({
          websocketUrl: `ws://${this.host}:${this.bound?.info.tcpPort ?? this.tcpPort}`,
          token: this.credential.token,
        }).replace(/</gu, "\\u003c");
        body = body.replace(
          "</head>",
          `<script>window.__WEBUI_CONFIG__=${config};</script></head>`,
        );
      }
      response.writeHead(200, {
        "Content-Type": contentType(name),
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      rejectHttp(response, 404, "Not Found");
    }
  }

  /**
   * Bind the server and resolve once it is listening. Resolves with the
   * address the kernel actually allocated so tests can reach it.
   */
  start(): Promise<WebuiServiceInfo> {
    if (this.startedPromise) return this.startedPromise;
    this.startedPromise = new Promise<WebuiServiceInfo>((resolve, reject) => {
      const onError = (error: Error) => {
        this.httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        this.httpServer.off("error", onError);
        try {
          const address = this.httpServer.address();
          if (!address || typeof address === "string")
            throw new Error("WebUI service bound to a non-TCP socket");
          const tcpPort = (address as AddressInfo).port;
          const info: WebuiServiceInfo = {
            host: this.host,
            tcpPort,
            protocolVersion: WEBUI_PROTOCOL_VERSION,
            credential: this.credential,
            boundUrl: `ws://${this.host}:${tcpPort}`,
          };
          this.bound = { info };
          resolve(info);
        } catch (error) {
          reject(error);
        }
      };
      this.httpServer.once("error", onError);
      this.httpServer.once("listening", onListening);
      this.httpServer.listen(this.tcpPort, this.host);
    });
    return this.startedPromise;
  }

  info(): WebuiServiceInfo {
    if (!this.bound) throw new Error("WebUI service is not started");
    return this.bound.info;
  }

  /**
   * Stop accepting new operations, drain every connection, then close
   * the harness port. The order is the one step 13 of the assembly
   * checklist requires: refuse new work first, then release resources,
   * then tear down the host.
   */
  async close(): Promise<void> {
    if (!this.accepting && !this.bound) return;
    this.accepting = false;
    // Force-terminate every connection before the server closes; otherwise
    // `wsServer.close()` waits for the client to ack the close handshake
    // and can hang for the duration of the platform TCP timeout.
    for (const connection of this.connections) {
      this.connectionSignals.get(connection)?.abort();
      try {
        connection.terminate();
      } catch {
        // ignore: the connection is already torn down.
      }
    }
    this.connections.clear();
    this.connectionSignals.clear();
    await new Promise<void>((resolve) => {
      this.wsServer.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      this.httpServer.close(() => resolve());
    });
    await this.port.close();
  }

  #onUpgrade = (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    if (!this.accepting) {
      socket.write(
        "HTTP/1.1 503 Service Unavailable\r\n" +
          "Connection: close\r\n" +
          "\r\n",
      );
      socket.destroy();
      return;
    }
    const url = parseWebSocketUrl(request.url);
    if (!url) {
      rejectUpgrade(socket, 400, "Bad Request");
      return;
    }
    const urlHost = url.hostname.toLowerCase();
    const requestHost = (request.headers.host ?? "").toLowerCase();
    const requestOrigin = (request.headers.origin ?? "").toLowerCase();
    if (!requestHost || !isLoopbackHost(requestHost.split(":")[0] ?? "")) {
      rejectUpgrade(socket, 403, "Forbidden Host");
      return;
    }
    if (urlHost !== "127.0.0.1" && urlHost !== "localhost") {
      rejectUpgrade(socket, 403, "Forbidden Host");
      return;
    }
    if (
      requestOrigin &&
      !isAllowedOrigin(requestOrigin, this.host, this.bound?.info.tcpPort)
    ) {
      rejectUpgrade(socket, 403, "Forbidden Origin");
      return;
    }
    const presented = url.searchParams.get("token");
    if (!this.dev && !credentialMatches(this.credential, presented)) {
      rejectUpgrade(socket, 401, "Unauthorized");
      return;
    }
    this.wsServer.handleUpgrade(request, socket, head, (ws) => {
      this.wsServer.emit("connection", ws, request);
    });
  };

  #onConnection = (ws: WebSocket): void => {
    if (!this.accepting) {
      ws.close(1001, "service shutting down");
      return;
    }
    this.connections.add(ws);
    const connectionController = new AbortController();
    this.connectionSignals.set(ws, connectionController);
    ws.on("close", () => {
      this.connections.delete(ws);
      connectionController.abort();
      this.connectionSignals.delete(ws);
    });
    ws.on("error", () => {
      this.connections.delete(ws);
      connectionController.abort();
      this.connectionSignals.delete(ws);
    });
    ws.on("message", (raw, isBinary) => {
      void this.#handleMessage(ws, raw, isBinary);
    });
  };

  async #handleMessage(
    ws: WebSocket,
    raw: import("ws").RawData,
    isBinary: boolean,
  ): Promise<void> {
    if (isBinary) {
      sendFrame(
        ws,
        errorFrame(
          "anonymous",
          WebuiErrorCode.invalidEnvelope,
          "binary frames are not accepted",
        ),
      );
      return;
    }
    const text = raw.toString("utf8");
    if (Buffer.byteLength(text, "utf8") > this.maxMessageBytes) {
      sendFrame(
        ws,
        errorFrame(
          "anonymous",
          WebuiErrorCode.payloadTooLarge,
          "frame exceeds the message size limit",
        ),
      );
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      sendFrame(
        ws,
        errorFrame(
          "anonymous",
          WebuiErrorCode.invalidEnvelope,
          "frame is not valid JSON",
        ),
      );
      return;
    }
    if (!isWebuiFrame(parsed)) {
      sendFrame(
        ws,
        errorFrame(
          "anonymous",
          WebuiErrorCode.protocolMismatch,
          "frame does not match the WebUI envelope",
        ),
      );
      return;
    }
    if (parsed.kind !== "request") {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.invalidEnvelope,
          "servers do not accept client non-request frames",
        ),
      );
      return;
    }
    if (!this.accepting) {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.shuttingDown,
          "service is shutting down",
        ),
      );
      return;
    }
    const entry = this.operations.get(parsed.operation);
    if (!entry) {
      sendFrame(
        ws,
        errorFrame(
          parsed.requestId,
          WebuiErrorCode.unknownOperation,
          `unknown operation: ${parsed.operation}`,
        ),
      );
      return;
    }
    const validated = entry.operation.validate(parsed.body);
    if (!validated.ok) {
      sendFrame(
        ws,
        errorFrame(parsed.requestId, validated.code, validated.message),
      );
      return;
    }
    try {
      const result = await entry.handle(
        {
          requestId: parsed.requestId,
          signal: this.connectionSignals.get(ws)?.signal,
        },
        validated.body,
      );
      if ("stream" in result) {
        if (!result.stream.ok) {
          sendFrame(
            ws,
            errorFrame(
              parsed.requestId,
              result.stream.body.key ?? WebuiErrorCode.harnessError,
              result.stream.body.message,
            ),
          );
          return;
        }
        const iterator = toAsyncIterator(
          result.stream.source as AsyncIterable<unknown> | Iterable<unknown>,
        );
        const signal = this.connectionSignals.get(ws)?.signal;
        const close = () => void iterator.return?.();
        signal?.addEventListener("abort", close, { once: true });
        try {
          while (!signal?.aborted) {
            const next = await iterator.next();
            if (next.done || signal?.aborted) break;
            sendFrame(ws, eventFrame(parsed.requestId, next.value));
          }
        } finally {
          signal?.removeEventListener("abort", close);
          await iterator.return?.();
        }
        return;
      }
      sendFrame(ws, responseFrame(parsed.requestId, result.body));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendFrame(
        ws,
        errorFrame(parsed.requestId, WebuiErrorCode.harnessError, message),
      );
    }
  }
}

function toAsyncIterator<T>(
  source: AsyncIterable<T> | Iterable<T>,
): AsyncIterator<T> {
  if (Symbol.asyncIterator in source) return source[Symbol.asyncIterator]();
  const iterator = source[Symbol.iterator]();
  return {
    next: () => Promise.resolve(iterator.next()),
    return: (value?: unknown) =>
      Promise.resolve(iterator.return?.(value) ?? { done: true, value }),
  };
}

function sendFrame(
  ws: WebSocket,
  frame: WebuiResponseFrame | WebuiErrorFrame | WebuiEventFrame,
) {
  if (ws.readyState !== ws.OPEN) return;
  ws.send(JSON.stringify(frame));
}

function eventFrame(requestId: string, body: unknown): WebuiEventFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "event",
    requestId,
    body,
  };
}

function responseFrame(requestId: string, body: unknown): WebuiResponseFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "response",
    requestId,
    body,
  };
}

function errorFrame(
  requestId: string,
  code: string,
  message: string,
): WebuiErrorFrame {
  return {
    protocolVersion: WEBUI_PROTOCOL_VERSION,
    kind: "error",
    requestId,
    code,
    message,
  };
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  const reasonLine = reason.replace(/[\r\n]/gu, " ");
  socket.write(`HTTP/1.1 ${status} ${reasonLine}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

function rejectHttp(
  response: import("node:http").ServerResponse,
  status: number,
  reason: string,
): void {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    Connection: "close",
  });
  response.end(reason);
}

function parseHttpUrl(rawUrl: string | undefined): URL | undefined {
  if (!rawUrl) return undefined;
  try {
    return new URL(rawUrl, "http://127.0.0.1");
  } catch {
    return undefined;
  }
}

function contentType(name: string): string {
  return name.endsWith(".css")
    ? "text/css; charset=utf-8"
    : name.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
}

function findClientDirectory(override: string | undefined): string {
  // Caller-supplied override wins so tests pin the served directory and the
  // dev preview launcher can point at the built artifacts; if it does not
  // exist we fall back to the discovery below rather than 404 the page.
  if (override && existsSync(override)) return override;
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../client"),
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../dist-webui/client",
    ),
  ];
  // The built server uses the first path; source tests and development use the second.
  return (
    candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]!
  );
}

function parseWebSocketUrl(rawUrl: string | undefined): URL | undefined {
  if (!rawUrl) return undefined;
  try {
    const base = "ws://127.0.0.1";
    return new URL(rawUrl, base);
  } catch {
    return undefined;
  }
}

function isLoopbackHost(host: string): boolean {
  return (
    host === "127.0.0.1" ||
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]"
  );
}

function isLoopbackBindAddress(host: string): boolean {
  // The service binds loopback only. `0.0.0.0` and any LAN address are
  // rejected before the HTTP server is constructed so the misconfiguration
  // surfaces at boot, not at the first upgrade.
  if (isLoopbackHost(host)) return true;
  // IPv6 zone IDs (`fe80::1%lo0`, `::1%1`) are loopback-shaped for the
  // purpose of the bind; strip the zone before re-checking.
  const stripped = host.split("%")[0] ?? host;
  return isLoopbackHost(stripped);
}

function isAllowedOrigin(origin: string, host: string, port?: number): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  const protocol = parsed.protocol.toLowerCase();
  if (protocol !== "http:" && protocol !== "https:") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "127.0.0.1" && hostname !== "localhost") return false;
  if (port === undefined) return true;
  const portNumber = parsed.port
    ? Number(parsed.port)
    : defaultPortForProtocol(protocol);
  return portNumber === port && parsed.hostname === host;
}

function defaultPortForProtocol(protocol: string): number {
  return protocol === "https:" ? 443 : 80;
}

// Used by integration tests; not part of the public API.
export const __testingCloseGraceMs = WEBUI_CLOSE_GRACE_MS;
