// W2 trace tests — exercise `reduceWebuiEffect` against the 10 behaviours
// enumerated in `refactor-recon/w0-baseline/effect-inventory.md §"W2 抽取时
// 必须覆盖的 trace 断言"`.
//
// Each `describe` block corresponds to one trace. The fixtures are written
// against the *event* shape the runtime hands the client, and every
// expected value is spelled out here rather than derived from an
// implementation constant, so a change on either side fails the test.

import { describe, it, expect } from "vitest";

import {
  initialWebuiEffectState,
  reduceWebuiEffect,
  type WebuiEffectCommand,
  type WebuiEffectState,
} from "../../src/client/projection/effect-reducer.js";
import { initialWebuiStreamState } from "../../src/client/stream.js";
import {
  initialWebuiWorkspaceProgress,
  reduceWebuiWorkspaceProgressEvent,
} from "../../src/client/projection/workspace-progress.js";
import type {
  WebuiPendingPermission,
  WebuiQuestionnaireRequest,
  WebuiRuntimeEvent,
} from "../../src/server/port.js";

const SESSION = "session-1";

function makeState(
  override?: Partial<WebuiEffectState>,
): WebuiEffectState {
  return {
    ...initialWebuiEffectState(initialWebuiStreamState),
    ...override,
  };
}

function event(
  partial: Partial<WebuiRuntimeEvent> & {
    readonly type: string;
    readonly payload: Record<string, unknown>;
  },
): WebuiRuntimeEvent {
  return {
    source: "test",
    timestamp: 0,
    ...partial,
  };
}

function commandTypes(commands: readonly WebuiEffectCommand[]): string[] {
  return commands.map((cmd) => cmd.type);
}

function findCommand<T extends WebuiEffectCommand["type"]>(
  commands: readonly WebuiEffectCommand[],
  type: T,
): Extract<WebuiEffectCommand, { readonly type: T }> | undefined {
  return commands.find(
    (cmd): cmd is Extract<WebuiEffectCommand, { readonly type: T }> =>
      cmd.type === type,
  ) as Extract<WebuiEffectCommand, { readonly type: T }> | undefined;
}

const PERMISSION: WebuiPendingPermission = {
  requestId: "perm-1",
  sessionId: SESSION,
  agentName: "main",
  toolName: "bash",
  ruleContents: ["ls"],
  reason: "needs approval",
  allowAlwaysSupported: true,
  createdAt: 1,
};

const QUESTIONNAIRE: WebuiQuestionnaireRequest = {
  schemaVersion: 1,
  id: "q-1",
  presentation: {
    replaceComposer: true,
    showProgress: false,
    allowBackNavigation: false,
  },
  steps: [
    {
      id: "step-1",
      question: "Pick one",
      selectionMode: 0,
      allowOther: false,
      otherPlaceholder: "",
      required: true,
    },
  ],
};

describe("W2 · trace 1 · session.start emits sending+streaming in order", () => {
  it("returns set-sending(true) before set-stream{phase:streaming}", () => {
    const state = makeState();
    const result = reduceWebuiEffect(
      state,
      event({ type: "session.start", payload: { sessionId: SESSION } }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual([
      "set-sending",
      "set-stream",
    ]);
    expect(findCommand(result.commands, "set-sending")?.sending).toBe(true);
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    const nextStream = streamPatch?.(initialWebuiStreamState);
    expect(nextStream?.phase).toBe("streaming");
  });
});

describe("W2 · trace 2 · session.finish/abort/error map to status + refusal", () => {
  it("finish → status:finished, refusal untouched when payload.error absent", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.finish", payload: { sessionId: SESSION } }),
      SESSION,
    );
    expect(findCommand(result.commands, "set-sending")?.sending).toBe(false);
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    const nextStream = streamPatch?.(initialWebuiStreamState);
    expect(nextStream?.phase).toBe("done");
    expect(nextStream?.status).toBe("finished");
    expect(nextStream?.refusal).toBeUndefined();
  });

  it("abort → status:aborted", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.abort", payload: { sessionId: SESSION } }),
      SESSION,
    );
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    expect(streamPatch?.(initialWebuiStreamState)?.status).toBe("aborted");
  });

  it("error → status:error, refusal written when payload.error is string", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "session.error",
        payload: { sessionId: SESSION, error: "boom" },
      }),
      SESSION,
    );
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    const nextStream = streamPatch?.(initialWebuiStreamState);
    expect(nextStream?.status).toBe("error");
    expect(nextStream?.refusal).toBe("boom");
  });

  it("error with non-string payload.error → status:error, no refusal", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "session.error",
        payload: { sessionId: SESSION, error: { code: 1 } },
      }),
      SESSION,
    );
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    const nextStream = streamPatch?.(initialWebuiStreamState);
    expect(nextStream?.status).toBe("error");
    expect(nextStream?.refusal).toBeUndefined();
  });
});

describe("W2 · trace 3 · session.queue.updated → refresh-pending, no state", () => {
  it("emits exactly refresh-pending and leaves stream/sending untouched", () => {
    const before = makeState({
      stream: { ...initialWebuiStreamState, phase: "waiting" },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "session.queue.updated",
        payload: { sessionId: SESSION },
      }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual(["refresh-pending"]);
    expect(result.state.stream.phase).toBe("waiting");
    expect(findCommand(result.commands, "set-sending")).toBeUndefined();
  });
});

describe("W2 · trace 4 · permission.ask with malformed payload → zero commands", () => {
  it("emits no command when pendingPermissionFromEvent returns undefined", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "permission.ask",
        payload: { sessionId: SESSION }, // missing required keys
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
  });
});

describe("W2 · trace 5 · permission.resolved with non-string requestId STILL emits setStream", () => {
  it("non-string requestId leaves permissions untouched but flips stream to streaming", () => {
    const before = makeState({
      permissions: [PERMISSION],
      stream: { ...initialWebuiStreamState, phase: "waiting" },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "permission.resolved",
        payload: { sessionId: SESSION, requestId: 42 },
      }),
      SESSION,
    );
    expect(result.state.permissions).toEqual([PERMISSION]);
    expect(commandTypes(result.commands)).toEqual(["set-stream"]);
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    expect(streamPatch?.(initialWebuiStreamState)?.phase).toBe("streaming");
  });
});

describe("W2 · trace 6 · questionnaire.ask with malformed payload → zero commands", () => {
  it("emits no command when questionnaireFromEvent returns undefined", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "questionnaire.ask",
        payload: { sessionId: SESSION }, // missing payload.request
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
  });
});

describe("W2 · trace 7 · thread_goal.* without payload.goal → zero commands; upsert by id", () => {
  it("no payload.goal → zero commands", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "thread_goal.updated",
        payload: { sessionId: SESSION }, // missing payload.goal
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
  });

  it("with payload.goal upserts a message at thread-goal-{goalId}", () => {
    const goal = {
      goalId: "g-1",
      objective: "ship W2",
      status: "active",
      updatedAt: 100,
    };
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "thread_goal.objective_updated",
        payload: { sessionId: SESSION, goal },
      }),
      SESSION,
    );
    expect(findCommand(result.commands, "set-goal")?.goal).toEqual(goal);
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    const nextStream = streamPatch?.(initialWebuiStreamState);
    expect(nextStream?.messages.map((m) => m.id)).toEqual([
      "thread-goal-g-1",
    ]);
  });

  it("re-running with the same goalId replaces the existing message in place", () => {
    const firstGoal = {
      goalId: "g-1",
      objective: "first",
      status: "active",
      updatedAt: 1,
    };
    const secondGoal = { ...firstGoal, objective: "second", updatedAt: 2 };
    let state = makeState();
    state = reduceWebuiEffect(
      state,
      event({
        type: "thread_goal.objective_updated",
        payload: { sessionId: SESSION, goal: firstGoal },
      }),
      SESSION,
    ).state;
    state = reduceWebuiEffect(
      state,
      event({
        type: "thread_goal.objective_updated",
        payload: { sessionId: SESSION, goal: secondGoal },
      }),
      SESSION,
    ).state;
    expect(state.stream.messages).toHaveLength(1);
    expect(state.stream.messages[0]?.answer).toBe("second");
  });
});

describe("W2 · trace 8 · questionnaire.dismiss/superseded with mismatched id STILL emits setStream", () => {
  it("mismatched id: set-questionnaire emitted (no-op patch) + set-stream flips to streaming", () => {
    const before = makeState({
      questionnaire: QUESTIONNAIRE,
      stream: { ...initialWebuiStreamState, phase: "waiting" },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "questionnaire.dismiss",
        payload: { sessionId: SESSION, requestId: "different" },
      }),
      SESSION,
    );
    expect(result.state.questionnaire).toEqual(QUESTIONNAIRE);
    expect(commandTypes(result.commands)).toEqual([
      "set-questionnaire",
      "set-stream",
    ]);
    const streamPatch = findCommand(result.commands, "set-stream")?.patch;
    expect(streamPatch?.(initialWebuiStreamState)?.phase).toBe("streaming");
  });

  it("matching id clears the questionnaire AND flips stream to streaming", () => {
    const before = makeState({
      questionnaire: QUESTIONNAIRE,
      stream: { ...initialWebuiStreamState, phase: "waiting" },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "questionnaire.superseded",
        payload: { sessionId: SESSION, requestId: QUESTIONNAIRE.id },
      }),
      SESSION,
    );
    expect(result.state.questionnaire).toBeUndefined();
    expect(commandTypes(result.commands)).toEqual([
      "set-questionnaire",
      "set-stream",
    ]);
  });
});

describe("W2 · trace 9 · workspace progress reduces FIRST, then per-type dispatch", () => {
  it("reduces workspace progress for an unknown event type but no state writes", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "todo_updated",
        payload: {
          sessionId: SESSION,
          todos: [{ content: "t1", status: "in_progress" }],
        },
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
    expect(result.state.stream.workspaceProgress.todos).toEqual([
      { content: "t1", status: "in_progress" },
    ]);
  });

  it("workspace progress still rides along for cross-session events but per-type dispatch is skipped", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "todo_updated",
        payload: {
          sessionId: "other-session",
          todos: [{ content: "x", status: "pending" }],
        },
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
    expect(result.state.stream.workspaceProgress.todos).toEqual([
      { content: "x", status: "pending" },
    ]);
  });

  it("per-type dispatch runs AFTER workspace progress for in-session events", () => {
    // Pre-seed workspace progress with one todo, then fire a `session.start`
    // for the active session. The reducer writes both set-sending/set-stream
    // AND folds the new event into the workspace projection; the existing
    // todo survives.
    const seeded = reduceWebuiWorkspaceProgressEvent(
      initialWebuiWorkspaceProgress,
      {
        type: "todo_updated",
        sessionId: SESSION,
        todos: [{ content: "x", status: "pending" }],
      },
    );
    const before = makeState({
      stream: { ...initialWebuiStreamState, workspaceProgress: seeded },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "session.start",
        payload: { sessionId: SESSION },
      }),
      SESSION,
    );
    expect(findCommand(result.commands, "set-sending")?.sending).toBe(true);
    expect(result.state.stream.workspaceProgress.todos).toEqual([
      { content: "x", status: "pending" },
    ]);
  });
});

describe("W2 · trace 10 · cleanup-friendly behaviour (cancelled after async write)", () => {
  it("ignoring an event for a different session produces zero commands when workspace progress is unchanged", () => {
    const before = makeState({
      stream: { ...initialWebuiStreamState, phase: "streaming" },
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "session.start",
        payload: { sessionId: "other" },
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
    expect(result.state.stream.phase).toBe("streaming");
  });

  it("reducer is pure: applying the same event twice yields the same state", () => {
    const first = reduceWebuiEffect(
      makeState(),
      event({
        type: "permission.ask",
        payload: { ...PERMISSION },
      }),
      SESSION,
    );
    const second = reduceWebuiEffect(
      makeState(),
      event({
        type: "permission.ask",
        payload: { ...PERMISSION },
      }),
      SESSION,
    );
    expect(second.state.permissions).toEqual(first.state.permissions);
    expect(second.commands.length).toBe(first.commands.length);
  });
});