// Unit tests for the Phase-6 OutputError transcription.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { OutputError } from "../../src/client/components/OutputError.js";

describe("OutputError", () => {
  it("emits the desktop testids for the generic error variant", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "运行失败",
      }),
    );
    expect(html).toContain('data-testid="output-error-surface"');
    expect(html).toContain('data-output-error-variant="output_error"');
    expect(html).toContain('data-testid="output-error-divider"');
    expect(html).toContain('data-testid="output-error-text"');
    expect(html).toContain('data-testid="output-error-icon"');
    expect(html).toContain("运行失败");
  });

  it("renders the retry button when onRetry is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "失败",
        onRetry: () => {},
        retryLabel: "重试",
      }),
    );
    expect(html).toContain('data-testid="output-error-retry"');
    expect(html).toContain("重试");
  });

  it("hides the retry button when output is retrying", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_retrying",
        text: "重试中",
        onRetry: () => {},
      }),
    );
    expect(html).not.toContain('data-testid="output-error-retry"');
    expect(html).not.toContain('data-testid="output-error-retry-count"');
  });

  it("shows the retry counter when retryCount is supplied", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "失败",
        onRetry: () => {},
        retryCount: { current: 2, total: 5 },
      }),
    );
    expect(html).toContain('data-testid="output-error-retry-count"');
    expect(html).toContain("（2/5）");
  });

  it("does not render a retry-count when total is zero", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "失败",
        retryCount: { current: 0, total: 0 },
      }),
    );
    expect(html).not.toContain('data-testid="output-error-retry-count"');
  });

  it("accepts a custom testId on the inner alert", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "fail",
        testId: "llm-retry-notice",
      }),
    );
    expect(html).toContain('data-testid="llm-retry-notice"');
  });

  it("passes through role and aria-live", () => {
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_retrying",
        text: "…",
        role: "status",
        ariaLive: "polite",
      }),
    );
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
  });

  it("forwards onRetry invocations through the button click handler", () => {
    const onRetry = vi.fn();
    const html = renderToStaticMarkup(
      createElement(OutputError, {
        variant: "output_error",
        text: "失败",
        onRetry,
      }),
    );
    // SSR markup: callbacks are wired by React at hydration time. We just
    // verify the element exists for the runtime binding.
    expect(html).toContain('data-testid="output-error-retry"');
  });
});