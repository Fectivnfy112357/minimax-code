import { describe, expect, it } from "vitest";
import {
  groupTurnMessages,
  projectMessageParts,
  stripQuestionnaireResponse,
} from "../../src/client/projection/message-parts.js";
import {
  toolCallLabel,
  toolCallStatus,
  toolCallStatusLabel,
  toolCallIconCategory,
  WEBUI_DESKTOP_TOOL_ICON_GROUPS,
  WEBUI_DESKTOP_TOOL_DISPLAY_LABELS,
} from "../../src/client/projection/tool-projection.js";

describe("Desktop message parts projection", () => {
  it("normalizes Desktop tool lifecycle states without inventing completion", () => {
    expect(toolCallStatus({ status: "pending" })).toBe("pending");
    expect(toolCallStatus({ status: "running" })).toBe("running");
    expect(toolCallStatus({ status: "done" })).toBe("completed");
    expect(toolCallStatus({ status: "failed" })).toBe("error");
    expect(toolCallStatus({ status: "interrupted" })).toBe("cancelled");
    expect(toolCallStatus({ tool_call_status: 1 })).toBe("running");
    expect(toolCallStatus({ tool_call_status: 2 })).toBe("completed");
    expect(toolCallStatus({ tool_call_status: 3 })).toBe("error");
    expect(toolCallStatus({ tool_call_status: 4 })).toBe("pending");
    expect(toolCallStatus({ tool_call_status: 5 })).toBe("pending");
    expect(toolCallStatus({ tool_call_status: 6 })).toBe("unknown");
    expect(toolCallStatus({ status: "future-state" })).toBe("unknown");
    expect(toolCallStatusLabel("unknown")).toBeUndefined();
  });

  it("keeps the Desktop-visible labels for the supported tool categories", () => {
    expect(toolCallLabel({ name: "bash" })).toBe("终端");
    expect(toolCallLabel({ name: "read_file" })).toBe("读取文件");
    expect(toolCallLabel({ name: "edit_file" })).toBe("编辑文件");
    expect(toolCallLabel({ name: "web_fetch" })).toBe("网页抓取");
    expect(toolCallLabel({ name: "my_tool" })).toBe("工具");
    expect(WEBUI_DESKTOP_TOOL_DISPLAY_LABELS.website_deploy).toBe("部署网站");
    expect(WEBUI_DESKTOP_TOOL_DISPLAY_LABELS.task_query).toBe("任务进度");
    expect(WEBUI_DESKTOP_TOOL_DISPLAY_LABELS.create_goal).toBe("目标创建");
    expect(toolCallLabel({ name: "website_deploy" })).toBe("部署网站");
    expect(toolCallLabel({ name: "task_query" })).toBe("任务进度");
  });

  it("maps every tool id exposed by the Desktop 3.0.73 registry to its icon category", () => {
    const fixtures = [
      ["command", "bash", "python", "python3", "shell", "command", "terminal"],
      ["file", "read", "read_file", "ls", "find", "glob", "read_mcp_resource", "list_mcp_resources", "list_mcp_resource_templates", "deliver_asset", "archon.asset.deliver"],
      ["code", "write", "write_file", "edit", "str_replace", "file_edit", "apply_patch"],
      ["search", "grep", "search", "tool_search"],
      ["web", "web", "webfetch", "web_fetch", "web_search", "website_deploy"],
      ["browser", "mcp_browser", "browser", "archon.browser.call", "browser_open"],
      ["logo", "mavis", "matrix_mcp", "mcp_call", "archon.mcp.call"],
      ["memory", "memory"],
      ["image", "images_understand", "image_synthesize", "images_search_and_download", "image_reverse_search", "generate_image", "matrix_generate_image", "describe_image", "view_image", "image_query"],
      ["video", "submit_video_generation", "query_video_generation", "gen_videos", "batch_text_to_video", "batch_image_to_video", "videos_understand", "video_generation"],
      ["music", "get_voice_list", "batch_text_to_audio", "batch_text_to_music", "synthesize_speech", "batch_synthesize_speech", "audios_understand", "transcribe_audio", "music_generation", "audio_generation"],
      ["combine", "parallel"],
      ["task", "ask_user", "task", "task_query", "task_output", "task_stop", "update_plan", "exitplanmode", "todo_write", "todowrite", "request_user_input"],
      ["bot", "archon.communication.send", "spawn_agent", "delegate_task", "send_input", "wait_agent", "resume_agent", "close_agent"],
      ["goal", "create_goal", "update_goal", "get_goal"],
      ["tool", "web_view", "communicate"],
    ] as const;
    for (const [icon, ...ids] of fixtures) {
      for (const id of ids) expect(toolCallIconCategory({ name: id })).toBe(icon);
    }
    expect(Object.values(WEBUI_DESKTOP_TOOL_ICON_GROUPS).flat().sort()).toEqual(
      fixtures.flatMap(([, ...ids]) => ids).sort(),
    );
    expect(toolCallIconCategory({ name: "mcp:external-tool" })).toBe("logo");
    expect(toolCallIconCategory({ name: "read_file", input: { path: "image.png" } })).toBe("image");
  });

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

  it("preserves the Desktop parts order for thinking, delegation, tools, and final text", () => {
    const parts = projectMessageParts({
      msgId: "ordered",
      parts: [
        { id: "think", type: "thinking", content: "Reasoning" },
        { id: "delegate", type: "delegation", message: { fromAgent: "main", toAgent: "reviewer", content: "Check this" } },
        { id: "tool", type: "tool_call", tool_call: { name: "bash", status: "running" } },
        { id: "answer", type: "text", content: "Finished" },
        null as unknown as Record<string, unknown>,
      ],
    });
    expect(parts.map((part) => part.type)).toEqual(["thinking", "delegation", "tool_call", "text"]);
    expect(parts[1]).toMatchObject({ type: "delegation", message: { toAgent: "reviewer" } });
  });

  it("expands Desktop delegation parts arrays in their source order", () => {
    const parts = projectMessageParts({
      msgId: "delegation-array",
      parts: [{
        id: "delegation-batch",
        type: "delegation",
        delegations: [
          { fromAgent: "main", toAgent: "reviewer", content: "Review" },
          { fromAgent: "main", toAgent: "tester", content: "Test" },
        ],
      }],
    });
    expect(parts).toEqual([
      { id: "delegation-batch-0", type: "delegation", message: { fromAgent: "main", toAgent: "reviewer", content: "Review" } },
      { id: "delegation-batch-1", type: "delegation", message: { fromAgent: "main", toAgent: "tester", content: "Test" } },
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
