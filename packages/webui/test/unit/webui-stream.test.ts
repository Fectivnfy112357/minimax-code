import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  isSafeWebuiMarkdownHref,
  WebuiMarkdown,
} from "../../src/client/markdown.js";
import {
  initialWebuiStreamState,
  reduceWebuiStreamFrame,
} from "../../src/client/stream.js";

const frame = (dataJson: string) => ({ dataJson });

describe("WebUI mixed stream reducer", () => {
  it("keeps open, whole messages, chunks, thinking, actions, status and done distinct", () => {
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame('{"type":10}'),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"answer","thinking_content":"thought"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":" more","thinking_content":" +"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"answer more","thinking_content":"thought +"}}',
      ),
    );
    state = reduceWebuiStreamFrame(state, {
      messageActionDeltas: [{ action: "open" }],
    });
    state = reduceWebuiStreamFrame(
      state,
      frame('{"type":"session_status","session_status":{"type":"finished"}}'),
    );
    expect(state.messages).toEqual([
      { id: "m1", answer: "answer more", thinking: "thought +" },
    ]);
    expect(state.actionDeltas).toEqual([{ action: "open" }]);
    expect(state.status).toBe("finished");
    expect(state.phase).toBe("streaming");
    state = reduceWebuiStreamFrame(state, frame("[DONE]"));
    expect(state.phase).toBe("done");
  });

  it("updates a chunk's message by identity rather than by position", () => {
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":2,"agent_message":{"msg_id":"first","msg_content":"one"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"second","msg_content":"two"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"first","msg_content":" updated"}}',
      ),
    );
    expect(state.messages).toEqual([
      { id: "first", answer: "one updated", thinking: "" },
      { id: "second", answer: "two", thinking: "" },
    ]);
  });

  it("preserves earlier messages when successive whole-message frames arrive", () => {
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":2,"agent_message":{"messages":[{"msg_id":"first","msg_content":"one","thinking_content":"first thought"}]}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"messages":[{"msg_id":"second","msg_content":"two","thinking_content":"second thought"}]}}',
      ),
    );
    expect(state.messages).toEqual([
      { id: "first", answer: "one", thinking: "first thought" },
      { id: "second", answer: "two", thinking: "second thought" },
    ]);
  });

  it("keeps accumulated thinking when a later whole-message frame omits it", () => {
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":2,"agent_message":{"msg_id":"thinking-message","msg_content":"answer","thinking_content":"first thought"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"thinking-message","msg_content":"answer"}}',
      ),
    );
    expect(state.messages).toEqual([
      { id: "thinking-message", answer: "answer", thinking: "first thought" },
    ]);
  });

  it("appends a chunk's thinking to the accumulated thinking of the same message", () => {
    // Red-first fixture: the previous "keeps accumulated thinking"
    // test passed under the mutation `messages[index]!.thinking +
    // thinking → thinking` because it only fed whole-message frames,
    // which take the `!chunk` branch. This fixture feeds a chunk and
    // never lets a later whole-message frame re-supply the same text,
    // so the mutation cannot hide behind it.
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":2,"agent_message":{"msg_id":"thinking-message","msg_content":"answer","thinking_content":"first thought"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"thinking-message","msg_content":" more","thinking_content":" plus"}}',
      ),
    );
    expect(state.messages).toEqual([
      {
        id: "thinking-message",
        answer: "answer more",
        thinking: "first thought plus",
      },
    ]);
  });

  it("does not throw on malformed or unknown data", () => {
    expect(() =>
      reduceWebuiStreamFrame(initialWebuiStreamState, frame("{")),
    ).not.toThrow();
    expect(
      reduceWebuiStreamFrame(
        initialWebuiStreamState,
        frame('{"type":"future","value":1}'),
      ).runtimeEvents,
    ).toHaveLength(1);
  });

  it("advances the cursor only on cursor-bearing frames (whole-group discipline)", () => {
    // The cursor rides only on the last mapped frame of a source-frame
    // group. The reducer must therefore only advance the cursor when the
    // frame carries one — never per frame, never on a middle-of-group frame
    // — so a resume never lands mid-group. A "per-frame" mutation that
    // records every frame's cursor (or worse, applies the cursor before
    // the rest of the group's frames are applied) would advance the cursor
    // before the group has finished being applied; this fixture asserts
    // the cursor is held back until a cursor-bearing frame actually
    // arrives.
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame('{"type":10}'),
    );
    expect(state.cursor).toBeUndefined();
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"partial"}}',
      ),
    );
    expect(state.cursor).toBeUndefined();
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":" more"}}',
      ),
    );
    expect(state.cursor).toBeUndefined();
    state = reduceWebuiStreamFrame(state, {
      dataJson:
        '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"whole"}}',
      cursor: "c1",
    });
    expect(state.cursor).toBe("c1");
    // A subsequent frame without a cursor leaves the cursor untouched.
    state = reduceWebuiStreamFrame(
      state,
      frame('{"type":"session_status","session_status":{"type":"finished"}}'),
    );
    expect(state.cursor).toBe("c1");
    // The next cursor-bearing frame advances again.
    state = reduceWebuiStreamFrame(state, {
      dataJson: "[DONE]",
      cursor: "c2",
    });
    expect(state.cursor).toBe("c2");
  });

  it("does not duplicate a message the reducer has already seen when a resumed stream re-sends it", () => {
    // Identity rule: whole-message frames carry `msg_id`. A resumed stream
    // may legitimately replay the last fully-applied message; the reducer
    // must upsert on `msg_id`, never append. This is the dedup contract a
    // resume relies on.
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":2,"agent_message":{"msg_id":"turn-1","msg_content":"first answer","thinking_content":"first thought"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"turn-2","msg_content":"second answer","thinking_content":"second thought"}}',
      ),
    );
    expect(state.messages.map((message) => message.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    // Resume replay: the server re-sends the last whole-message frame and
    // a new one. The replay must not produce a second `turn-2`.
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"turn-2","msg_content":"second answer","thinking_content":"second thought"}}',
      ),
    );
    state = reduceWebuiStreamFrame(
      state,
      frame(
        '{"type":2,"agent_message":{"msg_id":"turn-3","msg_content":"third answer","thinking_content":"third thought"}}',
      ),
    );
    expect(state.messages.map((message) => message.id)).toEqual([
      "turn-1",
      "turn-2",
      "turn-3",
    ]);
    expect(state.messages[1]?.answer).toBe("second answer");
  });

  it("records the cursor only after the frame's data change is applied", () => {
    // Cursor discipline, ordering edition: the cursor rides on the last
    // mapped frame of a source-frame group, and a resume must land only
    // after the group's state change has been applied. The reducer must
    // therefore commit the cursor LAST, after `dataJson` and
    // `messageActionDeltas`. A buggy implementation that records the
    // cursor before the data is applied would advance `state.cursor`
    // while the messages list still holds the previous group's value,
    // and a probe-based test catches that. A final-state-only assertion
    // would not: `reduceWebuiStreamFrame`'s return value has both
    // messages and cursor set, regardless of order.
    const probes: {
      checkpoint: string;
      cursor?: string;
      messages: number;
      actionDeltas: number;
    }[] = [];
    reduceWebuiStreamFrame(
      initialWebuiStreamState,
      {
        dataJson:
          '{"type":2,"agent_message":{"msg_id":"m1","msg_content":"hello","thinking_content":"thought"}}',
        cursor: "c1",
        messageActionDeltas: [{ action: "fork" }],
      },
      {
        probe: (snapshot, checkpoint) =>
          probes.push({
            checkpoint,
            cursor: snapshot.cursor,
            messages: snapshot.messages.length,
            actionDeltas: snapshot.actionDeltas.length,
          }),
      },
    );
    // Find the first checkpoint at which the cursor reaches `c1`.
    const cursorFirstSeen = probes.find((probe) => probe.cursor === "c1");
    expect(cursorFirstSeen).toBeDefined();
    // By the time the cursor is committed, the rest of the frame must
    // already be in state. Recording the cursor before the data change
    // would produce a probe entry where `cursor === "c1"` but
    // `messages === 0` and `actionDeltas === 0`, and the assertions
    // below would fail.
    expect(cursorFirstSeen?.messages).toBe(1);
    expect(cursorFirstSeen?.actionDeltas).toBe(1);
    // The previous checkpoint (whatever sits right before the cursor
    // commit) must not yet have the cursor — proves the cursor is
    // applied *between* checkpoints, not before.
    const cursorProbeIndex = probes.findIndex(
      (probe) => probe.cursor === "c1",
    );
    const previous = probes[cursorProbeIndex - 1];
    expect(previous?.cursor).toBeUndefined();
    expect(previous?.messages).toBe(1);
    expect(previous?.actionDeltas).toBe(1);
  });

  it("flips to reconnecting and sets resumeRequired when the server emits resume_overflow", () => {
    // The harness maps a `resync-required` source frame to
    // `{type:"resume_overflow"}` on the way out (see
    // `session-stream-delivery.ts:116`). The WebUI client must recognise
    // this signal and surface a `reconnecting` phase the shell can render
    // as visible state, and a `resumeRequired` flag the shell reads to
    // reload authoritative history and establish a new subscription. The
    // previous behaviour fell through into the generic runtime-event
    // branch and silently swallowed the signal.
    let state = reduceWebuiStreamFrame(
      initialWebuiStreamState,
      frame(
        '{"type":6,"agent_message_chunk":{"msg_id":"m1","msg_content":"partial"}}',
      ),
    );
    state = reduceWebuiStreamFrame(state, {
      dataJson: '{"type":"resume_overflow"}',
      cursor: "c-overflow",
    });
    expect(state.phase).toBe("reconnecting");
    expect(state.resumeRequired).toBe(true);
    // The cursor that came with the resume_overflow frame is recorded so a
    // reload can establish a fresh subscription immediately after
    // `getMessages` resolves.
    expect(state.cursor).toBe("c-overflow");
  });
});

describe("WebUI Markdown", () => {
  it("allows web, mail and relative links but renders unsafe schemes as text", () => {
    expect(isSafeWebuiMarkdownHref("https://example.com")).toBe(true);
    expect(isSafeWebuiMarkdownHref("http://example.com")).toBe(true);
    expect(isSafeWebuiMarkdownHref("mailto:user@example.com")).toBe(true);
    expect(isSafeWebuiMarkdownHref("/docs")).toBe(true);
    expect(isSafeWebuiMarkdownHref("../docs")).toBe(true);
    expect(isSafeWebuiMarkdownHref("#section")).toBe(true);
    expect(isSafeWebuiMarkdownHref("javascript:alert(1)")).toBe(false);
    expect(isSafeWebuiMarkdownHref("data:text/html,bad")).toBe(false);
    expect(isSafeWebuiMarkdownHref("//evil.example")).toBe(false);
  });

  it("renders fenced code through the block branch — language, container, pre", () => {
    // Real newlines, not the two-character sequence `\n`. The previous
    // fixture used `"\\n"` so marked saw a paragraph with an inline
    // codespan, not a code fence — the assertion `<code` therefore did
    // not distinguish block rendering from inline rendering, and a
    // mutation that drops the block branch would survive the suite.
    // With real newlines marked emits a `code` token whose `lang` is the
    // fence language and whose `text` is the body; the implementation
    // wraps it in `webui-code-block` with a `data-language` attribute
    // and a `<pre>` shell, and that is what the assertions check.
    const html = renderToStaticMarkup(
      createElement(WebuiMarkdown, { source: "```js\nconst a = 1\n```" }),
    );
    expect(html).toContain("webui-code-block");
    expect(html).toContain('data-language="js"');
    expect(html).toContain("<pre");
    expect(html).toContain("const a = 1");
    expect(html).not.toContain("dangerously");
  });

  it("renders a partial fence through the block branch without throwing", () => {
    // An incomplete fence is still a `code` token in marked (it cannot
    // close, but it is not a paragraph either), so the implementation
    // must take the block branch and produce the `webui-code-block`
    // container. The previous assertion only checked that render did
    // not throw; the block branch produces the `data-language`
    // attribute and the `<pre>` shell, neither of which the inline
    // codespan renderer would emit, so this fixture fails the moment
    // the block branch is dropped.
    expect(() =>
      renderToStaticMarkup(
        createElement(WebuiMarkdown, { source: "```js\nconst a" }),
      ),
    ).not.toThrow();
    const html = renderToStaticMarkup(
      createElement(WebuiMarkdown, { source: "```js\nconst a" }),
    );
    expect(html).toContain("webui-code-block");
    expect(html).toContain('data-language="js"');
    expect(html).toContain("<pre");
    expect(html).toContain("const a");
    expect(html).not.toContain("dangerously");
  });
});
