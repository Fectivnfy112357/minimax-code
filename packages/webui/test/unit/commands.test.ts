import assert from "node:assert/strict";
import { describe, expect, it, vi } from "vitest";
import { runWebuiCommand } from "../../src/server/commands/runner.js";
import {
  createSessionOperation,
  createUserModelProviderOperation,
  getSessionOperation,
  getSessionRewindPreviewOperation,
  listSessionsOperation,
  listSkillsOperation,
  runCommandOperation,
} from "../../src/server/operation/operations.js";

describe("WebUI command adapter", () => {
  it("returns the five-command catalogue for help", async () => {
    const result = await runWebuiCommand({} as never, { command: "help" });
    expect(result.output).toContain("/status");
    expect(result.data).toHaveLength(5);
    // /compact dropped in batch C: the harness port no longer exposes
    // requestCompaction and the runner's whitelist was reduced to the five
    // still-implemented surfaces.
    expect(result.output).not.toContain("/compact");
  });

  it("rejects malformed and unknown command request bodies", () => {
    expect(runCommandOperation.validate(null)).toMatchObject({
      ok: false,
      code: "invalid_body",
    });
    expect(
      runCommandOperation.validate({ command: "not-a-command" }),
    ).toMatchObject({ ok: false, code: "invalid_body" });
  });

  it("validates and preserves the optional team-mode create field", () => {
    expect(
      createSessionOperation.validate({
        name: "main",
        workspaceDir: process.cwd(),
        teamModeOff: false,
      }),
    ).toEqual({
      ok: true,
      body: { name: "main", workspaceDir: process.cwd(), teamModeOff: false },
    });
    expect(
      createSessionOperation.validate({
        name: "main",
        workspaceDir: process.cwd(),
        teamModeOff: "false",
      }),
    ).toMatchObject({ ok: false, code: "invalid_body" });
  });

  it("accepts an empty listSkills body and a string agentName", () => {
    expect(listSkillsOperation.validate(undefined)).toEqual({ ok: true, body: {} });
    expect(
      listSkillsOperation.validate({ agentName: "main" }),
    ).toEqual({ ok: true, body: { agentName: "main" } });
  });

  it("rejects non-string agentName on listSkills", () => {
    expect(
      listSkillsOperation.validate({ agentName: 42 }),
    ).toMatchObject({ ok: false, code: "invalid_body" });
  });

  it("preserves shared record and non-empty-string validator boundaries", () => {
    assert.deepEqual(listSessionsOperation.validate({ name: "main" }), {
      ok: true,
      body: { name: "main" },
    });
    assert.deepEqual(listSessionsOperation.validate(null), {
      ok: false,
      code: "invalid_body",
      message: "listSessions body must be an object",
    });
    assert.deepEqual(listSessionsOperation.validate({ name: "  " }), {
      ok: false,
      code: "invalid_body",
      message: "listSessions body requires a non-empty name",
    });

    assert.deepEqual(getSessionOperation.validate({ id: "session-1" }), {
      ok: true,
      body: { id: "session-1" },
    });
    assert.deepEqual(getSessionOperation.validate({ id: "" }), {
      ok: false,
      code: "invalid_body",
      message: "getSession body requires a non-empty id",
    });
  });

  it("preserves shared conversation and provider validator boundaries", () => {
    assert.deepEqual(getSessionRewindPreviewOperation.validate({ id: "s", userMessageId: "m" }), {
      ok: true,
      body: { id: "s", userMessageId: "m" },
    });
    assert.deepEqual(getSessionRewindPreviewOperation.validate({ id: "s" }), {
      ok: false,
      code: "invalid_body",
      message: "getSessionRewindPreview body requires a non-empty userMessageId",
    });

    assert.deepEqual(createUserModelProviderOperation.validate({ providerId: "p" }), {
      ok: true,
      body: { providerId: "p" },
    });
    assert.deepEqual(createUserModelProviderOperation.validate([]), {
      ok: false,
      code: "invalid_body",
      message: "createUserModelProvider body must be an object",
    });
  });
});
