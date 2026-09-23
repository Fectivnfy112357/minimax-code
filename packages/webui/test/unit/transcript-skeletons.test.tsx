// Unit tests for the Phase-6 TranscriptSkeletons transcription.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  ChatSkeleton,
  GreetingSkeleton,
} from "../../src/client/components/TranscriptSkeletons.js";

function countByClass(html: string, className: string): number {
  const re = new RegExp(`class="[^"]*\\b${className}\\b`, "g");
  return html.match(re)?.length ?? 0;
}

describe("TranscriptSkeletons", () => {
  it("ChatSkeleton emits the desktop testid and the centred column", () => {
    const html = renderToStaticMarkup(createElement(ChatSkeleton));
    expect(html).toContain('data-testid="chat-skeleton"');
    expect(html).toContain("max-w-[768px] mx-auto");
    expect(html).toContain("animate-shimmer");
  });

  it("ChatSkeleton uses the desktop line widths (8 primary + 4 secondary)", () => {
    const html = renderToStaticMarkup(createElement(ChatSkeleton));
    // Eight 22px bars in the primary block, four 24px bars in the secondary
    // block (Desktop `i` array has 8 entries, `l` array has 4).
    expect(countByClass(html, "animate-shimmer")).toBe(13);
    expect((html.match(/height:22px/g) ?? []).length).toBe(8);
    expect((html.match(/height:24px/g) ?? []).length).toBe(4);
  });

  it("GreetingSkeleton uses the rounded-40 avatar instead of the user bubble", () => {
    const html = renderToStaticMarkup(createElement(GreetingSkeleton));
    expect(html).toContain('data-testid="greeting-skeleton"');
    expect(html).toContain("max-w-[768px] mx-auto");
    // The avatar uses `border-radius:9999px` (full circle). React serialises
    // numeric pixels with units.
    expect(html).toContain("border-radius:9999px");
  });

  it("Both skeletons apply the gradient mask to the secondary block", () => {
    const chat = renderToStaticMarkup(createElement(ChatSkeleton));
    const greeting = renderToStaticMarkup(createElement(GreetingSkeleton));
    for (const html of [chat, greeting]) {
      expect(html).toContain("mask-image:linear-gradient(180deg");
      expect(html).toContain("transparent 100%)");
    }
  });
});
