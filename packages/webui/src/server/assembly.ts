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
  readonly forwardedOptions: CreateLocalRuntimeHostOptions;
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
  const forwardedOptions = {
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
  } as CreateLocalRuntimeHostOptions;
  const host = await factory(forwardedOptions);
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