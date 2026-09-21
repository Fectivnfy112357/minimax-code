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
//     `runtimeOwnerKind: 'cli'` / `capabilityProfile: 'cli'` pair.
//   * `packages/tui/src/runtime/lifecycle.ts:456-460` — the conditional
//     `startupExecutionPolicy: 'quarantined'`. The CLI applies it per
//     surface; ADR 0002 and assembly step 6 of `docs/webui-v1-scope.md`
//     require the WebUI to set it unconditionally.
//
// The factory is injectable so the assembly can be unit-tested without
// standing up the full host. The default is the real local-runtime-v2
// factory; tests inject a stub that records the options and reports
// the policy's observable effect without driving the host.

import {
  getDefaultLocalRuntimeConfig,
} from "@mavis/local-runtime-v2";
import type { CreateLocalRuntimeHostOptions } from "@mavis/local-runtime-v2/process-local";

import { createHarnessPortFromHost } from "./host.js";
import type { WebuiHarnessPort } from "./port.js";

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
  };
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
  readonly runtimeOwnerKind: "cli";
  readonly capabilityProfile: "cli";
  readonly runtimeMode: "clean";
  readonly startupExecutionPolicy: "quarantined";
  readonly capabilities: {
    readonly cliEmbedded: true;
    readonly questionnaireReply: true;
    readonly permissionPrompt: true;
    readonly elicitation: true;
  };
  readonly configGetter: typeof getDefaultLocalRuntimeConfig;
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
  /** Process-local data directory; never `~/.minimax`. */
  readonly dataDir: string;
  /** Build identity forwarded to the host for metric labels. */
  readonly appVersion?: string;
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
  const forwardedOptions: WebuiForwardedRuntimeHostOptions = {
    dataDir: options.dataDir,
    ...(options.appVersion !== undefined
      ? { appVersion: options.appVersion }
      : {}),
    runtimeOwnerKind: "cli",
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
    configGetter: getDefaultLocalRuntimeConfig,
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
  const host = await factory(
    forwardedOptions as unknown as CreateLocalRuntimeHostOptions,
  );
  const harnessPort = createHarnessPortFromHost(host);
  return { harnessPort, host, forwardedOptions };
}

/**
 * Default factory: dynamically imports the real local-runtime-v2 host
 * factory so the WebUI server bundle does not pull in the full harness
 * layer (the assembly runs the import at boot, not at bundle time).
 */
const defaultWebuiRuntimeHostFactory: WebuiRuntimeHostFactory = async (
  options,
) => {
  const { createLocalRuntimeHostV2 } = await import(
    "@mavis/local-runtime-v2"
  );
  return (await createLocalRuntimeHostV2(
    options,
  )) as unknown as WebuiAssembledHost;
};
