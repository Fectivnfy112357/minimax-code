import { describe, expect, it, vi } from "vitest";
import { runWebuiCommand } from "../../src/server/commands/runner.js";

describe("WebUI command adapter", () => {
  it("returns the six-command catalogue for help", async () => {
    const result = await runWebuiCommand({} as never, { command: "help" });
    expect(result.output).toContain("/compact");
    expect(result.data).toHaveLength(6);
  });

  it("uses the CliService single-object compaction shape", async () => {
    const requestCompaction = vi.fn().mockResolvedValue({ success: true });
    await runWebuiCommand({ requestCompaction } as never, { command: "compact", sessionId: "s1", agentName: "main", input: "focus" });
    expect(requestCompaction).toHaveBeenCalledWith({ name: "main", id: "s1", reason: "ui_request", customInstructions: "focus" });
  });

  it("maps nothing-to-compact to a handled response", async () => {
    const result = await runWebuiCommand({ requestCompaction: vi.fn().mockResolvedValue({ code: "NOTHING_TO_COMPACT" }) } as never, { command: "compact", sessionId: "s1" });
    expect(result).toEqual({ handled: true, output: "No compaction is needed for this conversation yet." });
  });
});

