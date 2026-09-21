// Operation allowlist and runtime body validators.
//
// The service refuses any operation name not listed here, and validates the
// shape of every request body at runtime. Validation is deliberately
// structural: the version operation accepts no body, so the validator rejects
// anything other than `undefined` / a missing field. Later tickets add
// operations with their own schemas.

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
  if (body === undefined || body === null) return { ok: true, body: undefined };
  if (typeof body !== "object")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "version operation does not accept a body",
    };
  if (Object.keys(body as Record<string, unknown>).length > 0)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "version operation does not accept body fields",
    };
  return { ok: true, body: undefined };
}

export const versionOperation: WebuiOperation<VersionRequestBody> = {
  name: VERSION_OPERATION_NAME,
  validate: validateVersionRequestBody,
};

export interface WebuiOperationRegistryEntry {
  readonly operation: WebuiOperation;
  readonly handle: WebuiOperationHandler<unknown>;
}

export function createOperationRegistry(
  port: { version(): { version: string; protocolVersion: number } },
): ReadonlyMap<string, WebuiOperationRegistryEntry> {
  const registry = new Map<string, WebuiOperationRegistryEntry>();
  registry.set(versionOperation.name, {
    operation: versionOperation,
    handle: () => ({
      body: port.version(),
    }),
  });
  return registry;
}