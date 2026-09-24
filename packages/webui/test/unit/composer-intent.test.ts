import { describe, expect, it } from "vitest";
import {
  isTurnLive,
  resolveWebuiSubmissionIntent,
  type WebuiSubmissionIntent,
} from "../../src/client/projection/composer-state.js";
import type { SlashCommandEntry } from "../../src/client/slash-palette.js";

/**
 * Pure-function tests for the composer submission intent resolver.
 *
 *   resolveWebuiSubmissionIntent(draft, commandMatch, goalMode) → intent
 *   isTurnLive(phase)                                         → boolean
 *
 * The resolver carries no side effects (no React, no setters, no draft
 * clearing). All the test fixtures here are therefore plain value shapes.
 *
 * The intent taxonomy is:
 *   1. activate-goal-mode  — bare `/goal`, not yet in goal mode
 *   2. submit-goal         — `/goal <objective>` or `goalMode + draft`
 *   3. run-command         — slash command in `WEBUI_RUN_COMMAND_NAMES`
 *   4. submit-turn         — default user-message path
 *   undefined              — empty draft with no slash and no goal mode
 *
 * These tests pin the dispatch order (rule 1 beats rule 2 beats rule 3 beats
 * rule 4), the no-op capability (rules 1–3 do not fire when not satisfied),
 * and the error-cleanup shape (the resolver never sets `interactionError`,
 * `sending`, or `commandRunning` — that is the executor's job; the resolver's
 * job is to emit the right kind).
 */

const goalCommand: SlashCommandEntry = {
  name: "goal",
  description: "open the goal workflow",
  section: "session",
  supported: true,
  detail: undefined,
};

const helpCommand: SlashCommandEntry = {
  name: "help",
  description: "show help",
  section: "session",
  supported: true,
  detail: undefined,
};

const disabledCommand: SlashCommandEntry = {
  name: "compact",
  description: "compact the session",
  section: "session",
  supported: false,
  detail: undefined,
};

const unknownCommand: SlashCommandEntry = {
  name: "totally-unknown",
  description: "outline only",
  section: "session",
  supported: true,
  detail: undefined,
};

const runCommandArgs = (overrides: {
  draft?: string;
  commandMatch?: SlashCommandEntry;
  commandInvocationName?: string;
  commandInvocationInput?: string;
  goalMode?: boolean;
}) =>
  ({
    draft: "",
    commandMatch: undefined,
    goalMode: false,
    ...overrides,
  }) as const;

describe("isTurnLive", () => {
  it("is true only for streaming / waiting / reconnecting", () => {
    expect(isTurnLive("streaming")).toBe(true);
    expect(isTurnLive("waiting")).toBe(true);
    expect(isTurnLive("reconnecting")).toBe(true);
  });

  it("is false for idle / done / refused / error / undefined", () => {
    expect(isTurnLive("idle")).toBe(false);
    expect(isTurnLive("done")).toBe(false);
    expect(isTurnLive("refused")).toBe(false);
    expect(isTurnLive("error")).toBe(false);
    expect(isTurnLive(undefined)).toBe(false);
  });
});

describe("resolveWebuiSubmissionIntent — path 1: activate-goal-mode", () => {
  it("fires for bare `/goal` while not in goal mode", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        goalMode: false,
      }),
    );
    expect(intent).toEqual({ kind: "activate-goal-mode" });
  });

  it("does NOT fire once goal mode is on (rule 1 must not beat rule 2)", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        goalMode: true,
      }),
    );
    // Rule 1's precondition `!goalMode` is false → fall through to rule 2.
    // Rule 2's `(goalMode || directGoalObjective) && (trimmedDraft ||
    // directGoalObjective)` is true (goal mode is on, the trim of the draft
    // is "/goal"), so rule 2 fires with the raw "/goal" as objective. The
    // submit path then calls `submitWebuiGoal({ objective: "/goal", … })`,
    // which is the same shape as the original implementation.
    expect(intent).toEqual({ kind: "submit-goal", objective: "/goal" });
  });

  it("does NOT fire when `/goal` carries an objective (rule 2 wins)", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal ship the release",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        commandInvocationInput: "ship the release",
        goalMode: false,
      }),
    );
    expect(intent).toEqual({
      kind: "submit-goal",
      objective: "ship the release",
    });
  });
});

describe("resolveWebuiSubmissionIntent — path 2: submit-goal", () => {
  it("fires for explicit `/goal <objective>` even when goal mode is off", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal prepare onboarding doc",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        commandInvocationInput: "prepare onboarding doc",
        goalMode: false,
      }),
    );
    expect(intent).toEqual({
      kind: "submit-goal",
      objective: "prepare onboarding doc",
    });
  });

  it("fires for goal-mode composer carrying a draft", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "outline the spec",
        commandMatch: undefined,
        goalMode: true,
      }),
    );
    expect(intent).toEqual({
      kind: "submit-goal",
      objective: "outline the spec",
    });
  });

  it("trims leading/trailing whitespace from the objective", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "   ship the release   ",
        commandMatch: undefined,
        goalMode: true,
      }),
    );
    expect(intent).toEqual({
      kind: "submit-goal",
      objective: "ship the release",
    });
  });

  it("does NOT fire when goal-mode is on but draft is empty (falls through to submit-turn)", () => {
    // An empty submit while in goal mode is the "click send without typing"
    // case; the resolver must NOT misclassify that as submit-goal (an empty
    // objective would create a goal with empty body).
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "",
        commandMatch: undefined,
        goalMode: true,
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });
});

describe("resolveWebuiSubmissionIntent — path 3: run-command", () => {
  it("fires for `/help` with no input", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/help",
        commandMatch: helpCommand,
        commandInvocationName: "help",
      }),
    );
    expect(intent?.kind).toBe("run-command");
    if (intent?.kind === "run-command") {
      expect(intent.command.name).toBe("help");
      expect(intent.input).toBeUndefined();
    }
  });

  it("fires for a runnable command carrying input", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/help me",
        commandMatch: helpCommand,
        commandInvocationName: "help",
        commandInvocationInput: "me",
      }),
    );
    expect(intent).toEqual({
      kind: "run-command",
      command: helpCommand,
      input: "me",
    });
  });

  it("does NOT fire for a `supported: false` command (rule 3 must fall through to rule 4)", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/compact",
        commandMatch: disabledCommand,
        commandInvocationName: "compact",
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });

  it("does NOT fire for an unknown command name (rule 3 narrows on the registry, not on shape)", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/totally-unknown do thing",
        commandMatch: unknownCommand,
        commandInvocationName: "totally-unknown",
        commandInvocationInput: "do thing",
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });
});

describe("resolveWebuiSubmissionIntent — path 4: submit-turn (default)", () => {
  it("fires for a plain user message with no slash and no goal mode", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "summarise the diff",
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });

  it("fires for whitespace-only drafts (the executor trims and short-circuits empty submits)", () => {
    // The resolver never returns undefined for any well-typed input — the
    // executor decides whether the trimmed draft is empty. This keeps the
    // resolver testable without a "should I send?" boolean.
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "   ",
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });
});

describe("resolveWebuiSubmissionIntent — dispatch order (rule 1 > 2 > 3 > 4)", () => {
  it("rule 1 wins over rule 2 for bare `/goal`", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        goalMode: false,
      }),
    );
    expect(intent?.kind).toBe("activate-goal-mode");
  });

  it("rule 2 wins over rule 3 for a `/goal <objective>` form", () => {
    // The `/goal <objective>` form would otherwise be classified by rule 3
    // because `goal` *is* in WEBUI_RUN_COMMAND_NAMES and `supported: true`.
    // The dispatch order guarantees that rule 2 fires first.
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal ship the release",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        commandInvocationInput: "ship the release",
      }),
    );
    expect(intent?.kind).toBe("submit-goal");
  });

  it("rule 3 wins over rule 4 for `/help`", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/help",
        commandMatch: helpCommand,
        commandInvocationName: "help",
      }),
    );
    expect(intent?.kind).toBe("run-command");
  });
});

describe("resolveWebuiSubmissionIntent — no-op capability (resolver never sets UI state)", () => {
  it("the intent value set has no `sending` / `goalSubmitting` / `commandRunning` keys", () => {
    // The resolver returns intent objects only. State setters belong in the
    // executor; the resolver must never leak them. Pin the shape here.
    const cases: ReadonlyArray<{
      readonly args: Parameters<typeof resolveWebuiSubmissionIntent>[0];
      readonly expected: WebuiSubmissionIntent | undefined;
    }> = [
      {
        args: runCommandArgs({
          draft: "/goal",
          commandMatch: goalCommand,
          commandInvocationName: "goal",
        }),
        expected: { kind: "activate-goal-mode" },
      },
      {
        args: runCommandArgs({
          draft: "/help",
          commandMatch: helpCommand,
          commandInvocationName: "help",
        }),
        expected: { kind: "run-command", command: helpCommand },
      },
      {
        args: runCommandArgs({ draft: "hello" }),
        expected: { kind: "submit-turn" },
      },
    ];
    for (const test of cases) {
      const intent = resolveWebuiSubmissionIntent(test.args);
      expect(intent).toEqual(test.expected);
      const keys = intent ? Object.keys(intent) : [];
      expect(keys).not.toContain("sending");
      expect(keys).not.toContain("goalSubmitting");
      expect(keys).not.toContain("commandRunning");
      expect(keys).not.toContain("interactionError");
    }
  });
});

describe("resolveWebuiSubmissionIntent — disabled command inputs do not fill the next rule's preconditions", () => {
  it("a `supported: false` `/compact` falls through to submit-turn, NOT to submit-goal", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/compact",
        commandMatch: disabledCommand,
        commandInvocationName: "compact",
      }),
    );
    expect(intent).toEqual({ kind: "submit-turn" });
  });

  it("the same draft parsed as `/goal <empty>` fires rule 1 (whitespace-only input is treated as no objective)", () => {
    const intent = resolveWebuiSubmissionIntent(
      runCommandArgs({
        draft: "/goal",
        commandMatch: goalCommand,
        commandInvocationName: "goal",
        commandInvocationInput: "   ",
      }),
    );
    // The parser surfaces "   " as `commandInvocationInput`; trim makes it
    // empty, so `directGoalObjective` is "" (falsy). Rule 1's
    // `!directGoalObjective` is true → activate-goal-mode fires, matching
    // the original behaviour where `"/goal "` and `"/goal"` both flip the
    // textarea into goal mode.
    expect(intent).toEqual({ kind: "activate-goal-mode" });
  });
});