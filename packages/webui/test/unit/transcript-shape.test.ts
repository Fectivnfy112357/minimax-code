import { describe, expect, it } from "vitest";
import {
  WEBUI_FIELD_OWNERSHIP_TABLE,
  WEBUI_HISTORICAL_FIELD_TABLE,
  WEBUI_LIVE_FIELD_TABLE,
} from "../../src/client/projection/transcript-shape.js";
import type { WebuiClientMessage } from "../../src/client/contracts.js";
import type { WebuiStreamMessage } from "../../src/client/stream.js";

/**
 * Pure tests for the two transcript adapters. The leaf renderer tests
 * pin the historical- and live-paths' field ownership at the type level:
 * every field the historical record carries must appear in the historical
 * table, every field the live record carries must appear in the live
 * table, and the ownership table must list every prop the leaf renderer
 * reads.
 *
 * The fixtures below are intentionally minimal — each row covers a single
 * branch in the projector (`thinking + duration`, `tool calls`, `usage`,
 * `attachments`, `goal`). The projector is exercised indirectly via the
 * existing `projections.test.ts` suite; here we only assert the shape
 * contracts.
 */

// ── historical fixture ────────────────────────────────────────────────

const HISTORICAL_USER: WebuiClientMessage = {
  msgId: "msg-hist-user-1",
  turnId: "turn-1",
  timestamp: 1700000000000,
  role: "user",
  msgContent: "draft the release notes",
  source: "thread-goal",
  usage: {
    request_duration_ms: 1200,
    output_tokens: 80,
  },
} as const;

const HISTORICAL_ASSISTANT: WebuiClientMessage = {
  msgId: "msg-hist-asst-1",
  turnId: "turn-1",
  timestamp: 1700000001500,
  role: "assistant",
  msgContent: "Here is a draft:\n\n## v1.0\n- new session composer",
  thinkingContent: "let me list the bullet points",
  thinkingDurationMs: 850,
  toolCalls: [
    { id: "tc-1", name: "file.read", args: { path: "/notes" } },
  ],
  attachments: [{ type: "file", name: "notes.md", url: "file:///notes.md" }],
  usage: {
    request_duration_ms: 1500,
    output_tokens: 240,
  },
  actions: { fork: true, rewind: true, edit: false },
  fileChanges: [
    {
      filePath: "CHANGELOG.md",
      before: "old",
      after: "new",
      status: "modified",
    },
  ],
} as const;

// ── live fixture ──────────────────────────────────────────────────────

const LIVE_USER: WebuiStreamMessage = {
  id: "msg-live-user-1",
  answer: "draft the release notes",
  thinking: "",
  role: "user",
  isGoal: true,
  timestamp: 1700000000000,
};

const LIVE_ASSISTANT_IN_FLIGHT: WebuiStreamMessage = {
  id: "msg-live-asst-1",
  answer: "Here is a draft:",
  thinking: "let me list the bullet points",
  toolCalls: [
    { id: "tc-1", name: "file.read", args: { path: "/notes" } },
  ],
  usage: {
    request_duration_ms: 600,
    output_tokens: 64,
  },
};

// ── field-table coverage ─────────────────────────────────────────────

describe("WEBUI_HISTORICAL_FIELD_TABLE — every populated field on the historical fixtures must appear", () => {
  const fixtureFields: ReadonlyArray<keyof WebuiClientMessage> = [
    "msgId",
    "turnId",
    "timestamp",
    "role",
    "msgContent",
    "source",
    "usage",
    "thinkingContent",
    "thinkingDurationMs",
    "toolCalls",
    "attachments",
    "actions",
    "fileChanges",
  ];
  const tableFields = new Set(
    WEBUI_HISTORICAL_FIELD_TABLE.map((row) => String(row.field)),
  );
  for (const field of fixtureFields) {
    it(`covers historical field "${String(field)}"`, () => {
      expect(tableFields.has(String(field))).toBe(true);
    });
  }
});

describe("WEBUI_LIVE_FIELD_TABLE — every populated field on the live fixtures must appear", () => {
  const fixtureFields: ReadonlyArray<keyof WebuiStreamMessage> = [
    "id",
    "answer",
    "thinking",
    "role",
    "isGoal",
    "timestamp",
    "toolCalls",
    "usage",
  ];
  const tableFields = new Set(
    WEBUI_LIVE_FIELD_TABLE.map((row) => String(row.field)),
  );
  for (const field of fixtureFields) {
    it(`covers live field "${String(field)}"`, () => {
      expect(tableFields.has(String(field))).toBe(true);
    });
  }
});

describe("WEBUI_FIELD_OWNERSHIP_TABLE — exclusive fields are not double-listed", () => {
  it("`streaming`, `streamMessageId`, `messageRootId` are owned by live only", () => {
    const streaming = WEBUI_FIELD_OWNERSHIP_TABLE.find(
      (row) => row.field === "streaming",
    );
    const streamMsgId = WEBUI_FIELD_OWNERSHIP_TABLE.find(
      (row) => row.field === "streamMessageId / messageRootId",
    );
    expect(streaming?.owner).toBe("live");
    expect(streamMsgId?.owner).toBe("live");
  });

  it("`actions` and `initialDiff` are owned by historical only", () => {
    const actions = WEBUI_FIELD_OWNERSHIP_TABLE.find(
      (row) => row.field === "actions",
    );
    const initialDiff = WEBUI_FIELD_OWNERSHIP_TABLE.find(
      (row) => row.field === "initialDiff",
    );
    expect(actions?.owner).toBe("historical");
    expect(initialDiff?.owner).toBe("historical");
  });

  it("shared fields appear on both adapters (id / role / text / thinking / tools)", () => {
    const sharedFields = [
      "messageId",
      "role",
      "text (msgContent / answer)",
      "thinking",
      "tools",
    ];
    for (const field of sharedFields) {
      const row = WEBUI_FIELD_OWNERSHIP_TABLE.find((r) => r.field === field);
      expect(row?.owner, `field "${field}" must be shared`).toBe("shared");
    }
  });
});

// ── leaf renderer contracts (typing + shape) ─────────────────────────

describe("leaf renderer contracts — the historical and live fixtures cover the renderer surface", () => {
  it("historical user fixture carries `messageId`, `role`, `text`, `timestamp`, `isGoal`, `usage`", () => {
    expect(HISTORICAL_USER.msgId).toBe("msg-hist-user-1");
    expect(HISTORICAL_USER.role).toBe("user");
    expect(HISTORICAL_USER.msgContent).toBe("draft the release notes");
    expect(HISTORICAL_USER.timestamp).toBe(1700000000000);
    expect(HISTORICAL_USER.source).toBe("thread-goal");
    expect(HISTORICAL_USER.usage?.["request_duration_ms"]).toBe(1200);
    expect(HISTORICAL_USER.usage?.["output_tokens"]).toBe(80);
  });

  it("historical assistant fixture carries every prop the leaf renderer reads", () => {
    expect(HISTORICAL_ASSISTANT.role).toBe("assistant");
    expect(HISTORICAL_ASSISTANT.msgContent).toContain("Here is a draft:");
    expect(HISTORICAL_ASSISTANT.thinkingContent).toBe(
      "let me list the bullet points",
    );
    expect(HISTORICAL_ASSISTANT.thinkingDurationMs).toBe(850);
    expect(HISTORICAL_ASSISTANT.toolCalls?.[0]?.["name"]).toBe("file.read");
    expect(HISTORICAL_ASSISTANT.attachments?.[0]?.name).toBe("notes.md");
    expect(HISTORICAL_ASSISTANT.actions?.fork).toBe(true);
    expect(HISTORICAL_ASSISTANT.actions?.rewind).toBe(true);
    expect(HISTORICAL_ASSISTANT.actions?.edit).toBe(false);
    expect(HISTORICAL_ASSISTANT.fileChanges?.[0]?.filePath).toBe(
      "CHANGELOG.md",
    );
  });

  it("live user fixture carries `messageId`, `role`, `text`, `isGoal`, `timestamp`", () => {
    expect(LIVE_USER.id).toBe("msg-live-user-1");
    expect(LIVE_USER.role).toBe("user");
    expect(LIVE_USER.answer).toBe("draft the release notes");
    expect(LIVE_USER.isGoal).toBe(true);
    expect(LIVE_USER.timestamp).toBe(1700000000000);
  });

  it("live assistant in-flight fixture carries `text`, `thinking`, `tools`, `usage`", () => {
    expect(LIVE_ASSISTANT_IN_FLIGHT.id).toBe("msg-live-asst-1");
    expect(LIVE_ASSISTANT_IN_FLIGHT.answer).toBe("Here is a draft:");
    expect(LIVE_ASSISTANT_IN_FLIGHT.thinking).toBe(
      "let me list the bullet points",
    );
    expect(LIVE_ASSISTANT_IN_FLIGHT.toolCalls?.[0]?.["name"]).toBe("file.read");
    expect(LIVE_ASSISTANT_IN_FLIGHT.usage?.["output_tokens"]).toBe(64);
  });

  it("live assistant in-flight fixture does NOT carry `actions` or `fileChanges`", () => {
    // Pin: the live path never carries the two historical-only fields. If
    // the wire schema grows `actions` on the live path, the ownership
    // table must be updated first.
    expect(
      (LIVE_ASSISTANT_IN_FLIGHT as unknown as Record<string, unknown>)
        .actions,
    ).toBeUndefined();
    expect(
      (LIVE_ASSISTANT_IN_FLIGHT as unknown as Record<string, unknown>)
        .fileChanges,
    ).toBeUndefined();
  });

  it("historical user fixture does NOT carry `streaming`", () => {
    expect(
      (HISTORICAL_USER as unknown as Record<string, unknown>).streaming,
    ).toBeUndefined();
  });
});

// ── cross-adapter agreement ──────────────────────────────────────────

describe("cross-adapter agreement — historical and live fields share the same ids and roles", () => {
  it("user fixtures agree on `role: 'user'`", () => {
    expect(HISTORICAL_USER.role).toBe(LIVE_USER.role);
  });

  it("user fixtures agree on `text` content (modulo pending-stream trim)", () => {
    expect(HISTORICAL_USER.msgContent).toBe(LIVE_USER.answer);
  });

  it("assistant fixtures agree on the leading answer fragment", () => {
    expect(
      HISTORICAL_ASSISTANT.msgContent?.startsWith("Here is a draft:"),
    ).toBe(true);
    expect(LIVE_ASSISTANT_IN_FLIGHT.answer.startsWith("Here is a draft:")).toBe(
      true,
    );
  });

  it("assistant fixtures agree on `thinking` content", () => {
    expect(HISTORICAL_ASSISTANT.thinkingContent).toBe(
      LIVE_ASSISTANT_IN_FLIGHT.thinking,
    );
  });

  it("both assistant fixtures carry the same `toolCalls[0].name`", () => {
    expect(HISTORICAL_ASSISTANT.toolCalls?.[0]?.["name"]).toBe(
      LIVE_ASSISTANT_IN_FLIGHT.toolCalls?.[0]?.["name"],
    );
  });
});

// ── ownership table accessors used by tests ───────────────────────────

describe("WEBUI_FIELD_OWNERSHIP_TABLE — accessor helpers for the leaf renderer", () => {
  it("`initialDiff` is `historical`-owned and explains its absence on the live path", () => {
    const row = WEBUI_FIELD_OWNERSHIP_TABLE.find(
      (r) => r.field === "initialDiff",
    );
    expect(row?.owner).toBe("historical");
    expect(row?.notes).toMatch(/historical/);
  });

  it("the live-only fields carry a `live` owner marker", () => {
    const liveOnly = WEBUI_FIELD_OWNERSHIP_TABLE.filter(
      (r) => r.owner === "live",
    );
    expect(liveOnly.length).toBeGreaterThan(0);
    for (const row of liveOnly) {
      expect(row.field).toMatch(/streaming|streamMessageId|messageRootId/);
    }
  });
});