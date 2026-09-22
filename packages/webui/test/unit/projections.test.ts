import { describe, expect, it } from "vitest";
import { projectContextSnapshot } from "../../src/server/projections/context-snapshot.js";
import { reduceEvents } from "../../src/server/projections/index.js";
import { isTurnCompactionMessage, projectUsage } from "../../src/server/projections/usage.js";

describe("WebUI event projections", () => {
  it("projects compaction, permission and questionnaire events", () => {
    let state = reduceEvents(undefined, {
      type: "permission.ask",
      timestamp: 1,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "p1" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.ask",
      timestamp: 2,
      source: "fixture",
      payload: { sessionId: "s1", id: "q1" },
    });
    state = reduceEvents(state, {
      type: "session.compaction.completed",
      timestamp: 3,
      source: "fixture",
      payload: { sessionId: "s1" },
    });
    expect(state.permissions).toHaveLength(1);
    expect(state.questionnaire?.id).toBe("q1");
    expect(state.compaction?.state).toBe("completed");
  });

  it("resolves permission and questionnaire state", () => {
    let state = reduceEvents(undefined, {
      type: "permission.ask", timestamp: 1, source: "fixture", payload: { requestId: "p1" },
    });
    state = reduceEvents(state, {
      type: "permission.resolved", timestamp: 2, source: "fixture", payload: { requestId: "p1" },
    });
    expect(state.permissions).toEqual([]);
    state = reduceEvents(state, {
      type: "questionnaire.ask", timestamp: 3, source: "fixture", payload: { id: "q1" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.dismiss", timestamp: 4, source: "fixture", payload: { id: "q1" },
    });
    expect(state.questionnaire).toBeUndefined();
  });

  it("does not count compaction messages in usage", () => {
    expect(isTurnCompactionMessage({ role: "assistant", kind: "compaction", turnId: "t1" }, "t1")).toBe(true);
    expect(projectUsage([
      { role: "assistant", turnId: "t1", kind: "compaction", usage: { totalTokens: 100 } },
      { role: "assistant", turnId: "t1", usage: { totalTokens: 20, inputTokens: 10 } },
    ], "t1")).toEqual({ totalTokens: 20, inputTokens: 10 });
  });

  it("projects the latest context usage and compaction state", () => {
    expect(projectContextSnapshot({
      active: false,
      messages: [
        { kind: "compaction_start", timestamp: 1 },
        { kind: "compaction", timestamp: 2 },
        { rawJson: JSON.stringify({ contextUsage: { contextWindowTokens: 100, usedTokens: 40 } }) },
      ],
    })).toMatchObject({ status: "live", window: 100, usedTokens: 40, compaction: { state: "completed" } });
  });
});

