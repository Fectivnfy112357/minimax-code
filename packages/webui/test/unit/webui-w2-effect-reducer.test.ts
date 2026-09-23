// W2 trace tests — exercise `reduceWebuiEffect` against the 10 behaviours
// enumerated in `refactor-recon/w0-baseline/effect-inventory.md §"W2 抽取时
// 必须覆盖的 trace 断言"`, plus the W2.9 contract that (a) the session
// guard runs FIRST, (b) the progress write is ALWAYS the first command
// once the guard passes, and (c) cross-session events produce zero
// commands (same state identity returned, no progress touched).
//
// Each `describe` block corresponds to one trace. The fixtures are written
// against the *event* shape the runtime hands the client, and every
// expected value is spelled out here rather than derived from an
// implementation constant, so a change on either side fails the test.
//
// Trace 9 (workspace-progress-first) is intentionally written to FAIL
// when the progress command is moved to the back of the array — see the
// mutation-test note in §3 of `brief-w2.9-wire-reducer.md`. Trace 10
// covers reducer purity and cross-session rejection; cleanup-friendly
// behaviour (the `cancelled = true` path) is not asserted here, by
// design.

import { describe, it, expect } from "vitest";

import {
  applyWebuiEffectCommands,
  initialWebuiEffectState,
  reduceWebuiEffect,
  type WebuiEffectCommand,
  type WebuiEffectHandlers,
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

describe("W2.9 · guard contract · session gate runs before any state write", () => {
  it("cross-session event returns same state identity and an empty command list", () => {
    const before = makeState({
      stream: { ...initialWebuiStreamState, phase: "streaming" },
      permissions: [PERMISSION],
    });
    const result = reduceWebuiEffect(
      before,
      event({
        type: "session.start",
        payload: { sessionId: "different-session" },
      }),
      SESSION,
    );
    expect(result.commands).toEqual([]);
    // Same object identity — the reducer did NOT touch the stream slice
    // and therefore did NOT call reduceWebuiWorkspaceProgressEvent.
    expect(result.state).toBe(before);
    expect(result.state.permissions).toBe(before.permissions);
  });
});

describe("W2 · trace 1 · session.start emits sending+streaming in order", () => {
  it("returns set-stream(progress) then set-sending(true) then set-stream{phase:streaming}", () => {
    const state = makeState();
    const result = reduceWebuiEffect(
      state,
      event({ type: "session.start", payload: { sessionId: SESSION } }),
      SESSION,
    );
    // First command is the unconditional progress write.
    expect(commandTypes(result.commands)).toEqual([
      "set-stream",
      "set-sending",
      "set-stream",
    ]);
    expect(findCommand(result.commands, "set-sending")?.sending).toBe(true);
    // The second set-stream patch lands phase:streaming.
    const phasePatch = result.commands[2];
    expect(phasePatch?.type).toBe("set-stream");
    if (phasePatch?.type === "set-stream") {
      const nextStream = phasePatch.patch(initialWebuiStreamState);
      expect(nextStream.phase).toBe("streaming");
    }
    // The first set-stream patch is the workspace-progress write.
    const progressPatch = result.commands[0];
    expect(progressPatch?.type).toBe("set-stream");
    if (progressPatch?.type === "set-stream") {
      const nextStream = progressPatch.patch(initialWebuiStreamState);
      expect(nextStream.workspaceProgress).toBeDefined();
    }
  });
});

describe("W2 · trace 2 · session.finish/abort/error map to status + refusal", () => {
  it("finish → status:finished, refusal untouched when payload.error absent", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.finish", payload: { sessionId: SESSION } }),
      SESSION,
    );
    // progress write + sending(false) + status patch.
    expect(commandTypes(result.commands)).toEqual([
      "set-stream",
      "set-sending",
      "set-stream",
    ]);
    expect(findCommand(result.commands, "set-sending")?.sending).toBe(false);
    const finalStream = result.state.stream;
    expect(finalStream.phase).toBe("done");
    expect(finalStream.status).toBe("finished");
    expect(finalStream.refusal).toBeUndefined();
  });

  it("abort → status:aborted", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.abort", payload: { sessionId: SESSION } }),
      SESSION,
    );
    expect(result.state.stream.status).toBe("aborted");
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
    expect(result.state.stream.status).toBe("error");
    expect(result.state.stream.refusal).toBe("boom");
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
    expect(result.state.stream.status).toBe("error");
    expect(result.state.stream.refusal).toBeUndefined();
  });
});

describe("W2 · trace 3 · session.queue.updated → refresh-pending", () => {
  it("emits progress write + refresh-pending", () => {
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
    expect(commandTypes(result.commands)).toEqual([
      "set-stream",
      "refresh-pending",
    ]);
    expect(result.state.stream.phase).toBe("waiting");
  });
});

describe("W2 · trace 4 · permission.ask with malformed payload → only progress command", () => {
  it("emits just the progress write when pendingPermissionFromEvent returns undefined", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "permission.ask",
        payload: { sessionId: SESSION }, // missing required keys
      }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual(["set-stream"]);
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
    // progress write + phase:streaming.
    expect(commandTypes(result.commands)).toEqual([
      "set-stream",
      "set-stream",
    ]);
    const finalStream = result.state.stream;
    expect(finalStream.phase).toBe("streaming");
  });
});

describe("W2 · trace 6 · questionnaire.ask with malformed payload → only progress command", () => {
  it("emits just the progress write when questionnaireFromEvent returns undefined", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "questionnaire.ask",
        payload: { sessionId: SESSION }, // missing payload.request
      }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual(["set-stream"]);
  });
});

describe("W2 · trace 7 · thread_goal.* without payload.goal → only progress; upsert by id", () => {
  it("no payload.goal → only the progress write", () => {
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "thread_goal.updated",
        payload: { sessionId: SESSION }, // missing payload.goal
      }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual(["set-stream"]);
  });

  it("with payload.goal: progress + set-goal + upsert patch in that order", () => {
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
    expect(commandTypes(result.commands)).toEqual([
      "set-stream",
      "set-goal",
      "set-stream",
    ]);
    expect(findCommand(result.commands, "set-goal")?.goal).toEqual(goal);
    expect(result.state.stream.messages.map((m) => m.id)).toEqual([
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
  it("mismatched id: progress + set-questionnaire(no-op patch) + set-stream flips to streaming", () => {
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
      "set-stream",
      "set-questionnaire",
      "set-stream",
    ]);
    expect(result.state.stream.phase).toBe("streaming");
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
      "set-stream",
      "set-questionnaire",
      "set-stream",
    ]);
    expect(result.state.stream.phase).toBe("streaming");
  });
});

describe("W2 · trace 9 · progress is ALWAYS the first command when the guard passes", () => {
  it("cross-session event: guard rejects, zero commands, same state", () => {
    // Cross-session events no longer touch progress. The previous W2
    // design wrote the progress slice first; this rewrite enforces the
    // original closure's order (guard first, state never touched on
    // mismatch). The trace asserts that.
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
    expect(result.state).toBe(before);
  });

  it("in-session session.start: commands[0] is the progress write (fails if swapped to last)", () => {
    // This assertion is the mutation test: push the progress write to
    // the back of `commands` in `reduceWebuiEffect` and this test goes
    // red. See brief-w2.9-wire-reducer.md §3 for the procedure.
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "session.start",
        payload: { sessionId: SESSION },
      }),
      SESSION,
    );
    const first = result.commands[0];
    expect(first?.type).toBe("set-stream");
    if (first?.type === "set-stream") {
      // The first patch is the workspace-progress write. The patch
      // spreads the input, so we assert that the new progress slice is
      // present, but more importantly we assert that the *resulting*
      // workspace progress slice matches what the reducer computed —
      // swapping the patches puts a different slice here.
      const next = first.patch({
        ...initialWebuiStreamState,
        phase: "PREVIOUSLY_STREAMING",
      });
      expect(next.workspaceProgress).toEqual(
        result.state.stream.workspaceProgress,
      );
      // And the previous phase survives unchanged (the patch only
      // touches workspaceProgress).
      expect(next.phase).toBe("PREVIOUSLY_STREAMING");
    }
    const last = result.commands[result.commands.length - 1];
    expect(last?.type).toBe("set-stream");
    if (last?.type === "set-stream") {
      // The phase write is the last set-stream command.
      const next = last.patch({
        ...initialWebuiStreamState,
        workspaceProgress: result.state.stream.workspaceProgress,
      });
      expect(next.phase).toBe("streaming");
    }
  });

  it("in-session unknown event: commands[0] is still the progress write (no early bail-out)", () => {
    const before = makeState();
    const result = reduceWebuiEffect(
      before,
      event({
        type: "todo_updated",
        payload: {
          sessionId: SESSION,
          todos: [{ content: "t1", status: "in_progress" }],
        },
      }),
      SESSION,
    );
    expect(commandTypes(result.commands)).toEqual(["set-stream"]);
    expect(result.state.stream.workspaceProgress.todos).toEqual([
      { content: "t1", status: "in_progress" },
    ]);
  });

  it("in-session session.start after a seeded todo: progress write absorbs new state", () => {
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
    // The seeded `x` todo survives — the new event adds nothing new
    // but the slice gets replaced with a (logically equal) fresh object.
    expect(result.state.stream.workspaceProgress.todos).toEqual([
      { content: "x", status: "pending" },
    ]);
  });
});

describe("W2 · trace 10 · reducer purity + cross-session rejection (no cleanup path)", () => {
  it("reducer is pure: applying the same event twice yields the same state and commands", () => {
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
    expect(second.state.stream).toEqual(first.state.stream);
    expect(second.commands.length).toBe(first.commands.length);
  });

  it("cross-session rejection: state identity preserved even when a deep field would change", () => {
    const before = makeState({
      permissions: [PERMISSION],
      stream: {
        ...initialWebuiStreamState,
        workspaceProgress: reduceWebuiWorkspaceProgressEvent(
          initialWebuiWorkspaceProgress,
          { type: "session.start" },
        ),
      },
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
    expect(result.state).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * Executor tests — `applyWebuiEffectCommands` walks the command list
 * against a handler bag and calls each setter. The point is to lock down
 * the order: handlers fire in the order the reducer produces them, with
 * no reordering, skipping, or batching.
 * ------------------------------------------------------------------------ */

describe("W2.9 · executor · applyWebuiEffectCommands walks commands in order", () => {
  function makeCapturingHandlers(): WebuiEffectHandlers & {
    calls: { type: string; payload: unknown }[];
  } {
    const calls: { type: string; payload: unknown }[] = [];
    const record = (type: string) => (payload: unknown) =>
      calls.push({ type, payload });
    return {
      calls,
      refreshPending: record("refreshPending") as () => void,
      setSending: record("setSending") as (sending: boolean) => void,
      setStream: record("setStream") as (
        patch: (current: WebuiStreamState) => WebuiStreamState,
      ) => void,
      setPermissions: record("setPermissions") as (
        patch: (
          current: readonly WebuiPendingPermission[],
        ) => readonly WebuiPendingPermission[],
      ) => void,
      setQuestionnaire: record("setQuestionnaire") as (
        patch: (
          current: WebuiQuestionnaireRequest | undefined,
        ) => WebuiQuestionnaireRequest | undefined,
      ) => void,
      setGoal: record("setGoal") as (goal: WebuiGoal | undefined) => void,
    };
  }

  it("session.start handlers fire in the order progress → set-sending → phase-stream", () => {
    const handlers = makeCapturingHandlers();
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.start", payload: { sessionId: SESSION } }),
      SESSION,
    );
    applyWebuiEffectCommands(result.commands, handlers);
    expect(handlers.calls.map((c) => c.type)).toEqual([
      "setStream",
      "setSending",
      "setStream",
    ]);
  });

  it("set-sending passes the boolean value, not a patch", () => {
    const handlers = makeCapturingHandlers();
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.start", payload: { sessionId: SESSION } }),
      SESSION,
    );
    applyWebuiEffectCommands(result.commands, handlers);
    expect(handlers.calls[1]).toEqual({ type: "setSending", payload: true });
  });

  it("set-stream passes the patch function itself (functional updater)", () => {
    const handlers = makeCapturingHandlers();
    const result = reduceWebuiEffect(
      makeState(),
      event({ type: "session.start", payload: { sessionId: SESSION } }),
      SESSION,
    );
    applyWebuiEffectCommands(result.commands, handlers);
    expect(typeof handlers.calls[0]?.payload).toBe("function");
  });

  it("refresh-pending is called even when it returns a rejecting promise", async () => {
    let calls = 0;
    const handlers: WebuiEffectHandlers = {
      refreshPending: () => {
        calls += 1;
        return Promise.reject(new Error("boom"));
      },
      setSending: () => undefined,
      setStream: () => undefined,
      setPermissions: () => undefined,
      setQuestionnaire: () => undefined,
      setGoal: () => undefined,
    };
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "session.queue.updated",
        payload: { sessionId: SESSION },
      }),
      SESSION,
    );
    applyWebuiEffectCommands(result.commands, handlers);
    expect(calls).toBe(1);
    // Wait a tick to let the rejection settle; the executor must have
    // attached a catch handler that swallows it.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toBe(1);
  });

  it("set-goal is invoked with the value, not a patch function", () => {
    const handlers = makeCapturingHandlers();
    const goal = {
      goalId: "g-1",
      objective: "ship",
      status: "active",
      updatedAt: 1,
    };
    const result = reduceWebuiEffect(
      makeState(),
      event({
        type: "thread_goal.objective_updated",
        payload: { sessionId: SESSION, goal },
      }),
      SESSION,
    );
    applyWebuiEffectCommands(result.commands, handlers);
    expect(handlers.calls).toContainEqual({ type: "setGoal", payload: goal });
  });

  it("empty command list is a no-op", () => {
    const handlers = makeCapturingHandlers();
    applyWebuiEffectCommands([], handlers);
    expect(handlers.calls).toEqual([]);
  });
});