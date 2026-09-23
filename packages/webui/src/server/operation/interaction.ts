import { WebuiErrorCode } from "../envelope.js";
import type { WebuiOperation, WebuiOperationValidation } from "../operation-contract.js";
import type {
  WebuiEnqueueMessageRequest,
  WebuiResumeSessionRequest,
  WebuiSendMessageRequest,
} from "../port.js";
import { validateSessionIdBody } from "./common.js";
import { SEND_MESSAGE_OPERATION_NAME, ENQUEUE_MESSAGE_OPERATION_NAME, RESUME_SESSION_OPERATION_NAME } from "./names.js";
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

function validateEnqueueMessageRequestBody(
  body: unknown,
): WebuiOperationValidation<WebuiEnqueueMessageRequest> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "enqueueMessage body must be an object",
    };
  const candidate = body as Record<string, unknown>;
  const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
  const content =
    typeof candidate.content === "string" ? candidate.content.trim() : "";
  if (!id || !content)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "enqueueMessage body requires non-empty id and content",
    };
  if (
    candidate.model !== undefined &&
    (candidate.model === null ||
      typeof candidate.model !== "object" ||
      Array.isArray(candidate.model))
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "model must be an object",
    };
  for (const key of ["clientRequestId", "clientIntent"] as const) {
    if (candidate[key] !== undefined && typeof candidate[key] !== "string")
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: `${key} must be a string`,
      };
  }
  return {
    ok: true,
    body: {
      id,
      content,
      ...(candidate.model === undefined
        ? {}
        : { model: candidate.model as Record<string, unknown> }),
      ...(candidate.clientRequestId === undefined
        ? {}
        : { clientRequestId: candidate.clientRequestId as string }),
      ...(candidate.clientIntent === undefined
        ? {}
        : { clientIntent: candidate.clientIntent as string }),
    },
  };
}

export const enqueueMessageOperation: WebuiOperation<
  WebuiEnqueueMessageRequest,
  import("../port.js").WebuiEnqueueMessageResult
> = {
  name: ENQUEUE_MESSAGE_OPERATION_NAME,
  validate: validateEnqueueMessageRequestBody,
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

export const resumeSessionOperation: WebuiOperation<WebuiResumeSessionRequest> =
  {
    name: RESUME_SESSION_OPERATION_NAME,
    validate: validateResumeSessionRequestBody,
  };
