// Verify the WebUI's runtime-environment resolver (runtime-environment.ts).
//
// The WebUI hosts the same harness the terminal client uses, but it has no
// compile-time knowledge of `region` / `buildEnv` — without `MAVIS_REGION`
// and `MAVIS_BUILD_ENV` in this process's environment, `getRuntimeRegion()`
// falls back to `en` and `getRuntimeBuildEnv()` falls back to `dev`. That
// points the content-safety gateway at `matrix-overseas-test.example.invalid`,
// a placeholder domain that does not resolve, so input review fails with
// `failureKind: "transport"` / `transportKind: "dns"` and the service's
// one failure policy blocks the turn — see `content-safety.service.ts:35`.
// The result the user sees is the user message plus a `messages-rewound`
// frame, with no assistant content ever produced.
//
// The installed CLI writes the same three variables before it builds the
// host (`packages/tui/src/cli/environment.ts:40-72`); the WebUI does not,
// which is the regression the assembly step 2 of `docs/webui-v1-scope.md`
// was meant to cover.
//
// ADR 0003 forbids importing the terminal client's reader, so this pins the
// WebUI's resolver against the same store layout the auth-context reader
// already uses (`<dataDir>/cli-auth/shared-projection.json` and
// `<dataDir>/cli-auth/<buildEnv>/<region>/`), with the explicit env vars
// winning over the store fallback. The resolver does not guess a scope
// when nothing can be resolved: it returns undefined and leaves the
// environment alone, so the pre-fix behaviour stands for any run that
// happens without a client-side login.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  configureWebuiRuntimeEnvironment,
  type WebuiRuntimeScope,
} from "../../src/server/runtime-environment.js";

const RUNTIME_ENV_KEYS = [
  "MAVIS_REGION",
  "MAVIS_BUILD_ENV",
  "__MAVIS_RUNTIME_MANAGED",
] as const;

let dataDir: string;
let snapshot: Record<string, string | undefined>;

function captureProcessEnv(): void {
  snapshot = {};
  for (const key of RUNTIME_ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
}

function restoreProcessEnv(): void {
  for (const key of RUNTIME_ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

function clearRuntimeEnv(): void {
  for (const key of RUNTIME_ENV_KEYS) delete process.env[key];
}

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Writes the `cli-auth/<buildEnv>/<region>` directory the client owns. */
function writeScope(buildEnv: string, region: string): void {
  const directory = path.join(dataDir, "cli-auth", buildEnv, region);
  writeJson(path.join(directory, "cli-auth.scope.json"), {
    version: 1,
    updatedAtMs: 1,
    region,
    buildEnv,
  });
}

/** Writes the record naming the scope the client last used. */
function writeProjection(buildEnv: string, region: string): void {
  writeJson(path.join(dataDir, "cli-auth", "shared-projection.json"), {
    version: 1,
    region,
    buildEnv,
    authFingerprint: "sha256:test",
    updatedAtMs: 1,
  });
}

function snapshotTarget(): Record<string, string | undefined> {
  const target: Record<string, string | undefined> = {};
  for (const key of RUNTIME_ENV_KEYS) target[key] = process.env[key];
  return target;
}

function expectedWriteEffect(
  scope: WebuiRuntimeScope | undefined,
): {
  MAVIS_REGION: string | undefined;
  MAVIS_BUILD_ENV: string | undefined;
  __MAVIS_RUNTIME_MANAGED: string | undefined;
} {
  if (!scope) {
    return {
      MAVIS_REGION: undefined,
      MAVIS_BUILD_ENV: undefined,
      __MAVIS_RUNTIME_MANAGED: undefined,
    };
  }
  return {
    MAVIS_REGION: scope.region,
    MAVIS_BUILD_ENV: scope.buildEnv,
    __MAVIS_RUNTIME_MANAGED: "1",
  };
}

beforeEach(() => {
  captureProcessEnv();
  clearRuntimeEnv();
  dataDir = mkdtempSync(path.join(os.tmpdir(), "webui-runtime-env-"));
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
  restoreProcessEnv();
});

describe("configureWebuiRuntimeEnvironment", () => {
  it("returns the projected scope and writes the three env vars", () => {
    writeScope("prod", "cn");
    writeProjection("prod", "cn");

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "projection",
    });
    expect(snapshotTarget()).toEqual(expectedWriteEffect(scope));
  });

  it("falls back to the first scoped directory when no projection exists", () => {
    writeScope("prod", "cn");

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "directory",
    });
    expect(snapshotTarget()).toEqual(expectedWriteEffect(scope));
  });

  it("does not guess when the store carries no resolvable scope", () => {
    // An empty data dir is exactly the pre-fix situation: the installed
    // client never logged in, so there is nothing to inherit.
    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toBeUndefined();
    expect(snapshotTarget()).toEqual(expectedWriteEffect(undefined));
  });

  it("lets an explicit MAVIS_REGION + MAVIS_BUILD_ENV win over the store", () => {
    writeScope("prod", "cn");
    writeProjection("prod", "cn");
    process.env.MAVIS_REGION = "en";
    process.env.MAVIS_BUILD_ENV = "staging";

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "en",
      buildEnv: "staging",
      source: "env",
    });
    expect(snapshotTarget()).toEqual(expectedWriteEffect(scope));
  });

  it("falls back to the store when only one of the two env vars is explicit", () => {
    // Mixed half-explicit input is exactly the case where two unrelated
    // resolution paths would disagree. The resolver treats explicit env as
    // complete or not at all, so a lone region falls back to the store.
    writeScope("prod", "cn");
    writeProjection("prod", "cn");
    process.env.MAVIS_REGION = "en";

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "projection",
    });
    expect(snapshotTarget()).toEqual(expectedWriteEffect(scope));
  });

  it("refuses an explicit env var whose value the harness would reject", () => {
    // The same validation the harness applies (config.ts:120-151) keeps
    // `getRuntimeRegion()` from ever returning `zz`. The resolver matches
    // it so an invalid literal cannot poison the runtime.
    writeScope("prod", "cn");
    writeProjection("prod", "cn");
    process.env.MAVIS_REGION = "zz";

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "projection",
    });
  });

  it("refuses a projection whose values are not in the harness's allow-list", () => {
    // A projection is whatever the client wrote. The resolver validates
    // before trusting it so a malformed store cannot set a bogus buildEnv.
    writeJson(path.join(dataDir, "cli-auth", "shared-projection.json"), {
      version: 1,
      region: "cn",
      buildEnv: "not-a-build-env",
    });

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toBeUndefined();
    expect(snapshotTarget()).toEqual(expectedWriteEffect(undefined));
  });

  it("does not clobber an explicit __MAVIS_RUNTIME_MANAGED=0", () => {
    writeScope("prod", "cn");
    writeProjection("prod", "cn");
    process.env.__MAVIS_RUNTIME_MANAGED = "0";

    const scope = configureWebuiRuntimeEnvironment({ dataDir });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "projection",
    });
    expect(process.env.__MAVIS_RUNTIME_MANAGED).toBe("0");
  });

  it("writes through an injectable target instead of process.env", () => {
    writeScope("prod", "cn");
    writeProjection("prod", "cn");

    const target: Record<string, string | undefined> = {};
    const scope = configureWebuiRuntimeEnvironment({ dataDir, target });

    expect(scope).toEqual({
      region: "cn",
      buildEnv: "prod",
      source: "projection",
    });
    expect(target.MAVIS_REGION).toBe("cn");
    expect(target.MAVIS_BUILD_ENV).toBe("prod");
    expect(target.__MAVIS_RUNTIME_MANAGED).toBe("1");
    // The injected target must not leak into process.env — the runtime
    // host reads from process.env via getRuntimeRegion / getRuntimeBuildEnv.
    expect(process.env.MAVIS_REGION).toBeUndefined();
    expect(process.env.MAVIS_BUILD_ENV).toBeUndefined();
    expect(process.env.__MAVIS_RUNTIME_MANAGED).toBeUndefined();
  });

  it("leaves process.env alone when nothing is resolvable and nothing is explicit", () => {
    // The pre-fix behaviour: en / dev defaults, isManagedRuntime()=false.
    // The resolver is conservative: it does not invent a scope.
    configureWebuiRuntimeEnvironment({ dataDir });

    expect(process.env.MAVIS_REGION).toBeUndefined();
    expect(process.env.MAVIS_BUILD_ENV).toBeUndefined();
    expect(process.env.__MAVIS_RUNTIME_MANAGED).toBeUndefined();
  });
});