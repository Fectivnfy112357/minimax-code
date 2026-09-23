// Effect reducer — extract the runtime-event switch from the
// `WebuiClientFoundationApp` component effect into a pure function.
//
// `app.tsx`'s `watchEvents` callback is currently an inline closure that
// closes over `sessionId`, `setStream`, `setSending`, `setPermissions`,
// `setQuestionnaire`, `setGoal`, and `refreshPending`. The closure does two
// things: (a) reduce workspace progress against every event, and (b)
// dispatch on `event.type` to write a sequence of state changes and
// optionally kick off the async refresh. This module factors out the
// pure decision — `(state, event) → { state, commands }` — so a test can
// drive the production protocol without standing up a DOM.
//
// The component effect becomes a thin executor that walks the returned
// commands in order. Three present-day behaviours that look like bugs are
// intentionally preserved here, because the runtime actually relies on them
// (and tests will fail if they get "fixed"):

//   1. `permission.resolved` with a non-string `requestId` STILL emits a
//      `setStream{phase:"streaming"}` command. The filter branch is a
//      no-op, but the stream-write is unconditional.
//   2. `questionnaire.dismiss`/`superseded` with a non-matching id keeps
//      the current questionnaire AND STILL emits a
//      `setStream{phase:"streaming"}` command.
//   3. Every event reduces workspace progress FIRST, then dispatches on
//      type. The reducer below mirrors this order so command traces are
//      stable regardless of payload shape.

import type {
  WebuiGoal,
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
  WebuiRuntimeEvent,
} from "../../server/port.js";
import {
  eventSessionId,
  pendingPermissionFromEvent,
  questionnaireFromEvent,
  replacePermission,
} from "./transcript-projection.js";
import {
  initialWebuiWorkspaceProgress,
  reduceWebuiWorkspaceProgressEvent,
} from "./workspace-progress.js";
import type { WebuiStreamState } from "../stream.js";
import { projectWebuiThreadGoalMessage } from "./goal-state.js";

/** The slice of component state the reducer mutates. Workspace progress
 *  lives on the stream slice (where `app.tsx` puts it) — see the source
 *  for `WebuiStreamState`. The full `WebuiClientFoundationApp` state has
 *  more (models, account status, …) but those are owned by sibling
 *  effects, not this one. */
export interface WebuiEffectState {
  readonly stream: WebuiStreamState;
  readonly permissions: readonly WebuiPendingPermission[];
  readonly questionnaire: WebuiQuestionnaireRequest | undefined;
  readonly goal: WebuiGoal | undefined;
}

/** One side effect the host executor must perform in order. The host owns
 *  the actual `setState` calls; the reducer only describes what to do. */
export type WebuiEffectCommand =
  | { readonly type: "refresh-pending" }
  | { readonly type: "set-sending"; readonly sending: boolean }
  | {
      readonly type: "set-stream";
      readonly patch: (current: WebuiStreamState) => WebuiStreamState;
    }
  | {
      readonly type: "set-permissions";
      readonly patch: (
        current: readonly WebuiPendingPermission[],
      ) => readonly WebuiPendingPermission[];
    }
  | {
      readonly type: "set-questionnaire";
      readonly patch: (
        current: WebuiQuestionnaireRequest | undefined,
      ) => WebuiQuestionnaireRequest | undefined;
    }
  | { readonly type: "set-goal"; readonly goal: WebuiGoal | undefined };

export interface WebuiEffectResult {
  readonly state: WebuiEffectState;
  readonly commands: readonly WebuiEffectCommand[];
}

/** Initial state for tests + the `cancelled = true` effect-cleared path. */
export function initialWebuiEffectState(
  stream: WebuiStreamState,
): WebuiEffectState {
  return {
    stream,
    permissions: [],
    questionnaire: undefined,
    goal: undefined,
  };
}

/**
 * Pure event reducer. Returns the new state and the ordered list of
 * commands the host should run.
 *
 * `sessionId` is passed in by the host (the host already knows the
 * active session from its own state). Events whose `payload.sessionId`
 * does not match are ignored. Workspace progress is reduced first, then
 * the per-type dispatch runs — see the module-level comment for the three
 * quirks this order preserves.
 */
export function reduceWebuiEffect(
  state: WebuiEffectState,
  event: WebuiRuntimeEvent,
  sessionId: string,
): WebuiEffectResult {
  // Every event unconditionally reduces workspace progress; only per-session
  // events are gated by the sessionId check below. The progress state lives
  // on the stream slice — that's where `app.tsx` reads it from.
  const nextWorkspaceProgress = reduceWebuiWorkspaceProgressEvent(
    state.stream.workspaceProgress,
    { type: event.type, ...event.payload },
    sessionId,
  );

  // Per-session gate. Events not addressed to this session are ignored
  // entirely (no state change, no commands) — this matches `app.tsx:3671`.
  // Workspace progress still rides along.
  if (eventSessionId(event) !== sessionId) {
    if (nextWorkspaceProgress === state.stream.workspaceProgress) {
      return { state, commands: [] };
    }
    return {
      state: {
        ...state,
        stream: {
          ...state.stream,
          workspaceProgress: nextWorkspaceProgress,
        },
      },
      commands: [],
    };
  }

  const commands: WebuiEffectCommand[] = [];

  switch (event.type) {
    case "session.start": {
      commands.push({ type: "set-sending", sending: true });
      commands.push({
        type: "set-stream",
        patch: (current) => ({ ...current, phase: "streaming" }),
      });
      break;
    }
    case "session.finish":
    case "session.abort":
    case "session.error": {
      commands.push({ type: "set-sending", sending: false });
      const status =
        event.type === "session.finish"
          ? "finished"
          : event.type === "session.abort"
            ? "aborted"
            : "error";
      // `refusal` is written only when `payload.error` is a string — matches
      // `app.tsx:3700-3702`. Other shapes (object, number, undefined) leave
      // `refusal` untouched.
      const refusalPatch = (current: WebuiStreamState): WebuiStreamState => {
        const nextState: WebuiStreamState = {
          ...current,
          phase: "done",
          status,
        };
        return typeof event.payload.error === "string"
          ? { ...nextState, refusal: event.payload.error as string }
          : nextState;
      };
      commands.push({ type: "set-stream", patch: refusalPatch });
      break;
    }
    case "session.queue.updated": {
      commands.push({ type: "refresh-pending" });
      break;
    }
    case "permission.ask": {
      const permission = pendingPermissionFromEvent(event);
      if (permission) {
        commands.push({
          type: "set-permissions",
          patch: (current) => replacePermission(current, permission),
        });
        commands.push({
          type: "set-stream",
          patch: (current) => ({ ...current, phase: "waiting" }),
        });
      }
      // When the payload is malformed the closure used to be a no-op
      // (no setPermissions, no setStream) — preserve that.
      break;
    }
    case "permission.resolved": {
      const requestId = event.payload.requestId;
      if (typeof requestId === "string") {
        commands.push({
          type: "set-permissions",
          patch: (current) =>
            current.filter((permission) => permission.requestId !== requestId),
        });
      }
      // Unconditional setStream{phase:"streaming"} — preserved verbatim from
      // `app.tsx:3726`. This is the load-bearing "filter is no-op, but stream
      // still flips" behaviour: a non-string `requestId` reaches this point
      // and the panel must come back to streaming regardless.
      commands.push({
        type: "set-stream",
        patch: (current) => ({ ...current, phase: "streaming" }),
      });
      break;
    }
    case "questionnaire.ask": {
      const request = questionnaireFromEvent(event);
      if (request) {
        commands.push({
          type: "set-questionnaire",
          patch: () => request,
        });
        commands.push({
          type: "set-stream",
          patch: (current) => ({ ...current, phase: "waiting" }),
        });
      }
      break;
    }
    case "thread_goal.objective_updated":
    case "thread_goal.objective_steering":
    case "thread_goal.updated": {
      const nextGoal = event.payload.goal;
      if (nextGoal && typeof nextGoal === "object") {
        const projectedGoal = nextGoal as WebuiGoal;
        commands.push({ type: "set-goal", goal: projectedGoal });
        commands.push({
          type: "set-stream",
          patch: (current) => {
            const message = projectWebuiThreadGoalMessage(
              event.type,
              projectedGoal,
            );
            if (!message) return current;
            const messageId = message.id;
            const existing = current.messages.findIndex(
              (item) => item.id === messageId,
            );
            if (existing < 0)
              return { ...current, messages: [...current.messages, message] };
            const messages = [...current.messages];
            messages[existing] = message;
            return { ...current, messages };
          },
        });
      }
      break;
    }
    case "thread_goal.cleared": {
      commands.push({ type: "set-goal", goal: undefined });
      break;
    }
    case "questionnaire.dismiss":
    case "questionnaire.superseded": {
      const requestId = event.payload.requestId;
      // The closure always invokes setQuestionnaire with the patch
      // function when `requestId` is a string — even if the patch ends up
      // a no-op for non-matching ids. We mirror that: the command list
      // still carries a `set-questionnaire` so the trace matches `app.tsx`.
      if (typeof requestId === "string") {
        commands.push({
          type: "set-questionnaire",
          patch: (current) =>
            current?.id === requestId ? undefined : current,
        });
      }
      // Unconditional setStream{phase:"streaming"} — preserved verbatim
      // from `app.tsx:3773`. A non-matching id keeps the current
      // questionnaire AND the stream still flips to streaming; this is
      // the second load-bearing quirk.
      commands.push({
        type: "set-stream",
        patch: (current) => ({ ...current, phase: "streaming" }),
      });
      break;
    }
    default:
      // Unknown event types get workspace-progress reduced (above) but
      // produce no state writes or commands.
      break;
  }

  return {
    state: applyAllCommands(state, commands, nextWorkspaceProgress),
    commands: dedupeSetSending(commands),
  };
}

/** Apply every command's patch in order to derive the final state. The
 *  host will do the same thing for its own `setState` reducers;
 *  pre-computing it here keeps the reducer pure and lets tests assert both
 *  the command list AND the resulting state. */
function applyAllCommands(
  state: WebuiEffectState,
  commands: readonly WebuiEffectCommand[],
  workspaceProgress: WebuiEffectState["stream"]["workspaceProgress"],
): WebuiEffectState {
  let stream = state.stream;
  let permissions = state.permissions;
  let questionnaire = state.questionnaire;
  let goal = state.goal;
  for (const cmd of commands) {
    if (cmd.type === "set-stream") stream = cmd.patch(stream);
    else if (cmd.type === "set-permissions") permissions = cmd.patch(permissions);
    else if (cmd.type === "set-questionnaire")
      questionnaire = cmd.patch(questionnaire);
    else if (cmd.type === "set-goal") goal = cmd.goal;
  }
  return {
    stream: { ...stream, workspaceProgress },
    permissions,
    questionnaire,
    goal,
  };
}

/** `set-sending(true)` followed by `set-sending(false)` collapses to just
 *  the final value. This matches the host's `setSending(sending)` which
 *  only retains the latest call, and lets the command trace stay short. */
function dedupeSetSending(
  commands: readonly WebuiEffectCommand[],
): readonly WebuiEffectCommand[] {
  const out: WebuiEffectCommand[] = [];
  let lastSending: boolean | undefined;
  for (const cmd of commands) {
    if (cmd.type === "set-sending") {
      lastSending = cmd.sending;
      continue;
    }
    out.push(cmd);
  }
  if (lastSending !== undefined) {
    out.unshift({ type: "set-sending", sending: lastSending });
  }
  return out;
}

// `initialWebuiWorkspaceProgress` is re-exported only because a few tests
// reach for it as the "empty" workspace progress state. The reducer itself
// doesn't import it directly.
export { initialWebuiWorkspaceProgress };