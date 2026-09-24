import { WebuiErrorCode } from "../envelope.js";
import { requireRecord } from "./operation-contract.js";
import type { WebuiOperation, WebuiOperationValidation } from "./operation-contract.js";
import { validateSessionIdBody } from "./common.js";
import { ARCHIVE_SESSION_OPERATION_NAME, DELETE_SESSION_OPERATION_NAME, UPDATE_SESSION_OPERATION_NAME, GET_SESSION_FORK_OPTIONS_OPERATION_NAME, FORK_SESSION_OPERATION_NAME, LIST_USER_MODEL_PROVIDERS_OPERATION_NAME, CREATE_USER_MODEL_PROVIDER_OPERATION_NAME, UPDATE_USER_MODEL_PROVIDER_OPERATION_NAME, DELETE_USER_MODEL_PROVIDER_OPERATION_NAME, TEST_USER_MODEL_PROVIDER_OPERATION_NAME, TEST_USER_MODEL_OPERATION_NAME, DISCOVER_USER_MODELS_CANDIDATE_OPERATION_NAME, SAVE_USER_MODEL_PROVIDER_CANDIDATE_OPERATION_NAME, LIST_PROVIDER_PRESETS_OPERATION_NAME, GET_MINIMAX_API_KEY_STATUS_OPERATION_NAME, UPSERT_MINIMAX_API_KEY_OPERATION_NAME, GET_CODEX_OAUTH_STATUS_OPERATION_NAME, RUN_COMMAND_OPERATION_NAME, GET_SIGNIN_PANEL_OPERATION_NAME, CLAIM_SIGNIN_OPERATION_NAME, SIGN_OUT_OPERATION_NAME } from "./names.js";
function validateProviderRecord(name: string, body: unknown): WebuiOperationValidation<Record<string, unknown>> {
  return requireRecord(name, body);
}
function validateProviderId(name: string, body: unknown): WebuiOperationValidation<{ readonly providerId: string }> {
  const value = validateProviderRecord(name, body); if (!value.ok) return value;
  const providerId = typeof value.body.providerId === "string" ? value.body.providerId.trim() : "";
  return providerId ? { ok: true, body: { providerId } } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${name} body requires providerId` };
}
function providerRecordOperation(name: string): WebuiOperation<Record<string, unknown>, unknown> { return { name, validate: (body) => validateProviderRecord(name, body) }; }

export const archiveSessionOperation: WebuiOperation<{ readonly id: string }, { readonly success?: boolean }> = { name: ARCHIVE_SESSION_OPERATION_NAME, validate: (body) => validateSessionIdBody(ARCHIVE_SESSION_OPERATION_NAME, body) };
export const deleteSessionOperation: WebuiOperation<{ readonly id: string }, { readonly success?: boolean }> = { name: DELETE_SESSION_OPERATION_NAME, validate: (body) => validateSessionIdBody(DELETE_SESSION_OPERATION_NAME, body) };
export const updateSessionOperation: WebuiOperation<import("../port.js").WebuiUpdateSessionRequest, import("../port.js").WebuiUpdateSessionResult> = {
  name: UPDATE_SESSION_OPERATION_NAME,
  validate: (body) => {
    const value = validateSessionIdBody(UPDATE_SESSION_OPERATION_NAME, body);
    if (!value.ok) return value;
    const candidate = body as Record<string, unknown>;
    const title = typeof candidate.title === "string" ? candidate.title.trim() : "";
    return title
      ? { ok: true, body: { id: value.body.id, title } }
      : { ok: false, code: WebuiErrorCode.invalidBody, message: "updateSession requires a non-empty title" };
  },
};
export const getSessionForkOptionsOperation: WebuiOperation<import("../port.js").WebuiGetSessionForkOptionsRequest, import("../port.js").WebuiGetSessionForkOptionsResult> = {
  name: GET_SESSION_FORK_OPTIONS_OPERATION_NAME,
  validate: (body) => {
    const value = validateSessionIdBody(GET_SESSION_FORK_OPTIONS_OPERATION_NAME, body);
    if (!value.ok) return value;
    const candidate = body as Record<string, unknown>;
    const assistantMessageId = candidate.assistantMessageId;
    if (assistantMessageId !== undefined && (typeof assistantMessageId !== "string" || !assistantMessageId.trim()))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "assistantMessageId must be a non-empty string" };
    return {
      ok: true,
      body: {
        id: value.body.id,
        ...(typeof assistantMessageId === "string" ? { assistantMessageId: assistantMessageId.trim() } : {}),
      },
    };
  },
};
export const forkSessionOperation: WebuiOperation<import("../port.js").WebuiForkSessionRequest, import("../port.js").WebuiForkSessionResult> = {
  name: FORK_SESSION_OPERATION_NAME,
  validate: (body) => {
    if (body === null || typeof body !== "object" || Array.isArray(body))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "forkSession body must be an object" };
    const candidate = body as Record<string, unknown>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const clientRequestId = typeof candidate.clientRequestId === "string" ? candidate.clientRequestId.trim() : "";
    if (!id || !clientRequestId || typeof candidate.useSuggestedTitle !== "boolean" || typeof candidate.createIsolatedWorktree !== "boolean")
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "forkSession requires id, clientRequestId, useSuggestedTitle, and createIsolatedWorktree" };
    const assistantMessageId = candidate.assistantMessageId;
    if (assistantMessageId !== undefined && (typeof assistantMessageId !== "string" || !assistantMessageId.trim()))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "assistantMessageId must be a non-empty string" };
    const title = candidate.title === undefined ? undefined : typeof candidate.title === "string" ? candidate.title.trim() : "";
    if (candidate.title !== undefined && !title)
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "forkSession title must not be empty" };
    return { ok: true, body: { id, ...(typeof assistantMessageId === "string" ? { assistantMessageId: assistantMessageId.trim() } : {}), clientRequestId, useSuggestedTitle: candidate.useSuggestedTitle, createIsolatedWorktree: candidate.createIsolatedWorktree, ...(title ? { title } : {}) } };
  },
};
export const listUserModelProvidersOperation: WebuiOperation<undefined, readonly Record<string, unknown>[]> = { name: LIST_USER_MODEL_PROVIDERS_OPERATION_NAME, validate: (body) => body === undefined ? { ok: true, body: undefined } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${LIST_USER_MODEL_PROVIDERS_OPERATION_NAME} does not accept a body` } };
export const createUserModelProviderOperation = providerRecordOperation(CREATE_USER_MODEL_PROVIDER_OPERATION_NAME);
export const updateUserModelProviderOperation = providerRecordOperation(UPDATE_USER_MODEL_PROVIDER_OPERATION_NAME);
export const deleteUserModelProviderOperation: WebuiOperation<{ readonly providerId: string }, unknown> = { name: DELETE_USER_MODEL_PROVIDER_OPERATION_NAME, validate: (body) => validateProviderId(DELETE_USER_MODEL_PROVIDER_OPERATION_NAME, body) };
export const testUserModelProviderOperation: WebuiOperation<{ readonly providerId: string }, unknown> = { name: TEST_USER_MODEL_PROVIDER_OPERATION_NAME, validate: (body) => validateProviderId(TEST_USER_MODEL_PROVIDER_OPERATION_NAME, body) };
export const testUserModelOperation: WebuiOperation<{ readonly providerId: string; readonly modelId: string }, unknown> = { name: TEST_USER_MODEL_OPERATION_NAME, validate: (body) => { const value = validateProviderRecord(TEST_USER_MODEL_OPERATION_NAME, body); if (!value.ok) return value; const providerId = typeof value.body.providerId === "string" ? value.body.providerId.trim() : ""; const modelId = typeof value.body.modelId === "string" ? value.body.modelId.trim() : ""; return providerId && modelId ? { ok: true, body: { providerId, modelId } } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${TEST_USER_MODEL_OPERATION_NAME} body requires providerId and modelId` }; } };
export const discoverUserModelsCandidateOperation = providerRecordOperation(DISCOVER_USER_MODELS_CANDIDATE_OPERATION_NAME);
export const saveUserModelProviderCandidateOperation = providerRecordOperation(SAVE_USER_MODEL_PROVIDER_CANDIDATE_OPERATION_NAME);
export const listProviderPresetsOperation: WebuiOperation<undefined, readonly Record<string, unknown>[]> = { name: LIST_PROVIDER_PRESETS_OPERATION_NAME, validate: (body) => body === undefined ? { ok: true, body: undefined } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${LIST_PROVIDER_PRESETS_OPERATION_NAME} does not accept a body` } };
export const getMiniMaxApiKeyStatusOperation: WebuiOperation<undefined, Record<string, unknown>> = { name: GET_MINIMAX_API_KEY_STATUS_OPERATION_NAME, validate: (body) => body === undefined ? { ok: true, body: undefined } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${GET_MINIMAX_API_KEY_STATUS_OPERATION_NAME} does not accept a body` } };
export const upsertMiniMaxApiKeyOperation: WebuiOperation<{ readonly apiKey: string; readonly saveAndUse?: boolean }, unknown> = { name: UPSERT_MINIMAX_API_KEY_OPERATION_NAME, validate: (body) => { const value = validateProviderRecord(UPSERT_MINIMAX_API_KEY_OPERATION_NAME, body); if (!value.ok) return value; const apiKey = typeof value.body.apiKey === "string" ? value.body.apiKey : ""; if (!apiKey) return { ok: false, code: WebuiErrorCode.invalidBody, message: "apiKey is required" }; return { ok: true, body: { apiKey, ...(typeof value.body.saveAndUse === "boolean" ? { saveAndUse: value.body.saveAndUse } : {}) } }; } };
export const getCodexOAuthStatusOperation: WebuiOperation<undefined, Record<string, unknown>> = { name: GET_CODEX_OAUTH_STATUS_OPERATION_NAME, validate: (body) => body === undefined ? { ok: true, body: undefined } : { ok: false, code: WebuiErrorCode.invalidBody, message: `${GET_CODEX_OAUTH_STATUS_OPERATION_NAME} does not accept a body` } };

export const runCommandOperation: WebuiOperation<
  import("../port.js").WebuiRunCommandRequest,
  import("../port.js").WebuiRunCommandResult
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
    return { ok: true, body: candidate as unknown as import("../port.js").WebuiRunCommandRequest };
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
