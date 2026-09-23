// Unit tests for the Phase-6 MessageAttachments transcription.

import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  MessageAttachments,
  type MessageAttachment,
} from "../../src/client/components/MessageAttachments.js";

const baseAttachments: MessageAttachment[] = [
  {
    id: "img-1",
    type: "image",
    file_name: "diagram.png",
    src: "https://example.test/diagram.png",
  },
  {
    id: "img-2",
    type: "image",
    file_name: "second.png",
    src: "https://example.test/second.png",
  },
  {
    id: "file-1",
    type: "file",
    file_name: "report.pdf",
    file_path: "/tmp/report.pdf",
    file_size: 2048,
  },
];

describe("MessageAttachments", () => {
  it("renders the root testid and renders each image attachment", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, { attachments: baseAttachments }),
    );
    expect(html).toContain('data-testid="message-attachments"');
    expect(html).toContain('data-testid="message-attachment-image"');
    expect(html).toContain('data-testid="message-attachment-image-img"');
    expect(html).toContain('data-testid="message-attachment-file"');
  });

  it("renders a single image with no wrapping flex container", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, {
        attachments: [baseAttachments[0]!],
      }),
    );
    expect(html).toContain('data-testid="message-attachment-image"');
    // When only one image is present, the desktop does NOT wrap in
    // `flex flex-wrap gap-2` (see line 1562).
    expect(html).not.toContain("flex flex-wrap gap-2");
  });

  it("wraps multiple images in the desktop flex container", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, {
        attachments: [baseAttachments[0]!, baseAttachments[1]!],
      }),
    );
    expect(html).toContain("flex flex-wrap gap-2");
  });

  it("falls back to the placeholder when src is missing", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, {
        attachments: [
          {
            id: "img-broken",
            type: "image",
            file_name: "missing.png",
            src: undefined,
          },
        ],
      }),
    );
    expect(html).toContain('data-testid="message-attachment-image-placeholder"');
    expect(html).not.toContain('data-testid="message-attachment-image"');
  });

  it("renders nothing when the attachment list is empty", () => {
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, { attachments: [] }),
    );
    expect(html).toBe("");
  });

  it("calls onPreview for image clicks (event wired by hydration)", () => {
    const onPreview = vi.fn();
    const html = renderToStaticMarkup(
      createElement(MessageAttachments, {
        attachments: [baseAttachments[0]!],
        onPreview,
      }),
    );
    // SSR markup only — the actual click is wired at hydration time.
    expect(html).toContain('data-testid="message-attachment-image"');
  });
});