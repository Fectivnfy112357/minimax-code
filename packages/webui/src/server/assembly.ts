// Owns one process-local runtime host per WebUI service.
//
// The WebUI does not import `packages/tui` (ADR 0003), and does not drive the
// CLI binary (ADR 0001); it builds directly on the harness layer the terminal
// client uses (`@mavis/local-runtime-v2`). The assembly mirrors the
// documented call sites:
//
//   * `packages/tui/src/runtime/embedded-host.ts` — the surface owner, mode
//     and capability projection (lines 85–93).
//   * `packages/local-runtime-v2/src/services.test.ts:1998` — the
//     `runtimeOwnerKind: 'tui'` / `capabilityProfile: 'cli'` pair.
//   * `packages/tui/src/runtime/lifecycle.ts:456-460` — the conditional
//     `startupExecutionPolicy: 'quarantined'`. The CLI applies it per
//     surface; ADR 0002 and assembly step 6 of `docs/webui-v1-scope.md`
//     require the WebUI to set it unconditionally.
//
// The factory is injectable so the assembly can be unit-tested without
// standing up the full host. The default is the real local-runtime-v2
// factory; tests inject a stub that records the options and reports
// the policy's observable effect without driving the host.

import { getDefaultLocalRuntimeConfig } from "@mavis/local-runtime-v2";
import type { CreateLocalRuntimeHostOptions } from "@mavis/local-runtime-v2/process-local";

import {
  createWebuiAuthContextReader,
  type WebuiAuthContext,
} from "./auth-context.js";
import { createHarnessPortFromHost } from "./host.js";
import type { WebuiHarnessPort } from "./port.js";
import { configureWebuiRuntimeEnvironment } from "./runtime-environment.js";
import {
  createWebuiAuthLeaseSession,
  prepareWebuiMcodeToolsIntegration,
  type WebuiMcodeToolsIntegrationDependencies,
  type WebuiMcodeToolsReadiness,
} from "./mcode-tools.js";

/**
 * Minimal host contract the assembly needs from whatever factory
 * produces it. The shape matches what
 * `createLocalRuntimeHostV2` returns (its `apiHost.close()` plus
 * `dataDir`); `appVersion` is optional because the v2 host does not
 * echo the input option back.
 */
export interface WebuiAssembledHost {
  readonly apiHost: { close(): Promise<void> };
  readonly dataDir: string;
  readonly appVersion?: string;
  readonly cliService?: {
    listSessions(
      request: import("./port.js").WebuiSessionListRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiSessionPage>;
    createSession(
      request: import("./port.js").WebuiCreateSessionRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiCreateSessionResult>;
    getSession(
      request: import("./port.js").WebuiSessionLookupRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiSessionLookupResult>;
    getMessages(
      request: import("./port.js").WebuiMessagesRequest,
      context?: Record<string, never>,
    ): Promise<import("./port.js").WebuiMessagesResult>;
    sendMessage(
      request: import("./port.js").WebuiSendMessageRequest,
      context?: { readonly signal?: AbortSignal },
    ): Promise<import("./port.js").WebuiSendMessageResult>;
    enqueueMessage(
      request: import("./port.js").WebuiEnqueueMessageRequest,
      context?: { readonly signal?: AbortSignal },
    ): Promise<import("./port.js").WebuiEnqueueMessageResult>;
    resumeSession(
      request: import("./port.js").WebuiResumeSessionRequest,
      context?: { readonly signal?: AbortSignal },
    ): Promise<import("./port.js").WebuiStreamResult>;
    watchEvents(
      signal?: AbortSignal,
    ): AsyncIterable<import("./port.js").WebuiRuntimeEvent>;
    listPendingPermissions(): Promise<{
      readonly requests: readonly import("./port.js").WebuiPendingPermission[];
    }>;
    getPendingQuestionnaire(request: {
      readonly name: string;
      readonly sessionId: string;
    }): Promise<{
      readonly request?: import("./port.js").WebuiQuestionnaireRequest;
    }>;
    replyPermission(request: {
      readonly name: string;
      readonly requestId: string;
      readonly reply: number;
    }): Promise<import("./port.js").WebuiInteractionReplyResult>;
    replyQuestionnaire(request: {
      readonly name: string;
      readonly requestId: string;
      readonly schemaVersion: number;
      readonly answers: readonly import("./port.js").WebuiQuestionnaireAnswer[];
    }): Promise<import("./port.js").WebuiInteractionReplyResult>;
    dismissQuestionnaire(request: {
      readonly name: string;
      readonly requestId: string;
    }): Promise<import("./port.js").WebuiInteractionReplyResult>;
    abortSession(request: {
      readonly id: string;
    }): Promise<{ readonly success?: boolean }>;
    listQueueMessages(request: { readonly id: string }): Promise<{
      readonly items?: readonly import("./port.js").WebuiQueueItem[];
      readonly paused?: boolean;
      readonly pendingCount?: number;
    }>;
    deleteQueueItem(request: {
      readonly id: string;
      readonly itemId: string;
    }): Promise<{ readonly item?: import("./port.js").WebuiQueueItem }>;
    listModels(request?: {
      readonly sessionId?: string;
    }): Promise<readonly import("./port.js").WebuiModelEntry[]>;
    selectModel(request: {
      readonly providerId: string;
      readonly modelId: string;
      readonly variant?: string;
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

export type WebuiBrowserToolExposure = "compact" | "full" | "both";

export interface WebuiBrowserAdapter {
  readonly getCapabilities?: () => unknown;
  readonly disposeSession?: (sessionId: string) => Promise<void>;
  execute(
    context: unknown,
    action: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown>;
}

export interface WebuiBrowserProvider {
  readonly adapter: WebuiBrowserAdapter;
  close(): void | Promise<void>;
}

/**
 * Structural shape of the options the WebUI assembly forwards to the
 * harness factory. Mirrors the relevant fields of
 * `CreateLocalRuntimeHostOptions` (declared in
 * `packages/local-runtime/src/runtime/host-factory-types.ts:103` and
 * extended by `packages/local-runtime-v2/src/local/host-contract.ts:56`).
 *
 * Defining the type locally lets the assembly type-check against the
 * real field set without depending on the harness package's exported
 * type, whose transitive imports (vendored pi-mono) collapse in this
 * repo's typecheck (see the v7 brief's item 3). The factory signature
 * still uses the upstream type so production wiring is unchanged.
 */
export interface WebuiForwardedRuntimeHostOptions {
  readonly dataDir: string;
  readonly appVersion?: string;
  readonly runtimeOwnerKind: "cli" | "tui";
  readonly capabilityProfile: "cli";
  readonly runtimeMode: "clean";
  readonly startupExecutionPolicy: "quarantined";
  readonly capabilities: {
    readonly cliEmbedded: true;
    readonly questionnaireReply: true;
    readonly permissionPrompt: true;
    readonly elicitation: true;
  };
  readonly enableLiveMcp: true;
  readonly configGetter: () => ReturnType<typeof getDefaultLocalRuntimeConfig>;
  /**
   * Assembly step 3 of `docs/webui-v1-scope.md`. Managed MiniMax login sends no
   * API key — the credential is an OAuth access token — so the runtime resolves
   * it through this pair, and the harness defaults both to undefined when they
   * are absent. Absent them, every turn on a managed provider fails at the
   * agent preflight with "managed OAuth bearer is not synced".
   */
  readonly authContextGetter: () => WebuiAuthContext | undefined;
  readonly authContextInvalidator: (
    rejectedAccessToken?: string,
    loginEpoch?: string,
  ) => void;
  readonly browserAdapter?: WebuiBrowserAdapter;
  readonly browserToolExposure?: WebuiBrowserToolExposure;
}

/**
 * Factory signature the assembly delegates to. The default is
 * `createLocalRuntimeHostV2`; tests inject a stub that records the
 * options it received.
 */
export type WebuiRuntimeHostFactory = (
  options: CreateLocalRuntimeHostOptions,
) => Promise<WebuiAssembledHost>;

export interface CreateWebuiRuntimeHostOptions {
  /**
   * The CLI data directory (`~/.minimax` by default), shared per ADR 0006 and
   * assembly step 1 of `docs/webui-v1-scope.md`. It carries the login state,
   * the provider configuration and the session history the WebUI shows, so a
   * run that needs a clean slate has to opt into `MINIMAX_DATA_DIR` instead.
   */
  readonly dataDir: string;
  /** Build identity forwarded to the host for metric labels. */
  readonly appVersion?: string;
  /** Browser provider explicitly owned by the WebUI process, when enabled. */
  readonly browserProvider?: WebuiBrowserProvider;
  readonly browserToolExposure?: WebuiBrowserToolExposure;
  /** Defaults to the configured beta switch, but the effective runtime value is readiness-gated. */
  readonly mcodeToolsRequested?: boolean;
  readonly mcodeTools?: {
    readonly prepare?: (
      options: Parameters<typeof prepareWebuiMcodeToolsIntegration>[0],
      dependencies?: WebuiMcodeToolsIntegrationDependencies,
    ) => Promise<WebuiMcodeToolsReadiness>;
  };
  /**
   * Factory override; defaults to `createLocalRuntimeHostV2`. Tests
   * inject a stub; production callers leave it untouched.
   */
  readonly factory?: WebuiRuntimeHostFactory;
}

export interface WebuiRuntimeHost {
  readonly harnessPort: WebuiHarnessPort;
  /** The host the assembly produced; tests inspect it directly. */
  readonly host: WebuiAssembledHost;
  /** The exact options the assembly forwarded to the factory. */
  readonly forwardedOptions: WebuiForwardedRuntimeHostOptions;
  readonly mcodeTools: WebuiMcodeToolsReadiness;
  readonly invalidateAuth: () => void;
}

/**
 * Boots one process-local runtime host with the assembly step 6 owner
 * combination and the unconditionally quarantined cold-start policy.
 * Returns a `WebuiHarnessPort` the `WebuiService` can tear down in
 * the order step 13 of `docs/webui-v1-scope.md` requires.
 */
export async function createWebuiRuntimeHost(
  options: CreateWebuiRuntimeHostOptions,
): Promise<WebuiRuntimeHost> {
  const factory = options.factory ?? defaultWebuiRuntimeHostFactory;
  // The account credential is read from the same directory the installed
  // client uses, so a browser session never has to sign in again. See
  // `auth-context.ts` for the store's layout and the deliberate differences
  // from the terminal client's reader.
  const authContext = createWebuiAuthContextReader(options.dataDir);
  // Reflect the installed client's scope into this process's environment
  // before the host is built, so `getRuntimeRegion()` /
  // `getRuntimeBuildEnv()` / `isManagedRuntime()` see the same scope the
  // credential reader served. The CLI does this for itself
  // (`packages/tui/src/cli/environment.ts:40-72`); the WebUI has to do
  // its own because ADR 0003 forbids importing that module. The resolver
  // is a no-op when the store carries nothing and nothing is explicit in
  // the environment, so a WebUI start without a client-side login still
  // falls back to the harness defaults — `en` / `dev`,
  // `isManagedRuntime()=false` — exactly as before this step existed.
  const baseConfig = getDefaultLocalRuntimeConfig();
  const scope = configureWebuiRuntimeEnvironment({ dataDir: options.dataDir });
  const requestedMcodeTools =
    options.mcodeToolsRequested ?? baseConfig.beta?.mcodeTools === true;
  const mcodeTools = await (
    options.mcodeTools?.prepare ?? prepareWebuiMcodeToolsIntegration
  )({
    requested: requestedMcodeTools,
    dataDir: options.dataDir,
    buildEnv: (scope?.buildEnv ?? process.env.MAVIS_BUILD_ENV ?? "dev") as
      "dev" | "test" | "staging" | "prod",
    region: (scope?.region ?? process.env.MAVIS_REGION ?? "en") as "cn" | "en",
    session: createWebuiAuthLeaseSession(
      authContext.getter,
      authContext.invalidator,
    ),
    entryUrl: import.meta.url,
  });
  const forwardedOptions: WebuiForwardedRuntimeHostOptions = {
    dataDir: options.dataDir,
    ...(options.appVersion !== undefined
      ? { appVersion: options.appVersion }
      : {}),
    runtimeOwnerKind: "tui",
    capabilityProfile: "cli",
    runtimeMode: "clean",
    startupExecutionPolicy: "quarantined",
    // Interaction capabilities mirror `packages/tui/src/runtime/lifecycle.ts:451-455`:
    // the WebUI is the surface that answers the questionnaire, permission
    // prompt and elicitation, so all three are unconditionally true here.
    // Adding a `webui` value to `surface` is out of scope per ADR 0004 and
    // assembly step 4 of `docs/webui-v1-scope.md`.
    capabilities: {
      cliEmbedded: true,
      questionnaireReply: true,
      permissionPrompt: true,
      elicitation: true,
    },
    enableLiveMcp: true,
    configGetter: () => ({
      ...baseConfig,
      beta: {
        ...baseConfig.beta,
        mcodeTools: mcodeTools.ready,
        browserUseTooling: options.browserProvider !== undefined,
      },
    }),
    authContextGetter: authContext.getter,
    authContextInvalidator: authContext.invalidator,
    ...(options.browserProvider
      ? { browserAdapter: options.browserProvider.adapter }
      : {}),
    ...(options.browserToolExposure
      ? { browserToolExposure: options.browserToolExposure }
      : {}),
  };
  // The factory parameter is `CreateLocalRuntimeHostOptions`, but in this
  // typecheck the upstream type collapses to `{}` (no keys) because the
  // transitive import chain through `@mavis/local-runtime-v2` →
  // `@mavis/local-runtime` → `@mavis/agent-core` → `@earendil-works/pi-*`
  // fails to resolve — the vendored pi-mono packages ship no `dist/` and
  // there is no workspace build script that emits one (see the v7 brief's
  // item 3). The forwarded fields are correct against the source type
  // (`runtimeOwnerKind` / `capabilityProfile` / `runtimeMode` /
  // `startupExecutionPolicy` / `capabilities` all live in
  // `packages/local-runtime/src/runtime/host-factory-types.ts:32-47`); the
  // cast below is narrowly scoped to the factory boundary and exists only
  // because the typecheck can't see the upstream shape.
  let host: WebuiAssembledHost;
  try {
    host = await factory(
      forwardedOptions as unknown as CreateLocalRuntimeHostOptions,
    );
  } catch (error) {
    // The factory is allowed to fail before it returns an apiHost.  The
    // capability owners were already acquired above, so release them on this
    // path as well; otherwise a broker socket or Browser profile survives a
    // failed WebUI start and contaminates the next attempt.
    const failures: unknown[] = [error];
    try {
      await mcodeTools.dispose();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    try {
      await options.browserProvider?.close();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "WebUI runtime startup failed");
  }
  const runtimeClose = host.apiHost.close.bind(host.apiHost);
  let closed = false;
  host.apiHost.close = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    try {
      await runtimeClose();
    } catch (error) {
      failures.push(error);
    }
    try {
      await mcodeTools.dispose();
    } catch (error) {
      failures.push(error);
    }
    try {
      await options.browserProvider?.close();
    } catch (error) {
      failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1)
      throw new AggregateError(failures, "WebUI runtime shutdown failed");
  };
  try {
    mcodeTools.ensureCommandPath();
  } catch (error) {
    const failures: unknown[] = [error];
    try {
      // `apiHost.close` is already wrapped above and therefore closes the
      // runtime followed by both capability owners exactly once.
      await host.apiHost.close();
    } catch (cleanupError) {
      failures.push(cleanupError);
    }
    if (failures.length === 1) throw failures[0];
    throw new AggregateError(failures, "WebUI runtime startup failed");
  }
  const harnessPort = createHarnessPortFromHost({
    ...host,
    invalidateAuth: authContext.invalidator,
  });
  return {
    harnessPort,
    host,
    forwardedOptions,
    mcodeTools,
    invalidateAuth: authContext.invalidator,
  };
}

/**
 * Default factory: dynamically imports the real local-runtime-v2 host
 * factory so the WebUI server bundle does not pull in the full harness
 * layer (the assembly runs the import at boot, not at bundle time).
 */
const defaultWebuiRuntimeHostFactory: WebuiRuntimeHostFactory = async (
  options,
) => {
  const { createLocalRuntimeHostV2 } = await import("@mavis/local-runtime-v2");
  return (await createLocalRuntimeHostV2(
    options,
  )) as unknown as WebuiAssembledHost;
};
