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
  WebuiEnqueueMessageRequest,
  WebuiResumeSessionRequest,
  WebuiPermissionDecision,
  WebuiQuestionnaireAnswer,
} from "./port.js";
import { runWebuiCommand } from "./commands/runner.js";
import {
  projectContextSnapshot,
  projectSessionStream,
  projectUsage,
} from "./projections/index.js";

export interface WebuiOperationContext {
  readonly requestId: string;
  readonly signal?: AbortSignal;
}

export interface WebuiOperationResult<Body> {
  readonly body: Body;
}

export interface WebuiOperationStreamResult {
  readonly stream:
    | import("./port.js").WebuiSendMessageResult
    | import("./port.js").WebuiWatchEventsResult;
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
const ENQUEUE_MESSAGE_OPERATION_NAME = "enqueueMessage" as const;
const RESUME_SESSION_OPERATION_NAME = "resumeSession" as const;
const WATCH_EVENTS_OPERATION_NAME = "watchEvents" as const;
const LIST_PENDING_PERMISSIONS_OPERATION_NAME =
  "listPendingPermissions" as const;
const GET_PENDING_QUESTIONNAIRE_OPERATION_NAME =
  "getPendingQuestionnaire" as const;
const REPLY_PERMISSION_OPERATION_NAME = "replyPermission" as const;
const REPLY_QUESTIONNAIRE_OPERATION_NAME = "replyQuestionnaire" as const;
const DISMISS_QUESTIONNAIRE_OPERATION_NAME = "dismissQuestionnaire" as const;
const ABORT_SESSION_OPERATION_NAME = "abortSession" as const;
const LIST_QUEUE_MESSAGES_OPERATION_NAME = "listQueueMessages" as const;
const DELETE_QUEUE_ITEM_OPERATION_NAME = "deleteQueueItem" as const;
const LIST_MODELS_OPERATION_NAME = "listModels" as const;
const SELECT_MODEL_OPERATION_NAME = "selectModel" as const;
const LIST_SKILLS_OPERATION_NAME = "listSkills" as const;
const GET_SESSION_USAGE_OPERATION_NAME = "getSessionUsage" as const;
const GET_USAGE_QUOTA_OPERATION_NAME = "getUsageQuota" as const;
const GET_SIGNIN_PANEL_OPERATION_NAME = "getSigninPanel" as const;
const CLAIM_SIGNIN_OPERATION_NAME = "claimSignin" as const;
const GET_ACCOUNT_STATUS_OPERATION_NAME = "getAccountStatus" as const;
const RUN_COMMAND_OPERATION_NAME = "runCommand" as const;
const SIGN_OUT_OPERATION_NAME = "signOut" as const;

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
  // `workspaceDir` is optional: the harness resolves a default workspace
  // when it is absent (desktop's 不需要项目 / default-directory flows).
  // When present it must be a real absolute path — relative and missing
  // directories are still rejected.
  const workspaceDir =
    typeof candidate.workspaceDir === "string"
      ? candidate.workspaceDir.trim()
      : "";
  if (candidate.workspaceDir !== undefined && !workspaceDir)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "createSession workspaceDir must not be empty",
    };
  if (workspaceDir && !isAbsolute(workspaceDir))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "workspaceDir must be an absolute path",
    };
  try {
    if (workspaceDir && !statSync(workspaceDir).isDirectory())
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
  if (
    candidate.teamModeOff !== undefined &&
    typeof candidate.teamModeOff !== "boolean"
  )
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: "teamModeOff must be a boolean",
    };
  return {
    ok: true,
    body: {
      name,
      // Absent stays absent (do not coerce to ""): the harness treats an
      // undefined workspaceDir as "use the default workspace".
      ...(workspaceDir ? { workspaceDir } : {}),
      ...(candidate.teamModeOff === undefined
        ? {}
        : { teamModeOff: candidate.teamModeOff }),
    },
  };
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
  import("./port.js").WebuiEnqueueMessageResult
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

function validateOptionalObjectBody(
  operation: string,
  body: unknown,
): WebuiOperationValidation<Record<string, unknown>> {
  if (body === undefined) return { ok: true, body: {} };
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body must be an object`,
    };
  return { ok: true, body: body as Record<string, unknown> };
}

export const watchEventsOperation: WebuiOperation<Record<string, unknown>> = {
  name: WATCH_EVENTS_OPERATION_NAME,
  validate: (body) =>
    validateOptionalObjectBody(WATCH_EVENTS_OPERATION_NAME, body),
};

export const listPendingPermissionsOperation: WebuiOperation<
  Record<string, unknown>
> = {
  name: LIST_PENDING_PERMISSIONS_OPERATION_NAME,
  validate: (body) =>
    validateOptionalObjectBody(LIST_PENDING_PERMISSIONS_OPERATION_NAME, body),
};

function validateNamedSessionBody(
  operation: string,
  body: unknown,
): WebuiOperationValidation<{
  readonly name: string;
  readonly sessionId: string;
}> {
  if (body === null || typeof body !== "object" || Array.isArray(body))
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body must be an object`,
    };
  const candidate = body as Record<string, unknown>;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const sessionId =
    typeof candidate.sessionId === "string" ? candidate.sessionId.trim() : "";
  if (!name || !sessionId)
    return {
      ok: false,
      code: WebuiErrorCode.invalidBody,
      message: `${operation} body requires name and sessionId`,
    };
  return { ok: true, body: { name, sessionId } };
}

export const getPendingQuestionnaireOperation: WebuiOperation<
  {
    readonly name: string;
    readonly sessionId: string;
  },
  { readonly request?: import("./port.js").WebuiQuestionnaireRequest }
> = {
  name: GET_PENDING_QUESTIONNAIRE_OPERATION_NAME,
  validate: (body) =>
    validateNamedSessionBody(GET_PENDING_QUESTIONNAIRE_OPERATION_NAME, body),
};

function validatePermissionDecision(
  value: unknown,
): value is WebuiPermissionDecision {
  return value === "allowOnce" || value === "allowAlways" || value === "deny";
}

export const replyPermissionOperation: WebuiOperation<
  {
    readonly name: string;
    readonly requestId: string;
    readonly reply: WebuiPermissionDecision;
  },
  import("./port.js").WebuiInteractionReplyResult
> = {
  name: REPLY_PERMISSION_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "replyPermission body must be an object",
      };
    const candidate = body as Record<string, unknown>;
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const requestId =
      typeof candidate.requestId === "string" ? candidate.requestId.trim() : "";
    if (!name || !requestId || !validatePermissionDecision(candidate.reply))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message:
          "replyPermission body requires name, requestId and a valid reply",
      };
    return { ok: true, body: { name, requestId, reply: candidate.reply } };
  },
};

function validateQuestionnaireAnswers(
  value: unknown,
): value is WebuiQuestionnaireAnswer[] {
  return (
    Array.isArray(value) &&
    value.every((answer) => {
      if (
        answer === null ||
        typeof answer !== "object" ||
        Array.isArray(answer)
      )
        return false;
      const candidate = answer as Record<string, unknown>;
      if (typeof candidate.stepId !== "string" || !candidate.stepId.trim())
        return false;
      if (
        candidate.selectedOptionIds !== undefined &&
        (!Array.isArray(candidate.selectedOptionIds) ||
          !candidate.selectedOptionIds.every((id) => typeof id === "string"))
      )
        return false;
      return (
        (candidate.selectedOther === undefined ||
          typeof candidate.selectedOther === "boolean") &&
        (candidate.otherText === undefined ||
          typeof candidate.otherText === "string") &&
        (candidate.skipped === undefined ||
          typeof candidate.skipped === "boolean")
      );
    })
  );
}

export const replyQuestionnaireOperation: WebuiOperation<
  {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: WebuiQuestionnaireAnswer[];
  },
  import("./port.js").WebuiInteractionReplyResult
> = {
  name: REPLY_QUESTIONNAIRE_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "replyQuestionnaire body must be an object",
      };
    const candidate = body as Record<string, unknown>;
    const name =
      typeof candidate.name === "string" ? candidate.name.trim() : "";
    const requestId =
      typeof candidate.requestId === "string" ? candidate.requestId.trim() : "";
    if (
      !name ||
      !requestId ||
      !Number.isInteger(candidate.schemaVersion) ||
      !validateQuestionnaireAnswers(candidate.answers)
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message:
          "replyQuestionnaire body requires name, requestId, schemaVersion and answers",
      };
    return {
      ok: true,
      body: {
        name,
        requestId,
        schemaVersion: candidate.schemaVersion as number,
        answers: candidate.answers,
      },
    };
  },
};

export const dismissQuestionnaireOperation: WebuiOperation<
  {
    readonly name: string;
    readonly requestId: string;
  },
  import("./port.js").WebuiInteractionReplyResult
> = {
  name: DISMISS_QUESTIONNAIRE_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "dismissQuestionnaire body must be an object",
      };
    const raw = body as Record<string, unknown>;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const requestId =
      typeof raw.requestId === "string" ? raw.requestId.trim() : "";
    if (!name || !requestId)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "dismissQuestionnaire body requires name and requestId",
      };
    return { ok: true, body: { name, requestId } };
  },
};

export const abortSessionOperation: WebuiOperation<
  {
    readonly id: string;
  },
  { readonly success?: boolean }
> = {
  name: ABORT_SESSION_OPERATION_NAME,
  validate: (body) => validateSessionIdBody(ABORT_SESSION_OPERATION_NAME, body),
};

export const listQueueMessagesOperation: WebuiOperation<
  {
    readonly id: string;
  },
  {
    readonly items?: readonly import("./port.js").WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }
> = {
  name: LIST_QUEUE_MESSAGES_OPERATION_NAME,
  validate: (body) =>
    validateSessionIdBody(LIST_QUEUE_MESSAGES_OPERATION_NAME, body),
};

export const deleteQueueItemOperation: WebuiOperation<
  {
    readonly id: string;
    readonly itemId: string;
  },
  { readonly item?: import("./port.js").WebuiQueueItem }
> = {
  name: DELETE_QUEUE_ITEM_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "deleteQueueItem body must be an object",
      };
    const candidate = body as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const itemId =
      typeof candidate.itemId === "string" ? candidate.itemId.trim() : "";
    if (!id || !itemId)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "deleteQueueItem body requires id and itemId",
      };
    return { ok: true, body: { id, itemId } };
  },
};

export const listModelsOperation: WebuiOperation<
  { readonly sessionId?: string },
  readonly import("./port.js").WebuiModelEntry[]
> = {
  name: LIST_MODELS_OPERATION_NAME,
  validate: (body) => {
    const value = validateOptionalObjectBody(LIST_MODELS_OPERATION_NAME, body);
    if (!value.ok) return value;
    if (
      value.body.sessionId !== undefined &&
      typeof value.body.sessionId !== "string"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "sessionId must be a string",
      };
    return {
      ok: true,
      body: value.body.sessionId ? { sessionId: value.body.sessionId } : {},
    };
  },
};

export const listSkillsOperation: WebuiOperation<
  { readonly agentName?: string },
  { readonly skills: readonly import("./port.js").WebuiSkillEntry[] }
> = {
  name: LIST_SKILLS_OPERATION_NAME,
  validate: (body) => {
    const value = validateOptionalObjectBody(LIST_SKILLS_OPERATION_NAME, body);
    if (!value.ok) return value;
    if (
      value.body.agentName !== undefined &&
      typeof value.body.agentName !== "string"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "agentName must be a string",
      };
    return {
      ok: true,
      body: value.body.agentName ? { agentName: value.body.agentName } : {},
    };
  },
};

export const selectModelOperation: WebuiOperation<
  {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly contextLimit?: number;
    readonly sessionId?: string;
  },
  { readonly success?: boolean }
> = {
  name: SELECT_MODEL_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "selectModel body must be an object",
      };
    const candidate = body as Record<string, unknown>;
    const providerId =
      typeof candidate.providerId === "string"
        ? candidate.providerId.trim()
        : "";
    const modelId =
      typeof candidate.modelId === "string" ? candidate.modelId.trim() : "";
    if (!providerId || !modelId)
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "selectModel body requires providerId and modelId",
      };
    if (
      candidate.variant !== undefined &&
      typeof candidate.variant !== "string"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "variant must be a string",
      };
    if (
      candidate.contextLimit !== undefined &&
      (typeof candidate.contextLimit !== "number" ||
        !Number.isSafeInteger(candidate.contextLimit) ||
        candidate.contextLimit <= 0)
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "contextLimit must be a positive safe integer",
      };
    if (
      candidate.sessionId !== undefined &&
      typeof candidate.sessionId !== "string"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "sessionId must be a string",
      };
    return {
      ok: true,
      body: {
        providerId,
        modelId,
        ...(typeof candidate.variant === "string"
          ? { variant: candidate.variant }
          : {}),
        ...(typeof candidate.contextLimit === "number"
          ? { contextLimit: candidate.contextLimit }
          : {}),
        ...(typeof candidate.sessionId === "string"
          ? { sessionId: candidate.sessionId }
          : {}),
      },
    };
  },
};

export const getSessionUsageOperation: WebuiOperation<
  { readonly id: string },
  Record<string, unknown>
> = {
  name: GET_SESSION_USAGE_OPERATION_NAME,
  validate: (body) =>
    validateSessionIdBody(GET_SESSION_USAGE_OPERATION_NAME, body),
};

export const getUsageQuotaOperation: WebuiOperation<
  { readonly forceRefresh?: boolean },
  unknown
> = {
  name: GET_USAGE_QUOTA_OPERATION_NAME,
  validate: (body) => {
    const value = validateOptionalObjectBody(GET_USAGE_QUOTA_OPERATION_NAME, body);
    if (!value.ok) return value;
    if (
      value.body.forceRefresh !== undefined &&
      typeof value.body.forceRefresh !== "boolean"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "forceRefresh must be a boolean",
      };
    return {
      ok: true,
      body: value.body.forceRefresh === true ? { forceRefresh: true } : {},
    };
  },
};

export const getAccountStatusOperation: WebuiOperation<
  { readonly sessionId?: string },
  Record<string, unknown>
> = {
  name: GET_ACCOUNT_STATUS_OPERATION_NAME,
  validate: (body) => {
    const value = validateOptionalObjectBody(
      GET_ACCOUNT_STATUS_OPERATION_NAME,
      body,
    );
    if (!value.ok) return value;
    if (
      value.body.sessionId !== undefined &&
      typeof value.body.sessionId !== "string"
    )
      return {
        ok: false,
        code: WebuiErrorCode.invalidBody,
        message: "sessionId must be a string",
      };
    return {
      ok: true,
      body: value.body.sessionId ? { sessionId: value.body.sessionId } : {},
    };
  },
};

export const runCommandOperation: WebuiOperation<
  import("./port.js").WebuiRunCommandRequest,
  import("./port.js").WebuiRunCommandResult
> = {
  name: RUN_COMMAND_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "runCommand body must be an object" };
    const candidate = body as Record<string, unknown>;
    const commands = ["help", "new", "compact", "status", "usage", "model"] as const;
    if (!commands.includes(candidate.command as (typeof commands)[number]))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "runCommand command is invalid" };
    for (const field of ["input", "sessionId", "agentName", "workspaceDir"] as const) {
      if (candidate[field] !== undefined && typeof candidate[field] !== "string")
        return { ok: false, code: WebuiErrorCode.invalidBody, message: `${field} must be a string` };
    }
    return { ok: true, body: candidate as unknown as import("./port.js").WebuiRunCommandRequest };
  },
};

export const getSigninPanelOperation: WebuiOperation<
  Record<string, never>,
  unknown
> = {
  name: GET_SIGNIN_PANEL_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0)
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "getSigninPanel body must be an empty object" };
    return { ok: true, body: {} };
  },
};

export const claimSigninOperation: WebuiOperation<
  Record<string, never>,
  unknown
> = {
  name: CLAIM_SIGNIN_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0)
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "claimSignin body must be an empty object" };
    return { ok: true, body: {} };
  },
};

export const signOutOperation: WebuiOperation<Record<string, never>, { readonly success: true }> = {
  name: SIGN_OUT_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 0)
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "signOut body must be an empty object" };
    return { ok: true, body: {} };
  },
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
    | "enqueueMessage"
    | "resumeSession"
    | "watchEvents"
    | "listPendingPermissions"
    | "getPendingQuestionnaire"
    | "replyPermission"
    | "replyQuestionnaire"
    | "dismissQuestionnaire"
    | "abortSession"
    | "listQueueMessages"
    | "deleteQueueItem"
    | "listModels"
    | "selectModel"
    | "listSkills"
    | "getSessionUsage"
    | "getUsageQuota"
    | "getSigninPanel"
    | "claimSignin"
    | "getAccountStatus"
    | "requestCompaction"
    | "invalidateAuth"
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
    operation: abortSessionOperation,
    handle: async (_context, body) => ({ body: await port.abortSession(body) }),
  });
  registerOperation(registry, {
    operation: listQueueMessagesOperation,
    handle: async (_context, body) => ({
      body: await port.listQueueMessages(body),
    }),
  });
  registerOperation(registry, {
    operation: deleteQueueItemOperation,
    handle: async (_context, body) => ({
      body: await port.deleteQueueItem(body),
    }),
  });
  registerOperation(registry, {
    operation: listModelsOperation,
    handle: async (_context, body) => ({ body: await port.listModels(body) }),
  });
  registerOperation(registry, {
    operation: selectModelOperation,
    handle: async (_context, body) => ({ body: await port.selectModel(body) }),
  });
  registerOperation(registry, {
    operation: listSkillsOperation,
    handle: async (_context, body) => ({
      body: await port.listSkills(body),
    }),
  });
  registerOperation(registry, {
    operation: getSessionUsageOperation,
    handle: async (_context, body) => ({
      body: await port.getSessionUsage(body),
    }),
  });
  registerOperation(registry, {
    operation: getUsageQuotaOperation,
    handle: async (_context, body) => ({
      body: await port.getUsageQuota(body),
    }),
  });
  registerOperation(registry, {
    operation: getSigninPanelOperation,
    handle: async () => ({ body: await port.getSigninPanel() }),
  });
  registerOperation(registry, {
    operation: claimSigninOperation,
    handle: async () => ({ body: await port.claimSignin() }),
  });
  registerOperation(registry, {
    operation: getAccountStatusOperation,
    handle: async (_context, body) => ({
      body: await port.getAccountStatus(body),
    }),
  });
  registerOperation(registry, {
    operation: runCommandOperation,
    handle: async (_context, body) => ({ body: await runWebuiCommand(port, body) }),
  });
  registerOperation(registry, {
    operation: signOutOperation,
    handle: async () => {
      if (!port.invalidateAuth) throw new Error("auth invalidation is unavailable");
      await port.invalidateAuth();
      return { body: { success: true as const } };
    },
  });
  registerOperation(registry, {
    operation: watchEventsOperation,
    handle: (context) => ({
      stream: {
        ok: true,
        source: port.watchEvents(context.signal),
      },
    }),
  });
  registerOperation(registry, {
    operation: listPendingPermissionsOperation,
    handle: async () => ({ body: await port.listPendingPermissions() }),
  });
  registerOperation(registry, {
    operation: getPendingQuestionnaireOperation,
    handle: async (_context, body) => ({
      body: await port.getPendingQuestionnaire(body),
    }),
  });
  registerOperation(registry, {
    operation: replyPermissionOperation,
    handle: async (_context, body) => ({
      body: await port.replyPermission(body),
    }),
  });
  registerOperation(registry, {
    operation: replyQuestionnaireOperation,
    handle: async (_context, body) => ({
      body: await port.replyQuestionnaire(body),
    }),
  });
  registerOperation(registry, {
    operation: dismissQuestionnaireOperation,
    handle: async (_context, body) => ({
      body: await port.dismissQuestionnaire(body),
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
    handle: async (_context, body) => {
      const result = await port.getMessages(body);
      const messages = result.messages ?? [];
      const turnId =
        [...messages].reverse().find((message) => message.turnId)?.turnId ?? "";
      return {
        body: {
          ...result,
          contextSnapshot: projectContextSnapshot({
            active: false,
            messages: messages.map((message) => ({
              kind: message.kind,
              timestamp: message.timestamp,
              rawJson: JSON.stringify(message),
            })),
          }) as unknown as Record<string, unknown>,
          usage: projectUsage(messages, turnId),
        },
      };
    },
  });
  registerOperation(registry, {
    operation: listSessionsOperation,
    handle: async (_context, body) => ({ body: await port.listSessions(body) }),
  });
  registerOperation(registry, {
    operation: sendMessageOperation,
    handle: async (context, body) => {
      const stream = await port.sendMessage(body, context.signal);
      return {
        stream: stream.ok
          ? { ...stream, source: projectSessionStream(stream.source) }
          : stream,
      };
    },
  });
  registerOperation(registry, {
    operation: enqueueMessageOperation,
    handle: async (_context, body) => ({
      body: await port.enqueueMessage(body),
    }),
  });
  registerOperation(registry, {
    operation: resumeSessionOperation,
    handle: async (context, body) => {
      const stream = await port.resumeSession(body, context.signal);
      return {
        stream: stream.ok
          ? { ...stream, source: projectSessionStream(stream.source) }
          : stream,
      };
    },
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
