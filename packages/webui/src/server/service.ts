// WebUI service: owns a runtime host, binds loopback, runs the wire
// envelope with access control, and shuts down in order.
//
// This is the server seam. It composes:
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
} from "./operation/operations.js";
import {
  createWebuiCredential,
  credentialMatches,
  type WebuiCredential,
} from "./credentials.js";
import {
  dispatchWebuiFrame,
  errorFrame,
  sendFrame,
} from "./operation/operation-dispatch.js";
import {
  WebuiErrorCode,
  WEBUI_PROTOCOL_VERSION,
} from "./envelope.js";
import type { WebuiHarnessPort } from "./port.js";
import { WebuiTerminalManager } from "./terminal.js";

export const WEBUI_MAX_MESSAGE_BYTES = 256 * 1024;

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
  private readonly terminalManager = new WebuiTerminalManager();
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
      getSessionTree: (request) => this.port.getSessionTree(request),
      archiveSession: (request) => this.port.archiveSession(request),
      deleteSession: (request) => this.port.deleteSession(request),
      updateSession: (request) => this.port.updateSession(request),
      getSessionForkOptions: (request) => this.port.getSessionForkOptions(request),
      forkSession: (request) => this.port.forkSession(request),
      createSession: (request) => this.port.createSession(request),
      getSession: (request) => this.port.getSession(request),
      getMessages: (request) => this.port.getMessages(request),
      getSessionDiff: (request) => this.port.getSessionDiff?.(request) ?? Promise.reject(new Error("session diff is unavailable")),
      getTurnDiff: (request) => this.port.getTurnDiff?.(request) ?? Promise.reject(new Error("turn diff is unavailable")),
      revertTurnDiff: (request) => this.port.revertTurnDiff?.(request) ?? Promise.reject(new Error("turn diff revert is unavailable")),
      reapplyTurnDiff: (request) => this.port.reapplyTurnDiff?.(request) ?? Promise.reject(new Error("turn diff reapply is unavailable")),
      getSessionRewindPreview: (request) => this.port.getSessionRewindPreview?.(request) ?? Promise.reject(new Error("session rewind preview is unavailable")),
      rewindSession: (request) => this.port.rewindSession?.(request) ?? Promise.reject(new Error("session rewind is unavailable")),
      editSessionMessage: (request) => this.port.editSessionMessage?.(request) ?? Promise.reject(new Error("message editing is unavailable")),
      isGoalEnabled: () => this.port.isGoalEnabled?.() ?? Promise.reject(new Error("goal is unavailable")),
      getGoal: (request) => this.port.getGoal?.(request) ?? Promise.reject(new Error("goal is unavailable")),
      createGoal: (request) => this.port.createGoal?.(request) ?? Promise.reject(new Error("goal is unavailable")),
      patchGoal: (request) => this.port.patchGoal?.(request) ?? Promise.reject(new Error("goal is unavailable")),
      clearGoal: (request) => this.port.clearGoal?.(request) ?? Promise.reject(new Error("goal is unavailable")),
      listWorkspaceFileTree: (request) => this.port.listWorkspaceFileTree?.(request) ?? Promise.reject(new Error("workspace file tree is unavailable")),
      readWorkspaceFile: (request) => this.port.readWorkspaceFile?.(request) ?? Promise.reject(new Error("workspace file reads are unavailable")),
      getWorkspaceEnvironment: (request) => this.port.getWorkspaceEnvironment?.(request) ?? Promise.reject(new Error("workspace environment is unavailable")),
      mutateWorkspaceGit: (request) => this.port.mutateWorkspaceGit?.(request) ?? Promise.reject(new Error("workspace git mutations are unavailable")),
      readCanvas: (request) => this.port.readCanvas?.(request) ?? Promise.reject(new Error("canvas is unavailable")),
      applyCanvas: (request) => this.port.applyCanvas?.(request) ?? Promise.reject(new Error("canvas is unavailable")),
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
      listSkills: (request) => this.port.listSkills(request),
      getSessionUsage: (request) => this.port.getSessionUsage(request),
      getUsageQuota: (request) => this.port.getUsageQuota(request),
      getSigninPanel: () => this.port.getSigninPanel(),
      claimSignin: () => this.port.claimSignin(),
      getAccountStatus: (request) => this.port.getAccountStatus(request),
      listUserModelProviders: () => this.port.listUserModelProviders(),
      createUserModelProvider: (request) => this.port.createUserModelProvider(request),
      updateUserModelProvider: (request) => this.port.updateUserModelProvider(request),
      deleteUserModelProvider: (providerId) => this.port.deleteUserModelProvider(providerId),
      testUserModelProvider: (providerId) => this.port.testUserModelProvider(providerId),
      testUserModel: (request) => this.port.testUserModel(request),
      discoverUserModelsCandidate: (request) => this.port.discoverUserModelsCandidate(request),
      saveUserModelProviderCandidate: (request) => this.port.saveUserModelProviderCandidate(request),
      listProviderPresets: () => this.port.listProviderPresets(),
      getMiniMaxApiKeyStatus: () => this.port.getMiniMaxApiKeyStatus(),
      upsertMiniMaxApiKey: (request) => this.port.upsertMiniMaxApiKey(request),
      getCodexOAuthStatus: () => this.port.getCodexOAuthStatus(),
      requestCompaction: (request) => this.port.requestCompaction(request),
      invalidateAuth: this.port.invalidateAuth,
    }, this.terminalManager);
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
      url.pathname === "/" ||
      url.pathname === "/index.html" ||
      url.pathname === "/login" ||
      url.pathname === "/onboarding" ||
      url.pathname === "/archon"
        ? "index.html"
        : url.pathname === "/client.js"
          ? "client.js"
          : url.pathname === "/styles.css"
          ? "styles.css"
          : url.pathname.startsWith("/assets/") || url.pathname.startsWith("/fonts/")
            ? url.pathname.slice(1)
          : undefined;
    if (!name) {
      rejectHttp(response, 404, "Not Found");
      return;
    }
    try {
      const clientDir = findClientDirectory(this.clientDirOverride);
      const fileName = resolveClientAsset(clientDir, url.pathname, name);
      if (!fileName) {
        rejectHttp(response, 404, "Not Found");
        return;
      }
      let body = await readFile(fileName);
      if (name === "index.html") {
        const config = JSON.stringify({
          websocketUrl: `ws://${this.host}:${this.bound?.info.tcpPort ?? this.tcpPort}`,
          token: this.credential.token,
          dataDir: this.port.version().dataDir,
        }).replace(/</gu, "\\u003c");
        body = Buffer.from(body.toString("utf8").replace(
          "</head>",
          `<script>window.__WEBUI_CONFIG__=${config};</script></head>`,
        ));
      }
      response.writeHead(200, {
        "Content-Type": contentType(fileName),
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
    this.terminalManager.disposeBySession();
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
    await dispatchWebuiFrame(
      ws,
      parsed,
      this.operations,
      this.accepting,
      () => this.connectionSignals.get(ws)?.signal,
    );
  }
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
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".jpg") || name.endsWith(".jpeg")) return "image/jpeg";
  if (name.endsWith(".woff2")) return "font/woff2";
  if (name.endsWith(".woff")) return "font/woff";
  if (name.endsWith(".ttf")) return "font/ttf";
  return name.endsWith(".css")
    ? "text/css; charset=utf-8"
    : name.endsWith(".js")
      ? "text/javascript; charset=utf-8"
      : "text/html; charset=utf-8";
}

function resolveClientAsset(
  clientDir: string,
  pathname: string,
  fallbackName: string,
): string | undefined {
  if (fallbackName === "index.html" || fallbackName === "client.js" || fallbackName === "styles.css")
    return path.join(clientDir, fallbackName);
  const prefix = pathname.startsWith("/assets/")
    ? "/assets/"
    : pathname.startsWith("/fonts/")
      ? "/fonts/"
      : undefined;
  if (!prefix) return undefined;
  const relativeName = pathname.slice(prefix.length);
  if (!relativeName || relativeName.includes("\\") || relativeName.split("/").includes(".."))
    return undefined;
  const candidate = path.resolve(clientDir, prefix.slice(1), relativeName);
  const root = path.resolve(clientDir) + path.sep;
  return candidate.startsWith(root) ? candidate : undefined;
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
