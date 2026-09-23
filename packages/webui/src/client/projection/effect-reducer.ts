// Effect reducer — extract the runtime-event switch from the
// `WebuiClientFoundationApp` component effect into a pure function.
//
// `app.tsx`'s `watchEvents` callback is an inline closure that closes over
// `sessionId`, `setStream`, `setSending`, `setPermissions`,
// `setQuestionnaire`, `setGoal`, and `refreshPending`. The closure does
// two things: (a) guard on the event's target session, and (b) dispatch
// on `event.type` to write a sequence of state changes and optionally
// kick off the async refresh. This module factors out the pure decision —
// `(state, event) → { state, commands }` — so a test can drive the
// production protocol without standing up a DOM.
//
// ## Design contract (W2.9)
//
//   1. The **session guard is the first thing** the reducer does. If
//      `eventSessionId(event) !== sessionId`, the reducer returns
//      `{ state, commands: [] }` — same object identity on the state,
//      no workspace progress touched. (The original closure's
//      `if (eventSessionId(event) !== sessionId) return;` ran before any
//      state write; the W0 inventory wrote it the other way around and
//      we faithfully implemented that mistake. The inventory is corrected
//      in place; this reducer now matches the original.)
//   2. Workspace progress is **the first command** whenever the guard
//      passes. Every dispatched branch — including the `default` arm for
//      unknown event types — produces a `set-stream` command that
//      patches the new `workspaceProgress` first. The host executor walks
//      the command list in order; the first command is therefore the
//      progress write.
//
//      We do NOT short-circuit "value didn't change, skip the command".
//      The original closure built a fresh object on every event and
//      always called `setStream`; the reducer mirrors that. Skipping here
//      would also break the "command list = host setter trace" contract.
//   3. Three present-day behaviours that look like bugs are intentionally
//      preserved because the runtime relies on them:
//
//        a. `permission.resolved` with a non-string `requestId` STILL
//           emits `set-stream{phase:"streaming"}`. The permissions filter
//           is skipped, but the stream write is unconditional.
//        b. `questionnaire.dismiss`/`superseded` with a non-matching id
//           keeps the current questionnaire AND STILL emits
//           `set-stream{phase:"streaming"}`. The `set-questionnaire`
//           command is still pushed with a no-op patch, so the trace
//           matches what the original closure did.
//        c. `session.finish`/`abort`/`error` write `refusal` only when
//           `payload.error` is a string; other shapes leave `refusal`
//           alone.

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
  type WebuiWorkspaceProgressState,
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

/** One side effect the host executor must perform in order. The host
 *  walks the list in order; each command is a 1-to-1 trace of a setter
 *  call (or, for `refresh-pending`, a `void` async kick). */
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

/** Initial state for tests and the `cancelled = true` effect-cleared path. */
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
 * active session from its own state). The session guard runs first;
 * events not addressed to this session return the input state with an
 * empty command list and zero progress writes. See the module-level
 * contract for the order in which state writes happen.
 */
export function reduceWebuiEffect(
  state: WebuiEffectState,
  event: WebuiRuntimeEvent,
  sessionId: string,
): WebuiEffectResult {
  // (1) Session guard runs FIRST. Anything not addressed to the active
  // session is dropped wholesale — no progress write, no commands,
  // exact same state object. This matches `app.tsx:3671` in the original
  // closure; the W0 inventory wrote the order the other way around and
  // we are correcting it here.
  if (eventSessionId(event) !== sessionId) {
    return { state, commands: [] };
  }

  // (2) Compute the next workspace progress. The reducer is unconditional
  // — unknown event types still get reduced, even if no observable change
  // comes out. This is what the host closure did (it called the reducer
  // before the type dispatch).
  const nextWorkspaceProgress = reduceWebuiWorkspaceProgressEvent(
    state.stream.workspaceProgress,
    { type: event.type, ...event.payload },
    sessionId,
  );

  // (3) Build the command list. The first command is ALWAYS the progress
  // write — this is what lets trace 9 prove "progress first, then
  // dispatch" without the previous "same final state" weakness.
  const commands: WebuiEffectCommand[] = [
    {
      type: "set-stream",
      patch: (current) => ({ ...current, workspaceProgress: nextWorkspaceProgress }),
    },
  ];

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
      // the original closure's `typeof event.payload.error === "string"`
      // conditional. Other shapes (object, number, undefined) leave
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
      // for the permission+stream writes — only the progress command
      // remains. The trace 4 assertion now expects this exactly.
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
      // Unconditional setStream{phase:"streaming"} — preserved verbatim
      // from the original closure. This is the load-bearing "filter is
      // no-op, but stream still flips" behaviour: a non-string
      // `requestId` reaches this point and the panel must come back to
      // streaming regardless.
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
      // The closure always invoked setQuestionnaire with the patch
      // function when `requestId` is a string — even when the patch ends
      // up a no-op for non-matching ids. We mirror that: the command list
      // still carries a `set-questionnaire` so the trace matches.
      if (typeof requestId === "string") {
        commands.push({
          type: "set-questionnaire",
          patch: (current) =>
            current?.id === requestId ? undefined : current,
        });
      }
      // Unconditional setStream{phase:"streaming"} — preserved verbatim.
      // A non-matching id keeps the current questionnaire AND the
      // stream still flips to streaming; this is the second load-bearing
      // quirk.
      commands.push({
        type: "set-stream",
        patch: (current) => ({ ...current, phase: "streaming" }),
      });
      break;
    }
    default:
      // Unknown event types fall through with just the progress command.
      break;
  }

  return {
    state: applyAllCommands(state, commands),
    commands,
  };
}

/** Apply every command's patch in order to derive the final state. The
 *  host executor does the same against its real React setters; running
 *  it here keeps the reducer pure and lets tests assert both the command
 *  list AND the resulting state in lockstep.
 *
 *  IMPORTANT: the progress patch comes from `commands[0]`, so this loop
 *  is what materialises `workspaceProgress` into the returned state.
 *  There is no separate `stream: { ...stream, workspaceProgress }`
 *  override — that would split "commands" from "state" and break the
 *  single-source-of-truth contract. */
function applyAllCommands(
  state: WebuiEffectState,
  commands: readonly WebuiEffectCommand[],
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
  return { stream, permissions, questionnaire, goal };
}

/* --------------------------------------------------------------------------
 * Effect executor
 *
 * Walks a `WebuiEffectCommand[]` against a bag of host handlers. This is
 * the production glue between the pure reducer and the React setters.
 *
 * Contract:
 *   - `set-stream` / `set-permissions` / `set-questionnaire` are patch
 *     commands; we call `handlers.setX(cmd.patch)` exactly the way the
 *     host's `useState` setters expect (functional updater form).
 *     `questionnaire.ask` deliberately carries a `() => request` patch
 *     (passing a value would be equivalent under React 18+, but the
 *     "command list = setter call trace" contract needs every command
 *     to land on the same shape).
 *   - `set-sending` / `set-goal` are value commands; pass the value
 *     directly (`setGoal(undefined)` / `setSending(true)`).
 *   - `refresh-pending` is `void refreshPending().catch(() => undefined)`
 *     in the original closure. We swallow the rejection here too so
 *     `void` does not turn into an unhandled rejection.
 *   - Commands are walked in array order, no reordering.
 * ------------------------------------------------------------------------ */

export interface WebuiEffectHandlers {
  readonly refreshPending: () => void | Promise<unknown>;
  readonly setSending: (sending: boolean) => void;
  readonly setStream: (patch: (current: WebuiStreamState) => WebuiStreamState) => void;
  readonly setPermissions: (
    patch: (
      current: readonly WebuiPendingPermission[],
    ) => readonly WebuiPendingPermission[],
  ) => void;
  readonly setQuestionnaire: (
    patch: (
      current: WebuiQuestionnaireRequest | undefined,
    ) => WebuiQuestionnaireRequest | undefined,
  ) => void;
  readonly setGoal: (goal: WebuiGoal | undefined) => void;
}

export function applyWebuiEffectCommands(
  commands: readonly WebuiEffectCommand[],
  handlers: WebuiEffectHandlers,
): void {
  for (const cmd of commands) {
    switch (cmd.type) {
      case "refresh-pending":
        // The original closure wrote `void refreshPending().catch(...)`
        // — swallow rejections so this Promise doesn't surface as
        // unhandled. `handlers.refreshPending` returns `void |
        // Promise<unknown>`; if it returns a promise we attach the
        // catch, otherwise we drop it on the floor.
        Promise.resolve(handlers.refreshPending()).catch(() => undefined);
        break;
      case "set-sending":
        handlers.setSending(cmd.sending);
        break;
      case "set-stream":
        handlers.setStream(cmd.patch);
        break;
      case "set-permissions":
        handlers.setPermissions(cmd.patch);
        break;
      case "set-questionnaire":
        handlers.setQuestionnaire(cmd.patch);
        break;
      case "set-goal":
        handlers.setGoal(cmd.goal);
        break;
    }
  }
}

// `initialWebuiWorkspaceProgress` is re-exported only because a few tests
// reach for it as the "empty" workspace progress state. The reducer itself
// doesn't import it directly.
export { initialWebuiWorkspaceProgress };