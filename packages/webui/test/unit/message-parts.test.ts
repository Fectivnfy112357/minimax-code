import { describe, expect, it } from "vitest";
import {
  groupTurnMessages,
  projectMessageParts,
} from "../../src/client/message-parts.js";

describe("Desktop message parts projection", () => {
  it("keeps thinking, text, and tool calls in Desktop order", () => {
    const tool = { id: "tool-1", name: "bash" };
    expect(
      projectMessageParts({
        msgId: "m1",
        thinkingContent: "先想",
        msgContent: "结果",
        toolCalls: [tool],
      }),
    ).toEqual([
      { id: "thinking", type: "thinking", content: "先想" },
      { id: "text", type: "text", content: "结果" },
      { id: "tool-1", type: "tool_call", toolCall: tool },
    ]);
  });

  it("merges messages from one turn and disambiguates repeated part ids", () => {
    const groups = groupTurnMessages([
      { msgId: "m1", turnId: "turn-1", msgContent: "第一段" },
      { msgId: "m2", turnId: "turn-1", msgContent: "第二段" },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parts.map((part) => part.id)).toEqual([
      "text",
      "m2::text",
    ]);
    expect(groups[0]?.messages).toHaveLength(2);
  });

  it("projects session.spawned and communication/delegation events", () => {
    const parts = projectMessageParts({
      msgId: "event-1",
      communicationInfosJson: JSON.stringify([
        {
          eventType: "session.spawned",
          data: { sessionId: "child-1", agentName: "reviewer", title: "Review" },
        },
        {
          eventType: "communication.message",
          data: { fromAgent: "main", toAgent: "reviewer", content: "请检查" },
        },
      ]),
    });
    expect(parts).toEqual([
      {
        id: "agent-joined-event-1",
        type: "agent_joined",
        agent: { sessionId: "child-1", agentName: "reviewer", title: "Review" },
      },
      {
        id: "delegation-event-1",
        type: "delegation",
        message: { fromAgent: "main", toAgent: "reviewer", content: "请检查" },
      },
    ]);
  });

  it("uses a separate group when no shared turn/query key exists", () => {
    expect(
      groupTurnMessages([
        { msgId: "m1", msgContent: "one" },
        { msgId: "m2", msgContent: "two" },
      ]),
    ).toHaveLength(2);
  });
});
