// W0 safety net — SSR markup fixtures for the components the refactor moves.
//
// Scope: the five exported components that no existing test renders at all.
// W0 measured the coverage and found these five with zero SSR assertions
// anywhere in the suite, while the other fourteen already have them (mostly in
// `webui-shell.test.ts` and `webui-round3-acceptance.test.tsx`). Duplicating the
// covered ones would add noise, not evidence, so this file fills exactly the
// gap. Shell-level session switching is already asserted in
// `webui-shell.test.ts` and is deliberately not repeated here.
//
// The assertions are structural — `data-testid`, `aria-*`, `role`, and the
// presence of the copy the desktop renders — not whole-HTML equality. A whole
// string snapshot would fail on every unrelated whitespace change and would
// fossilise the current output, including its bugs.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  WebuiFeedbackActions,
  WebuiMessageActionButton,
} from "../../src/client/components/MessageActions.js";
import { WebuiQuestionnaireResponse } from "../../src/client/components/SessionTranscript.js";
import {
  WebuiActivityGroup,
  WebuiTurnProcess,
} from "../../src/client/components/TranscriptPrimitives.js";

const READ_TOOL = { tool_call_name: "read", tool_call_args: "README.md" };
const EDIT_TOOL = {
  tool_call_name: "edit_file",
  tool_call_args: JSON.stringify({ file_path: "src/app.ts" }),
  tool_call_result_data:
    "--- a/src/app.ts\n+++ b/src/app.ts\n+one\n+two\n-zero\n",
};

function render(element: Parameters<typeof renderToStaticMarkup>[0]): string {
  return renderToStaticMarkup(element);
}

describe("W0 · SSR · WebuiActivityGroup", () => {
  it("renders nothing for an empty tool list", () => {
    expect(
      render(createElement(WebuiActivityGroup, { tools: [] })),
    ).toBe("");
  });

  it("renders the disclosure with a non-empty summary", () => {
    const html = render(
      createElement(WebuiActivityGroup, { tools: [READ_TOOL] }),
    );

    expect(html).toContain('data-testid="activity-group"');
    expect(html).toContain("activity-group-summary");
    expect(html).toContain("activity-group-icon");
    expect(html).toContain("activity-group-chevron");
    expect(html).toContain("timeline-spine");
    expect(html).not.toContain('data-streaming="true"');

    const summary = html.match(
      /<span class="activity-group-summary">([^<]*)<\/span>/u,
    );
    expect(summary?.[1]?.length ?? 0).toBeGreaterThan(0);
  });

  it("marks a streaming group and opens it by default", () => {
    const html = render(
      createElement(WebuiActivityGroup, {
        tools: [READ_TOOL],
        streaming: true,
      }),
    );

    expect(html).toContain('data-streaming="true"');
    expect(html).toContain("open");
  });

  it("routes edit tools into the diff card branch", () => {
    const withEdits = render(
      createElement(WebuiActivityGroup, { tools: [EDIT_TOOL, READ_TOOL] }),
    );
    expect(withEdits).toContain("webui-diff-card");
    expect(withEdits).toContain("已编辑 1 个文件");

    const authoritative = render(
      createElement(WebuiActivityGroup, {
        tools: [EDIT_TOOL, READ_TOOL],
        authoritativeDiffAvailable: true,
      }),
    );
    expect(authoritative).not.toContain("webui-diff-card");
    expect(authoritative).toContain("webui-tool-list");
  });
});

describe("W0 · SSR · WebuiTurnProcess", () => {
  const child = createElement("span", { "data-testid": "turn-child" }, "detail");

  it("opens the live form and counts seconds while the turn runs", () => {
    const html = render(
      createElement(WebuiTurnProcess, { active: true, children: child }),
    );

    expect(html).toContain('data-testid="turn-process-disclosure"');
    expect(html).toContain('data-testid="turn-process-summary"');
    expect(html).toContain('data-testid="turn-process-summary-text"');
    expect(html).toContain('data-testid="turn-process-separator"');
    expect(html).toContain('data-testid="turn-process-detail"');
    expect(html).toContain('data-summary-text="已执行 0 秒"');
    expect(html).toContain('aria-expanded="true"');
    // The live form never shows the finished-turn output rate.
    expect(html).not.toContain('data-testid="turn-output-rate"');
  });

  it("collapses the finished form and derives the output rate", () => {
    const html = render(
      createElement(WebuiTurnProcess, {
        active: false,
        startedAtMs: 1_000,
        endedAtMs: 4_000,
        requestDurationMs: 3_000,
        tokenCount: 300,
        children: child,
      }),
    );

    expect(html).toContain('data-summary-text="共执行 3 秒 · 100 token/s"');
    expect(html).toContain('data-testid="turn-output-rate"');
    expect(html).toContain("输出速度 : 100 token/s");
    expect(html).toContain('aria-expanded="false"');
    // Collapsed: the children are not in the markup at all.
    expect(html).not.toContain('data-testid="turn-process-detail"');
    expect(html).not.toContain("turn-child");
  });

  it("falls back to the wall-clock span and then to zero seconds", () => {
    const wallClock = render(
      createElement(WebuiTurnProcess, {
        active: false,
        wallClockDurationMs: 90_000,
        children: child,
      }),
    );
    expect(wallClock).toContain('data-summary-text="共执行 1 分 30 秒"');

    const unknown = render(
      createElement(WebuiTurnProcess, { active: false, children: child }),
    );
    expect(unknown).toContain('data-summary-text="共执行 0 秒"');
  });
});

describe("W0 · SSR · WebuiMessageActionButton", () => {
  const icon = createElement("span", null, "i");

  it("renders the desktop's glyph-only action button", () => {
    const html = render(
      createElement(WebuiMessageActionButton, {
        testId: "w0-action",
        label: "赞",
        icon,
        onClick: () => undefined,
      }),
    );

    expect(html).toContain('data-testid="w0-action"');
    expect(html).toContain('aria-label="赞"');
    expect(html).toContain('title="赞"');
    expect(html).toContain('type="button"');
    expect(html).toContain('class="webui-message-action"');
    // No selection state is passed, so the toggle must not claim one.
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("webui-message-action-active");
  });

  it("carries the selection and disabled states through", () => {
    const html = render(
      createElement(WebuiMessageActionButton, {
        testId: "w0-action",
        label: "踩",
        icon,
        onClick: () => undefined,
        active: true,
        disabled: true,
      }),
    );

    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("webui-message-action-active");
    expect(html).toContain("disabled");
  });
});

describe("W0 · SSR · WebuiFeedbackActions", () => {
  it("renders both toggles unselected by default", () => {
    const html = render(
      createElement(WebuiFeedbackActions, { onChange: () => undefined }),
    );

    expect(html).toContain('data-testid="message-feedback-actions"');
    expect(html).toContain('data-testid="message-feedback-like"');
    expect(html).toContain('data-testid="message-feedback-dislike"');
    expect(html).toContain('data-testid="message-feedback-like-action"');
    expect(html).toContain('data-testid="message-feedback-dislike-action"');
    expect(html.match(/aria-pressed="false"/gu)).toHaveLength(2);
  });

  it("marks the selected side only", () => {
    const liked = render(
      createElement(WebuiFeedbackActions, {
        value: "like",
        onChange: () => undefined,
      }),
    );
    expect(liked.match(/aria-pressed="true"/gu)).toHaveLength(1);
    expect(liked).toContain('aria-label="赞"');

    const disliked = render(
      createElement(WebuiFeedbackActions, {
        value: "dislike",
        onChange: () => undefined,
      }),
    );
    expect(disliked.match(/aria-pressed="true"/gu)).toHaveLength(1);
  });
});

describe("W0 · SSR · WebuiQuestionnaireResponse", () => {
  it("renders only the meta fields the summary actually carries", () => {
    const html = render(
      createElement(WebuiQuestionnaireResponse, {
        messageId: "message-1",
        summary: { requestId: "request-1", answers: [] },
      }),
    );

    expect(html).toContain('data-webui-questionnaire-history="true"');
    expect(html).toContain('data-message-id="message-1"');
    expect(html).toContain('data-webui-questionnaire-request="request-1"');
    expect(html).toContain('data-testid="questionnaire-history-request-1"');
    expect(html).toContain('data-testid="questionnaire-history-label"');
    expect(html).toContain("问卷回答");
    expect(html).toContain('data-testid="questionnaire-history-meta-requestId"');
    // Absent fields must not render their rows at all.
    expect(html).not.toContain("questionnaire-history-meta-schema");
    expect(html).not.toContain("questionnaire-history-meta-submitted");
    expect(html).not.toContain("questionnaire-history-meta-mode");
    expect(html).not.toContain("questionnaire-history-meta-source");
    expect(html).not.toContain("questionnaire-history-meta-feature-key");
    expect(html).not.toContain('data-testid="questionnaire-history-timestamp"');
  });

  it("renders every carried meta field and each answer in order", () => {
    const html = render(
      createElement(WebuiQuestionnaireResponse, {
        messageId: "message-1",
        timestamp: 1_758_000_000_000,
        summary: {
          requestId: "request-1",
          schemaVersion: "2",
          submittedAt: "2026-09-23T00:00:00.000Z",
          mode: "single",
          source: "tool",
          featureKey: "onboarding",
          answers: [
            { question: "选哪个方案？", labels: ["方案 A", "方案 B"] },
            { question: "补充说明", labels: ["无"] },
          ],
        },
      }),
    );

    for (const field of [
      "schema",
      "submitted",
      "mode",
      "source",
      "feature-key",
    ])
      expect(html).toContain(`data-testid="questionnaire-history-meta-${field}"`);

    expect(html).toContain('data-testid="questionnaire-history-answers"');
    expect(html).toContain('data-testid="questionnaire-history-answer-0"');
    expect(html).toContain('data-testid="questionnaire-history-answer-1"');
    expect(html).toContain("选哪个方案？");
    expect(html).toContain("补充说明");
    expect(html).toContain('data-testid="questionnaire-history-answer-0-label-0"');
    expect(html).toContain('data-testid="questionnaire-history-answer-0-label-1"');
    expect(html).toContain("方案 A");
    expect(html).toContain("方案 B");
    expect(html).toContain('data-testid="questionnaire-history-timestamp"');

    // Answer order is the response's order, not a re-sorted one.
    expect(html.indexOf("选哪个方案？")).toBeLessThan(
      html.indexOf("补充说明"),
    );
  });

  it("falls back for a missing request id", () => {
    const html = render(
      createElement(WebuiQuestionnaireResponse, {
        messageId: "message-1",
        summary: { requestId: "", answers: [] },
      }),
    );

    expect(html).toContain("(未提供)");
  });
});
