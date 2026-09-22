import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  projectContextSnapshot,
  projectUsage,
} from "../../src/server/projections/index.js";
import { reduceEvents } from "../../src/server/projections/index.js";
import { isTurnCompactionMessage } from "../../src/server/projections/usage.js";

interface CorpusFixture {
  readonly frame: { readonly eventJson: string };
  readonly expected: Record<string, unknown>;
}

function fixture(name: string): CorpusFixture {
  return JSON.parse(
    readFileSync(
      new URL(
        `../../../local-runtime-v2/test/fixtures/event-corpus/${name}.json`,
        import.meta.url,
      ),
      "utf8",
    ),
  ) as CorpusFixture;
}

function event(fixtureValue: CorpusFixture) {
  return JSON.parse(fixtureValue.frame.eventJson) as {
    readonly type: string;
    readonly timestamp: number;
    readonly source: string;
    readonly payload: Record<string, unknown>;
  };
}

describe("WebUI event projections", () => {
  it("consumes the shared corpus for compaction and interactions", () => {
    const ask = event(fixture("permission.ask"));
    const questionnaire = event(fixture("questionnaire.ask"));
    const compaction = event(fixture("compaction.completed"));
    let state = reduceEvents(undefined, ask);
    state = reduceEvents(state, questionnaire);
    state = reduceEvents(state, compaction);
    expect(state.sessions.s1?.permissions[0]?.requestId).toBe(
      fixture("permission.ask").expected.permissionRequestId,
    );
    expect(state.sessions.s1?.questionnaire?.requestId).toBe(
      fixture("questionnaire.ask").expected.questionnaireRequestId,
    );
    expect(state.compactionBySession.s1).toEqual(
      fixture("compaction.completed").expected.compaction,
    );
  });

  it("buckets interleaved permission and questionnaire state by session", () => {
    let state = reduceEvents(undefined, {
      type: "permission.ask",
      timestamp: 1,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "p1" },
    });
    state = reduceEvents(state, {
      type: "permission.ask",
      timestamp: 2,
      source: "fixture",
      payload: { sessionId: "s2", requestId: "p2" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.ask",
      timestamp: 3,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "q1" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.ask",
      timestamp: 4,
      source: "fixture",
      payload: { sessionId: "s2", requestId: "q2" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.dismiss",
      timestamp: 5,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "q1" },
    });
    expect(state.sessions.s1?.permissions).toHaveLength(1);
    expect(state.sessions.s2?.permissions).toHaveLength(1);
    expect(state.sessions.s1?.questionnaire).toBeUndefined();
    expect(state.sessions.s2?.questionnaire?.requestId).toBe("q2");
  });

  it("drops session-less interaction events and ignores mismatched dismissals", () => {
    let state = reduceEvents(undefined, {
      type: "permission.ask",
      timestamp: 1,
      source: "fixture",
      payload: { requestId: "orphan" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.ask",
      timestamp: 2,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "q1" },
    });
    state = reduceEvents(state, {
      type: "questionnaire.dismiss",
      timestamp: 3,
      source: "fixture",
      payload: { sessionId: "s1", requestId: "other" },
    });
    expect(state.sessions).toEqual({
      s1: { permissions: [], questionnaire: { sessionId: "s1", requestId: "q1" } },
    });
  });

  it("projects usage from completed message fixtures, not a wire event", () => {
    const messages = [
      {
        role: "assistant",
        turnId: "t1",
        kind: "compaction",
        usage: { totalTokens: 100 },
      },
      {
        role: "assistant",
        turnId: "t1",
        usage: { totalTokens: 20, inputTokens: 10 },
      },
    ];
    expect(
      isTurnCompactionMessage(
        { role: "assistant", kind: "compaction", turnId: "t1" },
        "t1",
      ),
    ).toBe(true);
    expect(
      projectUsage(
        messages,
        "t1",
      ),
    ).toEqual({ totalTokens: 20, inputTokens: 10 });
  });

  it("projects the latest context usage and compaction state", () => {
    expect(
      projectContextSnapshot({
        active: false,
        messages: [
          { kind: "compaction_start", timestamp: 1 },
          { kind: "compaction", timestamp: 2 },
          {
            rawJson: JSON.stringify({
              contextUsage: { contextWindowTokens: 100, usedTokens: 40 },
            }),
          },
        ],
      }),
    ).toMatchObject({
      status: "live",
      window: 100,
      usedTokens: 40,
      compaction: { state: "completed" },
    });
  });
});
