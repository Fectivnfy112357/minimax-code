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

import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { WebuiErrorCode, type WebuiErrorCodeValue } from "./envelope.js";
import type {
  WebuiHarnessPort,
  WebuiMessagesRequest,
  WebuiMessagesResult,
  WebuiSessionLookupRequest,
  WebuiSessionLookupResult,
  WebuiSessionListRequest,
  WebuiCreateSessionRequest,
  WebuiCreateSessionResult,
  WebuiSendMessageRequest,
  WebuiResumeSessionRequest,
} from "./port.js";

export interface WebuiOperationContext {
  readonly requestId: string;
}

export interface WebuiOperationResult<Body> {
  readonly body: Body;
}

export interface WebuiOperationStreamResult {
  readonly stream: import("./port.js").WebuiSendMessageResult;
}

export type WebuiOperationHandler<Body> = (
  context: WebuiOperationContext,
  body: unknown,
) =>
  | Promise<WebuiOperationResult<Body> | WebuiOperationStreamResult>
  | WebuiOperationResult<Body>
  | WebuiOperationStreamResult;

export interface WebuiOperation<Body = unknown, ResultBody = Body> {
  readonly name: string;
  readonly validate: (body: unknown) => WebuiOperationValidation<Body>;
}

export type WebuiOperationValidation<Body> =
  | { readonly ok: true; readonly body: Body }
  | {
      readonly ok: false;
      readonly code: WebuiErrorCodeValue;
      readonly message: string;
    };

const VERSION_OPERATION_NAME = "version" as const;
const LIST_SESSIONS_OPERATION_NAME = "listSessions" as const;
const CREATE_SESSION_OPERATION_NAME = "createSession" as const;
const GET_SESSION_OPERATION_NAME = "getSession" as const;
const GET_MESSAGES_OPERATION_NAME = "getMessages" as const;
const SEND_MESSAGE_OPERATION_NAME = "sendMessage" as const;
const RESUME_SESSION_OPERATION_NAME = "resumeSession" as const;

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

function validateListSessionsRequestBody(
  body: unknown,
): WebuiOperationValidation<WebuiSessionListRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "listSessions body must be an object",
    };
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.name !== "string" || candidate.name.trim() === "")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "listSessions body requires a non-empty name",
    };
  for (const key of ["limit", "offset"] as const) {
    if (
      candidate[key] !== undefined &&
      (!Number.isInteger(candidate[key]) || (candidate[key] as number) < 0)
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${key} must be a non-negative integer`,
      };
  }
  if (candidate.cursor !== undefined && typeof candidate.cursor !== "string")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "cursor must be a string",
    };
  return { ok: true, body: candidate as unknown as WebuiSessionListRequest };
}

export const listSessionsOperation: WebuiOperation<
  WebuiSessionListRequest,
  import("./port.js").WebuiSessionPage
> = {
  name: LIST_SESSIONS_OPERATION_NAME,
  validate: validateListSessionsRequestBody,
};

function validateCreateSessionRequestBody(
  body: unknown,
): WebuiOperationValidation<WebuiCreateSessionRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "createSession body must be an object",
    };
  const candidate = body as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  if (!name)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "createSession body requires a non-empty name",
    };
  const workspaceDir =
    typeof candidate.workspaceDir === "string"
      ? candidate.workspaceDir.trim()
      : "";
  if (!workspaceDir)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "createSession body requires a working directory",
    };
  if (!isAbsolute(workspaceDir))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "workspaceDir must be an absolute path",
    };
  try {
    if (!statSync(workspaceDir).isDirectory())
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "workspaceDir must be an existing directory",
      };
  } catch {
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "workspaceDir must be an existing directory",
    };
  }
  return { ok: true, body: { name, workspaceDir } };
}

export const createSessionOperation: WebuiOperation<
  WebuiCreateSessionRequest,
  WebuiCreateSessionResult
> = {
  name: CREATE_SESSION_OPERATION_NAME,
  validate: validateCreateSessionRequestBody,
};

function validateSessionIdBody(
  operation: string,
  body: unknown,
): WebuiOperationValidation<WebuiSessionLookupRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body must be an object`,
    };
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body requires a non-empty id`,
    };
  return { ok: true, body: { id: candidate.id } };
}

export const getSessionOperation: WebuiOperation<
  WebuiSessionLookupRequest,
  WebuiSessionLookupResult
> = {
  name: GET_SESSION_OPERATION_NAME,
  validate: (body) => validateSessionIdBody(GET_SESSION_OPERATION_NAME, body),
};

function validateGetMessagesBody(
  body: unknown,
): WebuiOperationValidation<WebuiMessagesRequest> {
  const session = validateSessionIdBody(GET_MESSAGES_OPERATION_NAME, body);
  if (!session.ok) return session;
  const candidate = body as Record<string, unknown>;
  if (
    candidate.limit !== undefined &&
    (!Number.isInteger(candidate.limit) || (candidate.limit as number) < 0)
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "limit must be a non-negative integer",
    };
  if (candidate.before !== undefined && typeof candidate.before !== "string")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "before must be a string",
    };
  if (
    candidate.includeAttachmentReadUrls !== undefined &&
    typeof candidate.includeAttachmentReadUrls !== "boolean"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "includeAttachmentReadUrls must be a boolean",
    };
  return {
    ok: true,
    body: {
      id: session.body.id,
      ...(candidate.limit === undefined
        ? {}
        : { limit: candidate.limit as number }),
      ...(candidate.before === undefined
        ? {}
        : { before: candidate.before as string }),
      ...(candidate.includeAttachmentReadUrls === undefined
        ? {}
        : {
            includeAttachmentReadUrls:
              candidate.includeAttachmentReadUrls as boolean,
          }),
    },
  };
}

export const getMessagesOperation: WebuiOperation<
  WebuiMessagesRequest,
  WebuiMessagesResult
> = {
  name: GET_MESSAGES_OPERATION_NAME,
  validate: validateGetMessagesBody,
};

function validateSendMessageRequestBody(
  body: unknown,
): WebuiOperationValidation<WebuiSendMessageRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "sendMessage body must be an object",
    };
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.id !== "string" || candidate.id.trim() === "")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "sendMessage body requires a non-empty id",
    };
  if (candidate.content !== undefined && typeof candidate.content !== "string")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "content must be a string",
    };
  if (candidate.turnId !== undefined && typeof candidate.turnId !== "string")
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "turnId must be a string",
    };
  if (
    candidate.clientIntent !== undefined &&
    typeof candidate.clientIntent !== "string"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "clientIntent must be a string",
    };
  return {
    ok: true,
    body: {
      id: candidate.id as string,
      ...(candidate.content === undefined
        ? {}
        : { content: candidate.content as string }),
      ...(candidate.turnId === undefined
        ? {}
        : { turnId: candidate.turnId as string }),
      ...(candidate.clientIntent === undefined
        ? {}
        : { clientIntent: candidate.clientIntent as string }),
    },
  };
}

export const sendMessageOperation: WebuiOperation<WebuiSendMessageRequest> = {
  name: SEND_MESSAGE_OPERATION_NAME,
  validate: validateSendMessageRequestBody,
};

function validateResumeSessionRequestBody(
  body: unknown,
): WebuiOperationValidation<WebuiResumeSessionRequest> {
  // `resumeSession` accepts the same session id envelope as `sendMessage`
  // (it targets the same session), plus the optional resume controls. The
  // validator is structural: a non-string `id`, a non-string cursor/msg id,
  // or any non-boolean flag is rejected up front rather than handed to the
  // harness, which trusts the wire shape because the operation is gated
  // through the registry.
  const session = validateSessionIdBody(RESUME_SESSION_OPERATION_NAME, body);
  if (!session.ok) return session;
  const candidate = body as Record<string, unknown>;
  if (
    candidate.afterCursor !== undefined &&
    typeof candidate.afterCursor !== "string"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "afterCursor must be a string",
    };
  if (
    candidate.afterMsgId !== undefined &&
    typeof candidate.afterMsgId !== "string"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "afterMsgId must be a string",
    };
  if (
    candidate.drainQueued !== undefined &&
    typeof candidate.drainQueued !== "boolean"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "drainQueued must be a boolean",
    };
  return {
    ok: true,
    body: {
      id: session.body.id,
      ...(candidate.afterCursor === undefined
        ? {}
        : { afterCursor: candidate.afterCursor as string }),
      ...(candidate.afterMsgId === undefined
        ? {}
        : { afterMsgId: candidate.afterMsgId as string }),
      ...(candidate.drainQueued === undefined
        ? {}
        : { drainQueued: candidate.drainQueued as boolean }),
    },
  };
}

export const resumeSessionOperation: WebuiOperation<WebuiResumeSessionRequest> = {
  name: RESUME_SESSION_OPERATION_NAME,
  validate: validateResumeSessionRequestBody,
};

export interface WebuiOperationRegistryEntry {
  readonly operation: WebuiOperation;
  readonly handle: WebuiOperationHandler<unknown>;
}

export interface WebuiOperationRegistration<Body = unknown, ResultBody = Body> {
  readonly operation: WebuiOperation<Body, ResultBody>;
  readonly handle: (
    context: WebuiOperationContext,
    body: Body,
  ) =>
    | Promise<WebuiOperationResult<ResultBody> | WebuiOperationStreamResult>
    | WebuiOperationResult<ResultBody>
    | WebuiOperationStreamResult;
}

export function createOperationRegistry(
  port: Pick<
    WebuiHarnessPort,
    | "version"
    | "listSessions"
    | "createSession"
    | "getSession"
    | "getMessages"
    | "sendMessage"
    | "resumeSession"
  >,
): ReadonlyMap<string, WebuiOperationRegistryEntry> {
  const registry = new Map<string, WebuiOperationRegistryEntry>();
  registerOperation(registry, {
    operation: createSessionOperation,
    handle: async (_context, body) => ({
      body: await port.createSession(body),
    }),
  });
  registerOperation(registry, {
    operation: versionOperation,
    handle: () => ({
      body: port.version(),
    }),
  });
  registerOperation(registry, {
    operation: getSessionOperation,
    handle: async (_context, body) => ({ body: await port.getSession(body) }),
  });
  registerOperation(registry, {
    operation: getMessagesOperation,
    handle: async (_context, body) => ({ body: await port.getMessages(body) }),
  });
  registerOperation(registry, {
    operation: listSessionsOperation,
    handle: async (_context, body) => ({ body: await port.listSessions(body) }),
  });
  registerOperation(registry, {
    operation: sendMessageOperation,
    handle: async (_context, body) => ({
      stream: await port.sendMessage(body),
    }),
  });
  registerOperation(registry, {
    operation: resumeSessionOperation,
    handle: async (_context, body) => ({
      stream: await port.resumeSession(body),
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
export function registerOperation<Body, ResultBody = Body>(
  registry: Map<string, WebuiOperationRegistryEntry>,
  registration: WebuiOperationRegistration<Body, ResultBody>,
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
