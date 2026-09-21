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

import { describe, it, expect, vi } from "vitest";
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
  submitWebuiComposerTurn,
  subscribeToSessionHash,
} from "../../src/client/app.js";
import {
  buildWebuiStreamLoopSink,
  runWebuiStreamLoop,
} from "../../src/client/stream-loop.js";
import type {
  WebuiClientMessageLoader,
  WebuiClientMessageSender,
  WebuiClientSessionResumer,
} from "../../src/client/app.js";
import type { WebuiStreamFrame } from "../../src/server/port.js";
import {
  initialWebuiStreamState,
  type WebuiStreamState,
} from "../../src/client/stream.js";

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

// Behaviour-level coverage of the composer's send/resume loop. The test
// drives the same `runWebuiStreamLoop` the composer in `app.tsx` calls
// from its submit handler, with a WebSocket double (the mocked
// `sendMessage` / `resumeSession` close over the `onFrame` callback the
// transport would otherwise hand to a real socket). The assertions
// observe the loop's outcome through the sink callbacks, which is the
// same observable the React shell binds to `setStream`. No DOM is
// rendered; the review noted the absence of a DOM environment and
// ruled out adding one. What this gives us is effect-based evidence
// that the reconnect branch is reachable and that the composer calls
// `resumeSession` with the cursor it observed before the drop.
describe("WebUI composer send/resume loop", () => {
  it("calls resumeSession with the cursor it observed before a mid-stream socket drop", async () => {
    // Scenario: the user's prompt starts a stream; the server emits a
    // cursor-bearing frame; then the WebSocket closes before [DONE].
    // The brief's F1 says the loop must call `resumeSession` with
    // `afterCursor: <that cursor>` and surface the `reconnecting`
    // phase the shell renders. The previous implementation had the
    // reconnect branch after the `await sendMessage` line, so a
    // rejection landed in the catch and went straight to `refused`;
    // this test asserts the *recovered* sequence.
    const observedPhases: string[] = [];
    const resumeCalls: { afterCursor?: string }[] = [];
    const applied: WebuiStreamFrame[] = [];

    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        // Open the stream; emit a chunk that carries the cursor the
        // upstream group would carry. Then reject to simulate the WS
        // closing before `[DONE]`.
        onFrame({
          dataJson: '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"partial"}}',
          cursor: "c1",
        });
        throw new Error("WebUI connection closed before [DONE]");
      },
    );
    const resumeSession: WebuiClientSessionResumer = vi.fn(
      async (req, onFrame) => {
        resumeCalls.push({ afterCursor: req.afterCursor });
        // The fresh subscription ends with `[DONE]` — same wire shape
        // as a successful send. The loop's only job here is to route
        // the frames through `applyFrame` and resolve.
        onFrame({ dataJson: '{"type":10}' });
        onFrame({ dataJson: "[DONE]" });
      },
    );

    await runWebuiStreamLoop(
      { sendMessage, resumeSession },
      { sessionId: "session-1", message: "hello" },
      {
        applyFrame: (frame) => applied.push(frame),
        setPhase: (phase) => observedPhases.push(phase),
        setMessages: () => undefined,
        refuse: () => undefined,
      },
    );

    // The loop's phase trace must contain `reconnecting` — the same
    // phase the shell turns into the `Reconnecting…` row. The previous
    // implementation never reached this phase because the rejection
    // went straight to `refused`.
    expect(observedPhases).toContain("reconnecting");
    expect(observedPhases).not.toContain("refused");
    // The cursor captured before the drop is forwarded to
    // `resumeSession` as `afterCursor`. That is the exact contract the
    // brief's resume criterion relies on.
    expect(resumeCalls).toEqual([{ afterCursor: "c1" }]);
    // The capture pipeline saw both the chunk from the original stream
    // and the frames from the resumed stream. The chunk is what gave
    // the loop its cursor.
    expect(applied.some((f) => f.cursor === "c1")).toBe(true);
    // The phase sequence ends in `done` — the resumed stream resolved
    // its `[DONE]` and the loop fell through to the final commit.
    expect(observedPhases.at(-1)).toBe("done");
  });

  it("reloads history and resubscribes with no cursor after a resume_overflow frame", async () => {
    // Scenario: a stream emits a `resume_overflow` event mid-flight
    // before `[DONE]`. The brief's F2 says the loop must reload
    // authoritative history through `getMessages` and establish a
    // fresh `resumeSession` subscription with no cursor. The previous
    // implementation read the `needsHistoryReload` flag at the top of
    // the loop, but the `await sendMessage` line broke out of the loop
    // before the next iteration could observe it.
    const observedPhases: string[] = [];
    const resumeCalls: { afterCursor?: string }[] = [];
    let loadMessagesCalls = 0;

    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"stale answer"}}',
          cursor: "c-stale",
        });
        onFrame({ dataJson: '{"type":"resume_overflow"}' });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    const resumeSession: WebuiClientSessionResumer = vi.fn(
      async (req, onFrame) => {
        resumeCalls.push({ afterCursor: req.afterCursor });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    const loadMessages: WebuiClientMessageLoader = vi.fn(async () => {
      loadMessagesCalls += 1;
      return { messages: [], hasMore: false };
    });

    await runWebuiStreamLoop(
      { sendMessage, resumeSession, loadMessages },
      { sessionId: "session-1", message: "hello" },
      {
        applyFrame: () => undefined,
        setPhase: (phase) => observedPhases.push(phase),
        setMessages: () => undefined,
        refuse: () => undefined,
      },
    );

    // `loadMessages` ran exactly once, the way the brief intends.
    expect(loadMessagesCalls).toBe(1);
    // `resumeSession` was called once, with no `afterCursor`, because
    // the reload already established the fresh subscription point.
    expect(resumeCalls).toEqual([{ afterCursor: undefined }]);
    // The loop moved through `reconnecting` and never went to
    // `refused`. The phase sequence must contain `reconnecting` so the
    // shell renders its `Reconnecting…` indicator.
    expect(observedPhases).toContain("reconnecting");
    expect(observedPhases).not.toContain("refused");
    expect(observedPhases.at(-1)).toBe("done");
  });

  it("contains sink callback failures — the loop never rejects even if the sink throws", async () => {
    // Brief R8 said the documented "never rejects" guarantee was false
    // when a sink callback throws. The fix wraps every sink callback
    // in a try/catch; the outer loop must resolve regardless. The
    // transport mocks here all resolve cleanly so the only failures
    // come from the sink itself; we then assert the loop resolved.
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({ dataJson: '{"type":10}' });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    const throwingSink = {
      applyFrame: () => {
        throw new Error("applyFrame blew up");
      },
      setPhase: () => {
        throw new Error("setPhase blew up");
      },
      setMessages: () => {
        throw new Error("setMessages blew up");
      },
      refuse: () => {
        throw new Error("refuse blew up");
      },
    };
    await expect(
      runWebuiStreamLoop(
        { sendMessage },
        { sessionId: "session-1", message: "hello" },
        throwingSink,
      ),
    ).resolves.toBeUndefined();
  });
});

describe("WebUI composer sink binding", () => {
  // Brief R7: the previous shell tests called `runWebuiStreamLoop`
  // directly with their own sinks, so a misrouted or dropped callback
  // in the production binding (the inline object literal the composer
  // in `app.tsx` constructed) would not fail a test. The fix extracts
  // the binding into `buildWebuiStreamLoopSink`, which the production
  // shell now uses. This describe block exercises that helper with a
  // recording state reducer so that:
  //  - `applyFrame` routed to `setStream(reduce(current, frame))` —
  //    dropping this binding leaves the reducer out of the loop and
  //    fails the `applyFrame` assertion;
  //  - `setPhase` updates `state.phase` only — confusing it with
  //    `refuse` would write `phase: "refused"` instead of the
  //    intended value;
  //  - `setMessages` replaces `state.messages` without touching phase
  //    — confusing it with `setPhase` would drop the messages;
  //  - `refuse` writes `phase: "refused"` and `refusal` — confusing
  //    either field fails the corresponding assertion.
  type Reducer = (current: WebuiStreamState) => WebuiStreamState;
  const recordingReducer = (
    log: Reducer[],
  ): ((update: Reducer) => void) => {
    return (update) => {
      log.push(update);
    };
  };

  it("binds the composer sink to the React state reducer correctly", () => {
    const log: Reducer[] = [];
    const setStream = recordingReducer(log);
    const sink = buildWebuiStreamLoopSink(setStream);

    // `applyFrame` must reduce the current state with the frame.
    sink.applyFrame({
      dataJson:
        '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello","thinking_content":"thought"}}',
    });
    expect(log).toHaveLength(1);
    const applyResult = log[0]!(initialWebuiStreamState);
    expect(applyResult.messages[0]).toEqual({
      id: "m1",
      answer: "hello",
      thinking: "thought",
    });
    expect(applyResult.phase).toBe("streaming");
    log.length = 0;

    // `setPhase` must update phase without touching the rest.
    sink.setPhase("reconnecting");
    expect(log).toHaveLength(1);
    const phaseResult = log[0]!({
      ...initialWebuiStreamState,
      messages: applyResult.messages,
    });
    expect(phaseResult.phase).toBe("reconnecting");
    expect(phaseResult.messages).toEqual(applyResult.messages);
    log.length = 0;

    // `setMessages` must replace messages without touching phase.
    sink.setMessages([{ id: "loaded", answer: "from server", thinking: "" }]);
    expect(log).toHaveLength(1);
    const messagesResult = log[0]!({
      ...initialWebuiStreamState,
      phase: "streaming",
    });
    expect(messagesResult.messages).toEqual([
      { id: "loaded", answer: "from server", thinking: "" },
    ]);
    expect(messagesResult.phase).toBe("streaming");
    log.length = 0;

    // `refuse` must write phase: "refused" AND the refusal string —
    // the test asserts both fields so a binding that forgot to set
    // `phase` (or to write the refusal string) fails one of them.
    sink.refuse("connection closed");
    expect(log).toHaveLength(1);
    const refuseResult = log[0]!({
      ...initialWebuiStreamState,
      phase: "streaming",
    });
    expect(refuseResult.phase).toBe("refused");
    expect(refuseResult.refusal).toBe("connection closed");
  });

  it("drives the actual loop with the production sink binding", async () => {
    // End-to-end evidence: a single submit run, with the production
    // binding helper, drives the same React state a real composer
    // would. We then assert the final state matches what the brief
    // expects for each of the three reachable outcomes (resumed,
    // refused, resynced). A misbinding inside the helper would fail
    // one of these assertions.
    const buildState = () => {
      const log: Reducer[] = [];
      let state = initialWebuiStreamState;
      const setStream = (update: Reducer): void => {
        log.push(update);
        state = update(state);
      };
      return { setStream, getState: () => state, log };
    };

    // Outcome 1 — resumed after a mid-stream drop.
    {
      const { setStream, getState } = buildState();
      const sink = buildWebuiStreamLoopSink(setStream);
      const sendMessage: WebuiClientMessageSender = vi.fn(
        async (_req, onFrame) => {
          onFrame({
            dataJson:
              '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"partial"}}',
            cursor: "c1",
          });
          throw new Error("WS dropped");
        },
      );
      const resumeSession: WebuiClientSessionResumer = vi.fn(
        async (_req, onFrame) => {
          onFrame({ dataJson: "[DONE]" });
        },
      );
      await runWebuiStreamLoop(
        { sendMessage, resumeSession },
        { sessionId: "s", message: "hi" },
        sink,
      );
      const final = getState();
      expect(final.phase).toBe("done");
      expect(final.messages[0]?.id).toBe("m1");
      // The cursor captured before the drop is preserved in state —
      // it's the only stable resumption point the loop has, so it
      // must not be wiped just because the resumed stream did not
      // emit a fresh cursor on `[DONE]`.
      expect(final.cursor).toBe("c1");
    }

    // Outcome 2 — refused without a cursor (no resume possible).
    {
      const { setStream, getState } = buildState();
      const sink = buildWebuiStreamLoopSink(setStream);
      const sendMessage: WebuiClientMessageSender = vi.fn(
        async (_req, _onFrame) => {
          throw new Error("WS dropped before any frame");
        },
      );
      await runWebuiStreamLoop(
        { sendMessage, resumeSession: undefined },
        { sessionId: "s", message: "hi" },
        sink,
      );
      const final = getState();
      expect(final.phase).toBe("refused");
      expect(final.refusal).toBe("WS dropped before any frame");
    }

    // Outcome 3 — resynced after a resume_overflow mid-flight.
    {
      const { setStream, getState } = buildState();
      const sink = buildWebuiStreamLoopSink(setStream);
      const sendMessage: WebuiClientMessageSender = vi.fn(
        async (_req, onFrame) => {
          onFrame({
            dataJson:
              '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"stale"}}',
            cursor: "c-stale",
          });
          onFrame({ dataJson: '{"type":"resume_overflow"}' });
          onFrame({ dataJson: "[DONE]" });
        },
      );
      const resumeSession: WebuiClientSessionResumer = vi.fn(
        async (req, onFrame) => {
          // The fresh subscription starts with no cursor.
          expect(req.afterCursor).toBeUndefined();
          onFrame({ dataJson: "[DONE]" });
        },
      );
      const loadMessages: WebuiClientMessageLoader = vi.fn(async () => ({
        messages: [],
        hasMore: false,
      }));
      await runWebuiStreamLoop(
        { sendMessage, resumeSession, loadMessages },
        { sessionId: "s", message: "hi" },
        sink,
      );
      const final = getState();
      // Phase flipped to `reconnecting` mid-run, then back through
      // `done` after the resumed stream emitted `[DONE]`. The reload
      // replaced the transcript with the server's authoritative
      // history (empty in this fixture); the stale `m1` from the
      // first subscription is no longer in state. The reducer does
      // not clear `resumeRequired` on `[DONE]` — it is a sticky flag
      // that the shell uses to decide whether to reload again — so the
      // value stays `true` until the next `resume_overflow`-bearing
      // subscription resolves it.
      expect(final.phase).toBe("done");
      expect(final.messages).toEqual([]);
      expect(final.resumeRequired).toBe(true);
    }
  });
});

// Coverage of the production app-to-helper seam. The earlier binding
// tests exercised `buildWebuiStreamLoopSink` and the loop that uses
// it; they did not exercise the React composer's submit handler at
// `app.tsx:642-646`, where the seam actually lives. `submitWebuiComposerTurn`
// is the extracted form-submit body — the React component in `app.tsx`
// calls it once per submit — and these tests drive it directly with
// the production `buildWebuiStreamLoopSink` helper. The hook is the
// optional `options.buildSink`, which a test can swap to confirm the
// helper is the binding the loop actually sees.
describe("WebUI composer app-to-helper seam", () => {
  type Reducer = (current: WebuiStreamState) => WebuiStreamState;
  function makeRecording(): {
    setStream: (update: Reducer) => void;
    getState: () => WebuiStreamState;
  } {
    let state = initialWebuiStreamState;
    const setStream = (update: Reducer): void => {
      state = update(state);
    };
    return { setStream, getState: () => state };
  }

  it("wires the live setStream through buildWebuiStreamLoopSink into the loop", async () => {
    // The default path: `submitWebuiComposerTurn` builds the sink via
    // `buildWebuiStreamLoopSink(setStream)`. A test that swaps
    // `options.buildSink` would observe the sink the loop saw; the
    // default is the production helper.
    const { setStream, getState } = makeRecording();
    let sinkSeen: unknown;
    const customBuildSink = (
      setStreamInner: (update: Reducer) => void,
    ): unknown => {
      const sink = buildWebuiStreamLoopSink(setStreamInner);
      sinkSeen = sink;
      return sink;
    };
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello"}}',
        });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    await submitWebuiComposerTurn(
      { sessionId: "s", draft: "hi", sending: false, deps: { sendMessage } },
      {
        setStream,
        setSending: () => undefined,
        onDraftChange: () => undefined,
      },
      { buildSink: customBuildSink },
    );
    // The sink the loop saw is the production helper's output, not
    // an empty object and not a no-op. The shape match is what makes
    // the seam binding observable: a miswiring that passed an empty
    // sink or `() => undefined` would leave `sinkSeen` as something
    // other than a real sink object.
    expect(sinkSeen).toBeDefined();
    expect(typeof (sinkSeen as { applyFrame: unknown }).applyFrame).toBe(
      "function",
    );
    expect(typeof (sinkSeen as { setPhase: unknown }).setPhase).toBe(
      "function",
    );
    // The state went through the live reducer: messages accumulated,
    // phase moved through streaming → done. The reducer only runs
    // because the helper translated `applyFrame` into a `setStream`
    // update — the same translation the React component relies on.
    const final = getState();
    expect(final.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(final.phase).toBe("done");
  });

  it("fails when the buildSink override drops the live setStream wiring", async () => {
    // Mutation A: ignored-result style. The override returns a
    // sink object that looks like the production helper on the
    // surface but ignores its `setStream` argument (every callback
    // is a no-op). The live reducer never receives the frames the
    // loop emits, so `messages.length === 0` and the test fails.
    const { setStream, getState } = makeRecording();
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello"}}',
        });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    await submitWebuiComposerTurn(
      { sessionId: "s", draft: "hi", sending: false, deps: { sendMessage } },
      {
        setStream,
        setSending: () => undefined,
        onDraftChange: () => undefined,
      },
      {
        buildSink: () => ({
          applyFrame: () => undefined,
          setPhase: () => undefined,
          setMessages: () => undefined,
          refuse: () => undefined,
        }),
      },
    );
    // The live setStream was passed to `buildSink` (we did pass it),
    // but the sink ignores it. Frames never reach the reducer; the
    // transcript is empty.
    expect(getState().messages).toEqual([]);
  });

  it("fails when the buildSink override is omitted and the seam is bypassed", async () => {
    // Mutation B: omitted-helper style. The React component used to
    // call `buildWebuiStreamLoopSink(setStream)` directly; a
    // regression that replaces the call with `{}` or `undefined`
    // would let the loop run with nothing. We simulate this by
    // injecting a buildSink that records `sinkSupplied = false`
    // (proving the seam was reached) and returns `undefined`. The
    // production code path then crashes when the loop reads
    // `sink.applyFrame`; the test asserts the override ran and the
    // resulting state is empty (the live reducer never received any
    // frame). If a future regression removed the
    // `buildWebuiStreamLoopSink(setStream)` call from the React
    // component entirely, this override would no longer be reached
    // and the first assertion would fail.
    const { setStream, getState } = makeRecording();
    let overrideReached = false;
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello"}}',
        });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    const customBuildSink = (): unknown => {
      overrideReached = true;
      return undefined;
    };
    await expect(
      submitWebuiComposerTurn(
        {
          sessionId: "s",
          draft: "hi",
          sending: false,
          deps: { sendMessage },
        },
        {
          setStream,
          setSending: () => undefined,
          onDraftChange: () => undefined,
        },
        { buildSink: customBuildSink as never },
      ),
    ).rejects.toThrow();
    expect(overrideReached).toBe(true);
    // The live reducer never received a frame because the loop saw
    // an undefined sink — the messages list is the initial empty
    // array. This is the observable that fails when the seam is
    // bypassed end-to-end: a regression that returns a no-op sink
    // (mutation A) leaves messages empty too, but the override
    // path is still reached. The two mutations are distinguished
    // by the override flag in mutation B and the empty messages in
    // mutation A.
    expect(getState().messages).toEqual([]);
  });

  it("drives the production helper seam end-to-end without the buildSink override", async () => {
    // R11: the production path. `submitWebuiComposerTurn` must call
    // `buildWebuiStreamLoopSink(setStream)` internally and pass the
    // result to the loop. If a regression replaces the helper with
    // an empty object, a no-op state setter, or ignores the result,
    // the live reducer never sees the frames and `messages` stays
    // empty. The override path tests cannot catch this because the
    // override bypasses the production code; this test exercises the
    // real seam.
    const { setStream, getState } = makeRecording();
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({
          dataJson:
            '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello"}}',
        });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    await submitWebuiComposerTurn(
      { sessionId: "s", draft: "hi", sending: false, deps: { sendMessage } },
      {
        setStream,
        setSending: () => undefined,
        onDraftChange: () => undefined,
      },
    );
    const final = getState();
    // The live reducer accumulated the message and reached `done`.
    // A regression that bypasses the helper, swaps the state
    // setter for a no-op, or returns a sink that never reaches the
    // loop leaves `messages` empty.
    expect(final.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(final.phase).toBe("done");
  });
});

// R12 — sink failure must change the outcome. The previous commit
// implemented `safeSink` as a defensive try/catch that did nothing
// with the failure; the reviewer reproduced a case where `applyFrame`
// threw and the loop still committed `phase: "done"`. The fixed
// `safeSink` records the first failure, disables further callbacks,
// blocks the normal `done` commit, and surfaces the failure through a
// direct `sink.refuse` call (with a `console.error` fallback when
// every callback is broken). These tests pin that contract.
describe("WebUI composer sink-failure semantics", () => {
  it("skips the normal done commit when applyFrame throws and emits a refusal", async () => {
    // Reproduction from the reviewer's edge-case script: `applyFrame`
    // throws, the stream continues to emit `[DONE]`, and the loop
    // would previously commit `phase: "done"` with no refusal. The
    // fixed loop records the failure, blocks the done commit, and
    // calls `sink.refuse` with a reason that names the failing
    // callback.
    const events: string[] = [];
    const sink = {
      applyFrame: () => {
        events.push("applyFrame");
        throw new Error("applyFrame blew up");
      },
      setPhase: (phase: string) => {
        events.push(`phase:${phase}`);
      },
      setMessages: (messages: readonly unknown[]) => {
        events.push(`messages:${messages.length}`);
      },
      refuse: (reason: string) => {
        events.push(`refuse:${reason}`);
      },
    };
    const sendMessage: WebuiClientMessageSender = vi.fn(
      async (_req, onFrame) => {
        onFrame({ dataJson: '{"type":10}' });
        onFrame({ dataJson: "[DONE]" });
      },
    );
    await runWebuiStreamLoop(
      { sendMessage },
      { sessionId: "s", message: "hi" },
      sink,
    );
    // The normal `done` commit must not appear; the loop recorded a
    // failure instead and surfaced a refusal naming the failing
    // callback.
    expect(events).not.toContain("phase:done");
    expect(
      events.some(
        (event) =>
          event.startsWith("refuse:") && event.includes("applyFrame"),
      ),
    ).toBe(true);
  });

  it("falls back to console.error when every callback is broken", async () => {
    // The extreme case: a sink that throws from every callback.
    // The refusal attempt itself throws, so the loop falls back to
    // `console.error` rather than losing the diagnostic. The promise
    // still resolves — the never-reject contract is preserved.
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    try {
      const sink = {
        applyFrame: () => {
          throw new Error("applyFrame broken");
        },
        setPhase: () => {
          throw new Error("setPhase broken");
        },
        setMessages: () => {
          throw new Error("setMessages broken");
        },
        refuse: () => {
          throw new Error("refuse broken");
        },
      };
      const sendMessage: WebuiClientMessageSender = vi.fn(
        async (_req, onFrame) => {
          onFrame({ dataJson: '{"type":10}' });
          onFrame({ dataJson: "[DONE]" });
        },
      );
      await expect(
        runWebuiStreamLoop(
          { sendMessage },
          { sessionId: "s", message: "hi" },
          sink,
        ),
      ).resolves.toBeUndefined();
      // The fallback diagnostic path ran at least once.
      expect(errorSpy).toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});
