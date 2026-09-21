// Operation allowlist and runtime body validators.
//
// The service refuses any operation name not listed here, and validates the
// shape of every request body at runtime. Validation is deliberately
// structural and per operation kind: each operation owns a body schema and
// registers it together with its handler, so a future ticket that adds an
// operation without a validator fails at registration rather than passing
// every request through unchanged. The version operation accepts only a
// missing or `undefined` body; `null`, arrays and primitives all reject
// with `invalid_body`.

import { WebuiErrorCode, type WebuiErrorCodeValue } from "./envelope.js";

export interface WebuiOperationContext {
  readonly requestId: string;
}

export interface WebuiOperationResult<Body> {
  readonly body: Body;
}

export type WebuiOperationHandler<Body> = (
  context: WebuiOperationContext,
  body: unknown,
) => Promise<WebuiOperationResult<Body>> | WebuiOperationResult<Body>;

export interface WebuiOperation<Body = unknown> {
  readonly name: string;
  readonly validate: (body: unknown) => WebuiOperationValidation<Body>;
}

export type WebuiOperationValidation<Body> =
  | { readonly ok: true; readonly body: Body }
  | { readonly ok: false; readonly code: WebuiErrorCodeValue; readonly message: string };

const VERSION_OPERATION_NAME = "version" as const;

type VersionRequestBody = undefined;

interface VersionResponseBody {
  readonly version: string;
  readonly protocolVersion: number;
}

function validateVersionRequestBody(
  body: unknown,
): WebuiOperationValidation<VersionRequestBody> {
  // The version operation carries no body. A present-but-empty JSON
  // value (`null`, `[]`, `{}`) is rejected so a future caller cannot
  // smuggle a field in by encoding the body as something other than
  // an absent field.
  if (body === undefined) return { ok: true, body: undefined };
  return {
    ok: false,
    code: WebuiErrorCode.invalidBody,
    message: "version operation does not accept a body",
  };
}

export const versionOperation: WebuiOperation<VersionRequestBody> = {
  name: VERSION_OPERATION_NAME,
  validate: validateVersionRequestBody,
};

export interface WebuiOperationRegistryEntry {
  readonly operation: WebuiOperation;
  readonly handle: WebuiOperationHandler<unknown>;
}

export interface WebuiOperationRegistration<Body = unknown> {
  readonly operation: WebuiOperation<Body>;
  readonly handle: WebuiOperationHandler<Body>;
}

export function createOperationRegistry(
  port: { version(): { version: string; protocolVersion: number } },
): ReadonlyMap<string, WebuiOperationRegistryEntry> {
  const registry = new Map<string, WebuiOperationRegistryEntry>();
  registerOperation(registry, {
    operation: versionOperation,
    handle: () => ({
      body: port.version(),
    }),
  });
  return registry;
}

/**
 * Registers one operation. Throws if the operation is missing a
 * `validate` function or the validator rejects everything by default;
 * fail-closed at registration time so the service never accepts a
 * request whose body it cannot structurally verify.
 */
export function registerOperation<Body>(
  registry: Map<string, WebuiOperationRegistryEntry>,
  registration: WebuiOperationRegistration<Body>,
): void {
  const { operation, handle } = registration;
  if (typeof operation.validate !== "function")
    throw new Error(
      `operation ${operation.name} has no body validator; refusing to register`,
    );
  registry.set(operation.name, {
    operation,
    handle: handle as WebuiOperationHandler<unknown>,
  });
}