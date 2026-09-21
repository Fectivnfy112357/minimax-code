// Verify the shell (ticket 04; retailored by the visual-alignment pass).
//
// The shell renders the desktop application's anatomy: a 240px rail on
// `bg_default_scrim`, a main surface on `bg_grouped_secondary`, a window strip
// carrying the rail controls, a fixed "new task" row, the navigation block, the
// source switcher, the recent-tasks block, the identity row, and on the surface
// a centred hero with the floating composer and the quick-action chips.
//
// The criterion for a visual change is the rendered result, and a markup
// assertion cannot establish that on its own: a class name in the output says
// nothing about whether the class resolves or what it paints. What this file
// guards is the contract the rest of the code depends on — region markers, state
// hooks, the utility and component classes that must reach the stylesheet, and
// the rule that a reproduced-but-unbacked control is inert. The compiled side of
// that contract (each named component class lands in the output, and every
// `var(--x)` in it closes against a definition) is asserted in
// webui-design-tokens.test.ts against the stylesheet `pnpm build:webui` produces,
// which is also where the desktop's mono stack for `code`/`pre` is checked.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import {
  WebuiClientFoundationApp,
  WebuiSessionList,
  WebuiSessionTranscript,
  createdSessionId,
  groupWebuiTranscriptItems,
  projectWebuiMessage,
  readSessionIdFromHash,
  sessionHash,
  subscribeToSessionHash,
} from "../../src/client/app.js";

function renderShell(label = "webui-foundation"): string {
  return renderToStaticMarkup(
    createElement(WebuiClientFoundationApp, { label }),
  );
}

/** The four rail destinations the desktop ships that the WebUI has no feature for. */
const INERT_NAV_LABELS = ["插件", "定时", "网站", "远程"];

describe("WebUI shell", () => {
  it("reads a created session id from either supported response shape", () => {
    expect(createdSessionId({ sessionId: "a" })).toBe("a");
    expect(createdSessionId({ session: { sessionId: "b" } })).toBe("b");
    expect(createdSessionId({ sessionId: "  c  " })).toBe("c");
    expect(createdSessionId({ session: { sessionId: "  d  " } })).toBe("d");
    expect(createdSessionId({})).toBeUndefined();
    expect(createdSessionId({ agentName: "x" } as Parameters<typeof createdSessionId>[0])).toBeUndefined();
  });

  it("round-trips the selected session through the URL hash", () => {
    expect(sessionHash("session with spaces")).toBe("#session=session+with+spaces");
    expect(readSessionIdFromHash("#session=session+with+spaces")).toBe("session with spaces");
    const html = renderToStaticMarkup(createElement(WebuiSessionList, {
      page: { sessions: [{ sessionId: "session-1", agentName: "agent", createdAt: 1, updatedAt: 2 }], hasMore: false },
      loading: false,
    }));
    expect(html).toContain('href="#session=session-1"');
  });

  it("projects every persisted message facet independently", () => {
    expect(projectWebuiMessage({ msgId: "thinking", thinkingContent: "Reasoning" })).toEqual([
      { kind: "thinking", text: "Reasoning", messageId: "thinking" },
    ]);
    expect(projectWebuiMessage({ msgId: "tools", toolCalls: [{ name: "read" }] })[0].kind).toBe("tool");
    expect(projectWebuiMessage({ msgId: "both", thinkingContent: "Think", toolCalls: [{ name: "read" }], msgContent: "Answer" }).map((item) => item.kind)).toEqual(["thinking", "tool", "assistant"]);
    expect(projectWebuiMessage({ msgId: "answer", role: "user", msgContent: "Question" })[0].kind).toBe("user");
    expect(projectWebuiMessage({ msgId: "empty" })).toEqual([]);
  });

  it("renders an empty transcript without treating it as an error", () => {
    const html = renderToStaticMarkup(createElement(WebuiSessionTranscript, {
      sessionId: "empty-session",
      loadMessages: async () => ({ messages: [], hasMore: false }),
    }));
    expect(html).toContain('data-webui-transcript="empty-session"');
  });

  it("groups a flat transcript into one block per message", () => {
    // The desktop renders one block per turn: a process disclosure carrying the
    // thinking and the tool steps, then the answer. Both belong to the same
    // message and must stay together; a user turn is its own block.
    const groups = groupWebuiTranscriptItems([
      ...projectWebuiMessage({ msgId: "turn-1", role: "user", msgContent: "Question" }),
      ...projectWebuiMessage({
        msgId: "turn-2",
        thinkingContent: "Reasoning",
        toolCalls: [{ name: "read" }],
        msgContent: "Answer",
      }),
      ...projectWebuiMessage({ msgId: "turn-3", msgContent: "Afterwards" }),
    ]);
    expect(groups.map((group) => group.messageId)).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
    ]);
    expect(groups[1].items.map((item) => item.kind)).toEqual([
      "thinking",
      "tool",
      "assistant",
    ]);
    expect(groupWebuiTranscriptItems([])).toEqual([]);
  });

  it("keeps the conversation's reading column and message chrome in the markup", () => {
    const html = renderToStaticMarkup(createElement(WebuiSessionTranscript, {
      sessionId: "reading-column",
      loadMessages: async () => ({ messages: [], hasMore: false }),
    }));
    // The reading column and the message list region survive regardless of
    // whether any message loaded.
    expect(html).toContain('data-webui-message-list="true"');
  });

  it("renders newest sessions, formats epoch milliseconds, and falls back when title is absent", () => {
    const html = renderToStaticMarkup(
      createElement(WebuiSessionList, {
        page: {
          sessions: [
            { sessionId: "older-id", agentName: "older-agent", createdAt: 1000, updatedAt: 2000 },
            { sessionId: "newer-id", agentName: "newer-agent", title: "Named session", createdAt: 3000, updatedAt: 4000 },
          ],
          hasMore: false,
        },
        loading: false,
      }),
    );
    expect(html.indexOf("Named session")).toBeLessThan(html.indexOf("older-agent"));
    expect(html).toContain("older-agent");
    expect(html).toContain(new Date(2000).toLocaleString());
    expect(html).toContain('data-webui-session-list="true"');
    // The row's component class is on the anchor, which only exists once there
    // is a session to render.
    expect(html).toMatch(/webui-session-card/u);
  });

  it("reacts to hashchange so navigation selects a different transcript without reload", () => {
    const originalWindow = globalThis.window;
    let hash = "#session=first";
    const listeners = new Set<(event: Event) => void>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        get location() { return { hash }; },
        addEventListener(type: string, listener: (event: Event) => void) {
          if (type === "hashchange") listeners.add(listener);
        },
        removeEventListener(type: string, listener: (event: Event) => void) {
          if (type === "hashchange") listeners.delete(listener);
        },
      },
    });
    try {
      let selected = readSessionIdFromHash(hash);
      const unsubscribe = subscribeToSessionHash((id) => { selected = id; });
      hash = "#session=second";
      for (const listener of listeners) listener(new Event("hashchange"));
      expect(selected).toBe("second");
      unsubscribe();
      expect(listeners).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
    }
  });

  it("shows the bound working directory without offering a directory edit control", () => {
    const html = renderToStaticMarkup(createElement(WebuiSessionList, {
      page: { sessions: [{ sessionId: "session-1", agentName: "agent", createdAt: 1, updatedAt: 2, workspaceDir: "/tmp/project" }], hasMore: false },
      loading: false,
    }));
    expect(html).toContain("/tmp/project");
    expect(html).not.toMatch(/edit.*directory|change.*directory/iu);
  });

  it("renders a legitimate empty shared-history state", () => {
    const html = renderToStaticMarkup(
      createElement(WebuiSessionList, {
        page: { sessions: [], hasMore: false },
        loading: false,
      }),
    );
    expect(html).toContain("No sessions yet.");
  });
});

describe("WebUI shell — desktop anatomy", () => {
  it("declares the shell as a two-column rail plus surface", () => {
    const html = renderShell();
    expect(html).toMatch(/data-webui-shell="two-column"/u);
    expect(html).toMatch(/data-webui-shell-region="rail"/u);
    expect(html).toMatch(/data-webui-shell-region="surface"/u);
  });

  it("sizes and colours the rail the way the desktop does", () => {
    const html = renderShell();

    // 240px fixed, one step off the main surface, and no border between the two.
    expect(html).toMatch(/data-webui-rail-width="240"/u);
    expect(html).toMatch(/w-\[240px\]/u);
    expect(html).toMatch(/bg-bg_default_scrim/u);
    // The main surface is the lightest step.
    expect(html).toMatch(/bg-bg_grouped_secondary/u);
    // The selected segmented item is painted with the primary surface token.
    expect(html).toMatch(/bg-bg_default_primary/u);
  });

  it("stacks the rail in the desktop's order", () => {
    const html = renderShell();
    const order = [
      'data-webui-sidebar-toggle="true"',
      'data-webui-rail-fixed-row="true"',
      'data-webui-nav-item="插件"',
      'data-webui-conversation-source="true"',
      'data-webui-rail-section-header="true"',
      'data-webui-rail-identity="true"',
    ];
    let cursor = -1;
    for (const marker of order) {
      const at = html.indexOf(marker);
      expect(at, `${marker} missing from the rail`).toBeGreaterThan(-1);
      expect(at, `${marker} is out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  it("leaves the reproduced nav block inert rather than wired to nothing", () => {
    const html = renderShell();

    // Exactly one marker per reproduced destination, and the control inside each
    // row is disabled rather than wired to nothing.
    const markers =
      html.match(/data-webui-placeholder-chrome="rail-nav"/gu) ?? [];
    expect(markers).toHaveLength(INERT_NAV_LABELS.length);

    for (const label of INERT_NAV_LABELS) {
      const at = html.indexOf(`data-webui-nav-item="${label}"`);
      expect(at, `nav row ${label} missing`).toBeGreaterThan(-1);
      expect(
        html.slice(at, at + 500),
        `nav row ${label} is not inert`,
      ).toMatch(/disabled/u);
    }

    // The current destination carries the state hook, so the selected row has
    // something to read.
    expect(html).toMatch(/data-webui-nav-active="true"/u);
  });

  it("uses token-derived colour utilities and the shell's component classes", () => {
    const html = renderShell();

    expect(html).toMatch(/text-text_default_primary/u);
    expect(html).toMatch(/text-text_default_secondary/u);
    expect(html).toMatch(/text-text_default_tertiary/u);
    expect(html).toMatch(/text-icon_default_tertiary/u);
    expect(html).toMatch(/border-border_default/u);
    expect(html).toMatch(/text-size_12/u);
    expect(html).toMatch(/leading-line_height_16/u);

    expect(html).toMatch(/webui-nav-item/u);
    expect(html).toMatch(/webui-empty-state/u);
    expect(html).toMatch(/webui-textarea/u);
    expect(html).toMatch(/webui-pill/u);
  });

  it("uses the desktop's own class composition for rows and pills", () => {
    const html = renderShell();

    // Row and control geometry the desktop states as utilities rather than as
    // tokens: 32px nav rows on an 8px radius, 48px identity row on 10px,
    // 14px body type.
    expect(html).toMatch(/h-8/u);
    expect(html).toMatch(/rounded-lg/u);
    expect(html).toMatch(/text-sm/u);
    expect(html).toMatch(/h-12/u);
    expect(html).toMatch(/rounded-\[10px\]/u);
  });

  it("never leaves a control operable but unbound", () => {
    // The failure this guards: a control that renders enabled, shows a pointer
    // cursor and a hover fill, and has nothing behind it. A screen full of those
    // reads as broken — and it is not caught by any styling assertion, because the
    // markup and the stylesheet are both exactly what was asked for.
    //
    // Everything the WebUI has no feature for is `disabled` or `aria-disabled`, so
    // the only operable control left in the home shell is the one real action.
    const html = renderShell();
    const controlTags: string[] = [];
    const re = /<(button|div|a|input|textarea|select)\b[^>]*>/gu;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) {
      const tag = match[0];
      if (/^<button\b/u.test(tag) || /role="button"/u.test(tag)) controlTags.push(tag);
    }
    const operable = controlTags.filter(
      (tag) =>
        !/(?:^|\s)disabled(?:=|\s|>)/u.test(tag) &&
        !/aria-disabled="true"/u.test(tag),
    );
    expect(operable).toHaveLength(1);
    // The row hook sits on the row element, not on the control inside it, so
    // attribute the operable control to the nearest preceding row.
    const at = html.indexOf(operable[0]);
    const owner = [
      ...html.slice(0, at).matchAll(/data-webui-nav-item="([^"]*)"/gu),
    ].pop();
    expect(owner?.[1]).toBe("新建任务");
  });

  it("lets the composer take a draft before a session exists", () => {
    // Composing does not need a target; only sending does. With a transport present
    // the field must accept text even though nothing is selected yet — leaving it
    // disabled is what made the first screen look like it could not be used at all.
    const html = renderToStaticMarkup(
      createElement(WebuiClientFoundationApp, {
        label: "webui-foundation",
        sendMessage: async () => undefined,
      }),
    );
    const at = html.indexOf("<textarea");
    const field = html.slice(at, html.indexOf(">", at) + 1);
    expect(field).toMatch(/data-webui-composer-input="true"/u);
    expect(field).not.toMatch(/(?:^|\s)disabled(?:=|\s|>)/u);

    // The send action stays unavailable until there is something to send.
    const sendAt = html.indexOf("webui-send-button");
    const send = html.slice(html.lastIndexOf("<button", sendAt), html.indexOf(">", sendAt) + 1);
    expect(send).toMatch(/(?:^|\s)disabled(?:=|\s|>)/u);
  });

  it("puts the hero, the composer and the chips on the home surface", () => {
    const html = renderShell();

    expect(html).toMatch(/data-webui-home-content="true"/u);
    expect(html).toContain("MiniMax Code，让工作更简单。");
    // The hero column is the desktop's 743px measure under its 240px top pad.
    expect(html).toMatch(/max-w-\[743px\]/u);
    expect(html).toMatch(/pt-\[240px\]/u);
    expect(html).toMatch(/data-webui-recommendations="true"/u);
    expect(html).toMatch(
      /data-webui-placeholder-chrome="recommendation-chips"/u,
    );

    // The composer card carries the desktop's own geometry: a 20px radius over a
    // hairline border plus the soft layer. The border alone reads as nothing on
    // this surface, so the shadow is the load-bearing part.
    expect(html).toMatch(/data-webui-composer="true"/u);
    expect(html).toMatch(/data-webui-composer-input="true"/u);
    expect(html).toMatch(/data-webui-composer-toolbar="true"/u);
    expect(html).toMatch(/data-webui-workspace-toolbar="true"/u);
    expect(html).toMatch(/rounded-\[20px\]/u);
    // The card's second layer is a component rule with a token value, not an
    // arbitrary-value utility: `shadow-[…var(--a_b)]` compiles the token's
    // underscore into a space (an invalid reference) and emits a
    // `--tw-shadow-color` reference nothing defines, which the closure check in
    // webui-design-tokens.test.ts rejects.
    expect(html).toMatch(/webui-composer-card/u);
    expect(html).toMatch(/webui-hero-avatar/u);
  });

  it("keeps the token-named spacing and type scale in the blocks that use it", () => {
    // The desktop composes both scales; the WebUI's own surfaces (the transcript,
    // the create form) are written in the token-named one, so assert it where it
    // is actually rendered rather than in the home shell.
    const transcript = renderToStaticMarkup(
      createElement(WebuiSessionTranscript, {
        sessionId: "s",
        loadMessages: async () => ({ messages: [], hasMore: false }),
      }),
    );
    expect(transcript).toMatch(/p-spacing_/u);
    expect(transcript).toMatch(/gap-spacing_/u);
    expect(transcript).toMatch(/text-size_/u);
    expect(transcript).toMatch(/leading-line_height_/u);
    // `webui-button-secondary` belongs to the "Load older" control, which only
    // renders once a second page is known to exist; that the class reaches the
    // compiled stylesheet is asserted in webui-design-tokens.test.ts.
  });
});

describe("WebUI shell — theme switching", () => {
  it("is opt-in via a class on the root element", () => {
    // The HTML wrapper that ships with the build sets `class="light"` on
    // <html> so the compiled `.light` rule applies by default. Switching
    // happens by toggling the class on the root element.
    const html = readFileSync(
      new URL("../../src/client/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toMatch(/<html[^>]+class="light"/u);
  });

  it("flips the primary surface when the root class changes", () => {
    const tokens = readFileSync(
      new URL("../../src/client/styles/tokens.css", import.meta.url),
      "utf8",
    );
    const lightMatch = tokens.match(/\.light\s*\{([^}]*--bg_default_primary[^;]*);/u);
    const darkMatch = tokens.match(/\.dark\s*\{([^}]*--bg_default_primary[^;]*);/u);
    expect(lightMatch, ".light must rebind --bg_default_primary").not.toBeNull();
    expect(darkMatch, ".dark must rebind --bg_default_primary").not.toBeNull();
    expect(lightMatch![1].trim()).not.toBe(darkMatch![1].trim());
  });
});
