import { describe, expect, it } from "vitest";
import {
  groupTurnMessages,
  projectMessageParts,
  stripQuestionnaireResponse,
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

  it("strips a real questionnaire-response XML block and surfaces its trailing Q/A", () => {
    const fullText = [
      "<questionnaire-response>",
      "  <requestId>q-42</requestId>",
      "  <schemaVersion>1</schemaVersion>",
      "  <submittedAt>2026-09-23T19:00:00.000Z</submittedAt>",
      "  <mode>feature-enable</mode>",
      "  <responseSource>user</responseSource>",
      "  <answers>",
      "    <answer>",
      "      <stepId>step-goal</stepId>",
      "      <selectedOptions>",
      "        <item>opt-do-something</item>",
      "      </selectedOptions>",
      "    </answer>",
      "  </answers>",
      "</questionnaire-response>",
      "",
      "Q: 现在想做什么？  ",
      "A: 做点实际的事",
    ].join("\n");

    const stripped = stripQuestionnaireResponse(fullText);
    expect(stripped.content).toBe("Q: 现在想做什么？  \nA: 做点实际的事");
    expect(stripped.questionnaire).toEqual({
      requestId: "q-42",
      schemaVersion: "1",
      submittedAt: "2026-09-23T19:00:00.000Z",
      mode: "feature-enable",
      source: "user",
      answers: [
        { question: "现在想做什么？", labels: ["做点实际的事"] },
      ],
    });
    // The card must never expose raw XML markup in the projected text.
    expect(stripped.content).not.toContain("<questionnaire-response");
    expect(stripped.questionnaire).toBeDefined();
  });

  it("falls back to the XML answer step ids when no trailing Q/A lines exist", () => {
    const xmlOnly = [
      "<questionnaire-response>",
      "  <requestId>q-99</requestId>",
      "  <answers>",
      "    <answer><stepId>step-goal</stepId><selectedOptions><item>opt-do-something</item></selectedOptions></answer>",
      "    <answer><stepId>step-format</stepId><selectedOther>true</selectedOther><otherText>plain text</otherText></answer>",
      "  </answers>",
      "</questionnaire-response>",
    ].join("\n");
    const stripped = stripQuestionnaireResponse(xmlOnly);
    expect(stripped.content).toBe("");
    expect(stripped.questionnaire?.answers).toEqual([
      { question: "step-goal", labels: ["opt-do-something"] },
      { question: "step-format", labels: ["其他: plain text"] },
    ]);
  });

  it("emits a questionnaire_response part from projectMessageParts", () => {
    const fullText = [
      "<questionnaire-response>",
      "  <requestId>q-1</requestId>",
      "</questionnaire-response>",
      "",
      "Q: 现在想做什么？  ",
      "A: 做点实际的事",
    ].join("\n");
    const parts = projectMessageParts({
      msgId: "user-msg",
      role: "user",
      msgContent: fullText,
    });
    const textPart = parts.find((p) => p.type === "text");
    const questionnairePart = parts.find((p) => p.type === "questionnaire_response");
    expect(textPart?.type === "text" && textPart.content).toBe("Q: 现在想做什么？  \nA: 做点实际的事");
    expect(questionnairePart?.type).toBe("questionnaire_response");
    if (questionnairePart?.type === "questionnaire_response") {
      expect(questionnairePart.summary.requestId).toBe("q-1");
      expect(questionnairePart.summary.answers[0]?.question).toBe("现在想做什么？");
      expect(questionnairePart.summary.answers[0]?.labels).toEqual(["做点实际的事"]);
    }
  });

  it("parses communication-info answers without leaking raw XML", () => {
    const parts = projectMessageParts({
      msgId: "event-1",
      communicationInfosJson: JSON.stringify([
        {
          eventType: "questionnaire.response",
          data: {
            requestId: "q-7",
            schemaVersion: "2",
            mode: "feature-enable",
            answers: [{ label: "opt-yes" }, { label: "opt-no" }],
          },
        },
      ]),
    });
    const questionnairePart = parts.find((p) => p.type === "questionnaire_response");
    expect(questionnairePart?.type).toBe("questionnaire_response");
    if (questionnairePart?.type === "questionnaire_response") {
      expect(questionnairePart.summary.requestId).toBe("q-7");
      expect(questionnairePart.summary.schemaVersion).toBe("2");
      expect(questionnairePart.summary.mode).toBe("feature-enable");
      expect(questionnairePart.summary.answers[0]?.labels).toEqual(["opt-yes", "opt-no"]);
    }
  });
});
