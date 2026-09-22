// Structural type shim for `@mavis/oauth-core`, mirroring the pattern of
// `mcode-tools-host.d.ts`: the workspace package publishes `dist` types that
// a source checkout does not build, so type-checking against the module
// needs local declarations for the subset the WebUI actually uses. The
// runtime module resolves through `tsconfig.standalone.json` (tsx dev
// server) and the workspace-sources esbuild plugin (bundle) — both map the
// package export to `src/`.
//
// Keep this file in sync with `packages/oauth-core/src/index.ts`; it is a
// deliberate structural subset (ADR 0003 also keeps the WebUI off the
// terminal client's wrapper `createMcodeSharedAuthSession` — the WebUI
// composes the oauth-core primitives itself).
declare module "@mavis/oauth-core" {
  export interface MCodeOAuthNamespaceContext {
    readonly buildEnv: "dev" | "test" | "staging" | "prod";
    readonly region: "cn" | "en";
  }

  export interface MCodeOAuthNamespaceInput extends MCodeOAuthNamespaceContext {
    readonly dataDir: string;
  }

  export interface MCodeAuthNamespace {
    readonly namespaceHome: string;
  }

  export const MCODE_OAUTH_SCOPES: readonly ["agent.default"];

  export function createAuthNamespace(
    input: MCodeOAuthNamespaceInput,
  ): MCodeAuthNamespace;

  export function migrateLegacyAuthNamespace(
    namespace: MCodeAuthNamespace,
  ): Promise<void>;

  export function createCredentialStore(options: {
    readonly authHome: string;
  }): unknown;

  export function resolveMCodeOAuthEndpointConfig(
    environment: Record<string, string | undefined>,
    context: MCodeOAuthNamespaceContext,
  ): unknown;

  export class HttpOAuthClient {
    constructor(options: unknown);
  }

  export interface MCodeAccessTokenLease {
    readonly accessToken: string;
    readonly expiresAtMs: number;
    readonly generation: number;
    readonly scopes: readonly ["agent.default"];
    readonly audience: "agent-backend";
  }

  export class MCodeOAuthCore {
    constructor(options: {
      readonly namespace: unknown;
      readonly credentialStore: unknown;
      readonly oauthClient: unknown;
      readonly initialize?: () => unknown;
    });
    getAccessToken(options: {
      readonly requiredScopes: typeof MCODE_OAUTH_SCOPES;
      readonly minValidityMs: number;
    }): Promise<MCodeAccessTokenLease>;
  }
}
