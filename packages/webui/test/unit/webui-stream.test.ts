import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WebuiMarkdown } from "../../src/client/markdown.js";
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
