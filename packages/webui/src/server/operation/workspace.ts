import { WebuiErrorCode } from "../envelope.js";
import type { WebuiOperation, WebuiOperationValidation } from "../operation-contract.js";
import type { WebuiWorkspaceGitMutationRequest } from "../port.js";
import { validateObjectBody } from "./common.js";
import { LIST_WORKSPACE_FILE_TREE_OPERATION_NAME, READ_WORKSPACE_FILE_OPERATION_NAME, GET_WORKSPACE_ENVIRONMENT_OPERATION_NAME, MUTATE_WORKSPACE_GIT_OPERATION_NAME, READ_CANVAS_OPERATION_NAME, APPLY_CANVAS_OPERATION_NAME, CREATE_TERMINAL_OPERATION_NAME, LIST_TERMINALS_OPERATION_NAME, WRITE_TERMINAL_OPERATION_NAME, RESIZE_TERMINAL_OPERATION_NAME, DISPOSE_TERMINAL_OPERATION_NAME, WATCH_TERMINAL_OPERATION_NAME } from "./names.js";
export const listWorkspaceFileTreeOperation: WebuiOperation<Record<string, unknown>> = {
  name: LIST_WORKSPACE_FILE_TREE_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(LIST_WORKSPACE_FILE_TREE_OPERATION_NAME, body);
    if (!result.ok) return result;
    if (typeof result.body.workspaceDir !== "string" || !result.body.workspaceDir.trim())
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "workspaceDir is required" };
    if (result.body.path !== undefined && typeof result.body.path !== "string")
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "path must be a string" };
    return result;
  },
};
export const readWorkspaceFileOperation: WebuiOperation<Record<string, unknown>> = {
  name: READ_WORKSPACE_FILE_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(READ_WORKSPACE_FILE_OPERATION_NAME, body);
    if (!result.ok) return result;
    if (typeof result.body.workspaceDir !== "string" || typeof result.body.path !== "string")
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "workspaceDir and path are required" };
    return result;
  },
};
export const getWorkspaceEnvironmentOperation: WebuiOperation<Record<string, unknown>> = {
  name: GET_WORKSPACE_ENVIRONMENT_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(GET_WORKSPACE_ENVIRONMENT_OPERATION_NAME, body);
    if (!result.ok) return result;
    return typeof result.body.workspaceDir === "string" && result.body.workspaceDir.trim()
      ? result
      : { ok: false, code: WebuiErrorCode.invalidBody, message: "workspaceDir is required" };
  },
};
export const mutateWorkspaceGitOperation: WebuiOperation<WebuiWorkspaceGitMutationRequest, Record<string, unknown>> = {
  name: MUTATE_WORKSPACE_GIT_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(MUTATE_WORKSPACE_GIT_OPERATION_NAME, body);
    if (!result.ok) return result as WebuiOperationValidation<WebuiWorkspaceGitMutationRequest>;
    const { workspaceDir, action, message } = result.body;
    if (typeof workspaceDir !== "string" || !workspaceDir.trim())
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "workspaceDir is required" };
    if (action !== "commit" && action !== "commitAndPush" && action !== "push")
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "action must be commit, commitAndPush, or push" };
    if (message !== undefined && typeof message !== "string")
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "message must be a string" };
    if (action !== "push" && (typeof message !== "string" || !message.trim()))
      return { ok: false, code: WebuiErrorCode.invalidBody, message: "message is required for commit actions" };
    return { ok: true, body: { workspaceDir, action, ...(message === undefined ? {} : { message }) } };
  },
};
export const readCanvasOperation: WebuiOperation<Record<string, unknown>> = {
  name: READ_CANVAS_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(READ_CANVAS_OPERATION_NAME, body);
    if (!result.ok) return result;
    return typeof result.body.sessionId === "string" && result.body.sessionId.trim()
      ? result
      : { ok: false, code: WebuiErrorCode.invalidBody, message: "sessionId is required" };
  },
};
export const applyCanvasOperation: WebuiOperation<Record<string, unknown>> = {
  name: APPLY_CANVAS_OPERATION_NAME,
  validate: (body) => {
    const result = validateObjectBody(APPLY_CANVAS_OPERATION_NAME, body);
    if (!result.ok) return result;
    return typeof result.body.sessionId === "string" && result.body.operation !== undefined
      ? result
      : { ok: false, code: WebuiErrorCode.invalidBody, message: "sessionId and operation are required" };
  },
};
export const createTerminalOperation: WebuiOperation<Record<string, unknown>> = { name: CREATE_TERMINAL_OPERATION_NAME, validate: (body) => validateObjectBody(CREATE_TERMINAL_OPERATION_NAME, body) };
export const listTerminalsOperation: WebuiOperation<Record<string, never>> = { name: LIST_TERMINALS_OPERATION_NAME, validate: (body) => body && typeof body === "object" && !Array.isArray(body) && Object.keys(body).length === 0 ? { ok: true, body: {} } : { ok: false, code: WebuiErrorCode.invalidBody, message: "listTerminals body must be an empty object" } };
export const writeTerminalOperation: WebuiOperation<Record<string, unknown>> = { name: WRITE_TERMINAL_OPERATION_NAME, validate: (body) => validateObjectBody(WRITE_TERMINAL_OPERATION_NAME, body) };
export const resizeTerminalOperation: WebuiOperation<Record<string, unknown>> = { name: RESIZE_TERMINAL_OPERATION_NAME, validate: (body) => validateObjectBody(RESIZE_TERMINAL_OPERATION_NAME, body) };
export const disposeTerminalOperation: WebuiOperation<Record<string, unknown>> = { name: DISPOSE_TERMINAL_OPERATION_NAME, validate: (body) => validateObjectBody(DISPOSE_TERMINAL_OPERATION_NAME, body) };
export const watchTerminalOperation: WebuiOperation<Record<string, unknown>> = { name: WATCH_TERMINAL_OPERATION_NAME, validate: (body) => validateObjectBody(WATCH_TERMINAL_OPERATION_NAME, body) };
