// Composer submit helpers — pure form-submit handler extracted from the
// React component so a test can drive the production app-to-helper seam
// without standing up a DOM.
//
// `buildWebuiComposerHandlers` is a single-line pass-through by design: its
// job is to make the call site read `submitWebuiComposerTurn(args,
// buildWebuiComposerHandlers({...}))` rather than scattering the setters
// around the JSX. `submitWebuiComposerTurn` itself is the real handler:
// it normalises the draft, creates a session when one is missing, sends or
// enqueues the message, and routes failures into the `refusal` field so the
// panel surfaces them inline.

import type {
  WebuiClientCreateSessionResult,
  WebuiClientMessageEnqueuer,
  WebuiClientSessionCreator,
} from "../contracts.js";
import type {
  WebuiGoal,
  WebuiGoalCreateRequest,
  WebuiGoalPatchRequest,
} from "../../server/port.js";
import { formatWebuiError } from "../value-readers.js";
import { initialWebuiStreamState } from "../stream.js";
import {
  buildWebuiStreamLoopSink,
  runWebuiStreamLoop,
  type WebuiStreamLoopDeps,
} from "../stream-loop.js";
import type { WebuiStreamState } from "../stream.js";

/** Inputs the composer submit handler needs. */
export interface WebuiComposerSubmitArgs {
  readonly sessionId?: string;
  readonly draft: string;
  readonly sending: boolean;
  readonly deps: WebuiStreamLoopDeps;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  /** Create the first session silently when New Task has no selected session. */
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

/** React-state setters the submit handler needs. Bundling them on a single
 *  object lets the test layer pass a stub bag and assert which setters ran. */
export interface WebuiComposerSubmitHandlers {
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
  readonly setSending: (sending: boolean) => void;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onSessionCreated?: (sessionId: string) => void;
  readonly onQueued?: () => void;
}

/**
 * Assemble the React-state setters the submit handler needs into the shape
 * `submitWebuiComposerTurn` accepts. The component in this file calls this
 * once per render with the setters it derives from `useState`, then hands
 * the result to `submitWebuiComposerTurn`. The helper is a single-line
 * pass-through by design — its job is to make the call site read
 * `submitWebuiComposerTurn(args, buildWebuiComposerHandlers({...}))`.
 */
export function buildWebuiComposerHandlers(args: {
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: WebuiComposerSubmitHandlers["setSending"];
  readonly onDraftChange: WebuiComposerSubmitHandlers["onDraftChange"];
  readonly onNeedsSession?: WebuiComposerSubmitHandlers["onNeedsSession"];
  readonly onSessionCreated?: WebuiComposerSubmitHandlers["onSessionCreated"];
  readonly onQueued?: WebuiComposerSubmitHandlers["onQueued"];
}): WebuiComposerSubmitHandlers {
  return {
    setStream: args.setStream,
    setSending: args.setSending,
    onDraftChange: args.onDraftChange,
    onNeedsSession: args.onNeedsSession,
    onSessionCreated: args.onSessionCreated,
    onQueued: args.onQueued,
  };
}

export interface WebuiGoalSubmitArgs {
  readonly sessionId?: string;
  readonly objective: string;
  readonly currentGoal?: WebuiGoal;
  readonly createGoal: (request: WebuiGoalCreateRequest) => Promise<WebuiGoal>;
  readonly patchGoal?: (request: WebuiGoalPatchRequest) => Promise<WebuiGoal>;
  readonly createSession?: WebuiClientSessionCreator;
  readonly createSessionWorkspaceDir?: string;
  readonly teamModeOff?: boolean;
}

/**
 * Submit the Desktop-style goal composer action without sending the objective
 * as a normal chat message. A home composer creates the session first, then
 * uses the existing goal RPC; an existing goal is updated through patchGoal.
 */
export async function submitWebuiGoal(
  args: WebuiGoalSubmitArgs,
  onSessionCreated?: (sessionId: string) => void,
): Promise<WebuiGoal> {
  const objective = args.objective.trim();
  if (!objective) throw new Error("目标内容不能为空");
  let sessionId = args.sessionId;
  if (!sessionId) {
    if (!args.createSession) throw new Error("无法创建目标会话");
    const result = await args.createSession({
      name: "main",
      ...(args.createSessionWorkspaceDir
        ? { workspaceDir: args.createSessionWorkspaceDir }
        : {}),
      teamModeOff: args.teamModeOff,
    });
    sessionId = createdSessionId(result);
    if (!sessionId) throw new Error("创建目标会话未返回会话 ID");
    onSessionCreated?.(sessionId);
  }
  if (args.currentGoal && args.patchGoal) {
    return args.patchGoal({ sessionId, objective });
  }
  return args.createGoal({ sessionId, objective });
}

/**
 * Submit one composer turn. Steps:
 *   1. Trim the draft; bail out on empty or when no transport is wired.
 *   2. If we have no `sessionId`, call `createSession` and seed the live
 *      state on the (still-home) key. The `onSessionCreated` callback is
 *      the seam the host uses to migrate the state into the new key.
 *   3. If a turn is in flight and `enqueueMessage` is wired, queue the
 *      message instead of sending it. Otherwise call `runWebuiStreamLoop`
 *      with the live `setStream` sink.
 *   4. All failures land on `setStream.refusal` via `formatWebuiError` so
 *      the panel can render them inline.
 */
export async function submitWebuiComposerTurn(
  args: WebuiComposerSubmitArgs,
  handlers: WebuiComposerSubmitHandlers,
): Promise<void> {
  const message = args.draft.trim();
  if (!message || (!args.deps.sendMessage && !args.enqueueMessage)) return;
  let sessionId = args.sessionId;
  if (!sessionId) {
    // No workspace is fine: the harness falls back to the default workspace
    // (desktop's 不需要项目 / default-directory flows). Only bail when the
    // session creator itself is not wired — that used to swallow the send
    // silently whenever the folder pill was unset.
    if (!args.createSession) {
      handlers.onNeedsSession?.(args.draft);
      return;
    }
    try {
      const result = await args.createSession({
        name: "main",
        workspaceDir: args.createSessionWorkspaceDir,
        teamModeOff: args.teamModeOff,
      });
      sessionId = createdSessionId(result);
      if (!sessionId)
        throw new Error("createSession response did not include a session id");
      handlers.setStream(() => ({
        ...initialWebuiStreamState,
        phase: "streaming",
        processingStartedAtMs: Date.now(),
      }));
      handlers.onSessionCreated?.(sessionId);
    } catch (error) {
      handlers.setStream((current) => ({
        ...current,
        refusal: formatWebuiError(error),
      }));
      return;
    }
  }
  if (args.sending) {
    if (!args.enqueueMessage) return;
    try {
      await args.enqueueMessage({ id: sessionId, content: message });
      handlers.onDraftChange("");
      handlers.onQueued?.();
    } catch (error) {
      handlers.setStream((current) => ({
        ...current,
        refusal: formatWebuiError(error),
      }));
    }
    return;
  }
  if (!args.deps.sendMessage) return;
  handlers.setSending(true);
  handlers.onDraftChange("");
  handlers.setStream((current) => ({
    ...initialWebuiStreamState,
    phase: "streaming",
    processingStartedAtMs: Date.now(),
  }));
  try {
    await runWebuiStreamLoop(
      args.deps,
      { sessionId, message },
      buildWebuiStreamLoopSink(handlers.setStream),
    );
  } finally {
    handlers.setSending(false);
  }
}

/** Extract a non-blank session id from the `createSession` result.
 *
 * The runtime returns the id in two places — top-level or under `session` —
 * and either field can be missing, blank, or padded with whitespace.
 * `submitWebuiComposerTurn` later uses this as the live session key, so the
 * `.trim()` + `|| undefined` matters: a `"   "` session id would
 * `!sessionId`-branch off cleanly under `??` but skip the trim and pass the
 * whitespace into the runtime. Match the historical semantics.
 */
export function createdSessionId(
  result: WebuiClientCreateSessionResult,
): string | undefined {
  return result.sessionId?.trim() || result.session?.sessionId?.trim() || undefined;
}
