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

  it("renders partial fences and normal fenced code without injecting HTML", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(WebuiMarkdown, { source: "```js\\nconst a" }),
      ),
    ).not.toThrow();
    const html = renderToStaticMarkup(
      createElement(WebuiMarkdown, { source: "```js\\nconst a = 1\\n```" }),
    );
    expect(html).toContain("<code");
    expect(html).toContain("const a = 1");
    expect(html).not.toContain("dangerously");
  });
});
