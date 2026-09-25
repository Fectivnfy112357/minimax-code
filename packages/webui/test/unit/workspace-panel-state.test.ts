import { describe, expect, it } from "vitest";
import { parseWebuiMessageFileReference } from "../../src/client/projection/message-file-reference.js";
import { WebuiMarkdown } from "../../src/client/markdown.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { initialWorkspacePanelState, reduceWorkspacePanelState } from "../../src/client/projection/workspace-panel-state.js";
import { focusWebuiFileLine, webuiFileLineTargetId } from "../../src/client/projection/file-line-navigation.js";

describe("right workspace panel navigation", () => {
  it("keeps one active view while opening, switching and closing tabs", () => {
    let state = initialWorkspacePanelState;
    state = reduceWorkspacePanelState(state, { type: "open-tab", kind: "files", sessionId: "s1", workspaceDir: "/a" });
    const filesTab = state.activeTabId;
    state = reduceWorkspacePanelState(state, { type: "open-file", sessionId: "s1", workspaceDir: "/a", path: "src/index.ts", lineStart: 42 });
    const fileTab = state.activeTabId;
    expect(state.open).toBe(true);
    expect(state.tabs).toHaveLength(2);
    expect(state.tabs.find((tab) => tab.id === fileTab)).toMatchObject({ kind: "file-preview", path: "src/index.ts", lineStart: 42 });
    state = reduceWorkspacePanelState(state, { type: "select-tab", tabId: filesTab! });
    expect(state.activeTabId).toBe(filesTab);
    state = reduceWorkspacePanelState(state, { type: "close-tab", tabId: filesTab! });
    expect(state.activeTabId).toBe(fileTab);
    state = reduceWorkspacePanelState(state, { type: "close-tab", tabId: fileTab! });
    expect(state.open).toBe(false);
    expect(state.tabs).toEqual([]);
  });

  it("isolates identical relative files by session and workspace and rejects traversal", () => {
    let state = initialWorkspacePanelState;
    state = reduceWorkspacePanelState(state, { type: "open-file", sessionId: "s1", workspaceDir: "/a", path: "index.ts" });
    state = reduceWorkspacePanelState(state, { type: "open-file", sessionId: "s2", workspaceDir: "/b", path: "index.ts" });
    expect(state.tabs).toHaveLength(2);
    const before = state;
    state = reduceWorkspacePanelState(state, { type: "open-file", sessionId: "s2", workspaceDir: "/b", path: "../secret" });
    expect(state).toBe(before);
  });

  it("routes workspace and turn review through the same CHANGES tab identity", () => {
    let state = initialWorkspacePanelState;
    state = reduceWorkspacePanelState(state, { type: "open-workspace-review", sessionId: "s1", workspaceDir: "/repo" });
    state = reduceWorkspacePanelState(state, { type: "open-turn-review", sessionId: "s1", workspaceDir: "/repo", messageId: "group-1", assistantMessageId: "assistant-9", turnId: "turn-3", changeSetId: "change-7", files: [{ file: "a.ts", additions: 1, deletions: 0, diff: "+a" }] });
    expect(state.tabs.map((tab) => tab.kind)).toEqual(["review"]);
    expect(state.tabs[0]).toMatchObject({ source: "turn", messageId: "group-1", assistantMessageId: "assistant-9", turnId: "turn-3", changeSetId: "change-7" });
  });

  it("parses only safe workspace file references and preserves line ranges", () => {
    expect(parseWebuiMessageFileReference("src/index.ts:42-45")).toEqual({ path: "src/index.ts", lineStart: 42, lineEnd: 45 });
    expect(parseWebuiMessageFileReference("index.html")).toEqual({ path: "index.html" });
    expect(parseWebuiMessageFileReference("https://example.com/index.ts")).toBeUndefined();
    expect(parseWebuiMessageFileReference("../secret.ts")).toBeUndefined();
    expect(parseWebuiMessageFileReference("src/index.ts:0")).toBeUndefined();
  });

  it("renders assistant file references as navigable links while preserving ordinary URLs", () => {
    const markup = renderToStaticMarkup(createElement(WebuiMarkdown, { source: "Open src/index.ts:42 and `index.html`, or visit https://example.com.", onOpenFile: () => undefined }));
    expect(markup).toContain('data-webui-file-reference="src/index.ts"');
    expect(markup).toContain('data-webui-file-reference="index.html"');
    expect(markup).toContain('href="https://example.com"');
  });

  it("does not wrap a Markdown file link in a second generated file link", () => {
    const markup = renderToStaticMarkup(createElement(WebuiMarkdown, { source: "[src/index.ts](src/index.ts)", onOpenFile: () => undefined }));
    expect(markup.match(/<a\b/gu)).toHaveLength(1);
    expect(markup).toContain('data-webui-file-reference="src/index.ts">src/index.ts</a>');
  });

  it("scrolls the requested file line into view and focuses it after loading", () => {
    const calls: unknown[][] = [];
    const target = {
      scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(["scroll", options]),
      focus: (options?: FocusOptions) => calls.push(["focus", options]),
    };
    focusWebuiFileLine(target);
    expect(calls).toEqual([
      ["scroll", { block: "center", behavior: "smooth" }],
      ["focus", { preventScroll: true }],
    ]);
    expect(webuiFileLineTargetId("preview-tab", 42)).toBe("webui-file-line-preview-tab-42");
  });
});
