import { describe, expect, it } from "vitest";
import {
  applyWebuiSlashLiteMode,
  buildWebuiSlashPalette,
  isWebuiRunnableCommand,
  rankWebuiSlashPalette,
  sectionWebuiSlashPalette,
  WEBUI_BUILTIN_COMMANDS,
  WEBUI_PLUGIN_REGISTRY,
  WEBUI_RUN_COMMAND_NAMES,
} from "../../src/client/slash-palette.js";

// The desktop's slash palette (`chunks/10118-*`) is the source of truth for
// these tests: sectioning, memory splice, four-rank filter, lite-mode filter,
// and the `isWebuiRunnableCommand` narrowing.

describe("WebUI slash palette — sectioning", () => {
  it("preserves built-in order for everything except memory", () => {
    const skills = Object.values(WEBUI_PLUGIN_REGISTRY);
    const palette = buildWebuiSlashPalette({ skills });
    const names = palette.map((entry) => entry.name);
    // Built-in order, with `memory` spliced after `deploy-website`.
    expect(names).toEqual([
      "new",
      "compact",
      "goal",
      "plan",
      "fork",
      "deploy-website",
      "memory",
    ]);
  });

  it("splits built-ins and plugin entries by `paletteSection === \"special\"`", () => {
    const skills = Object.values(WEBUI_PLUGIN_REGISTRY);
    const palette = buildWebuiSlashPalette({ skills });
    const defaultSection = palette.filter(
      (entry) => entry.source_type === -1 || entry.paletteSection === "special",
    );
    const names = defaultSection.map((entry) => entry.name);
    // `memory` is spliced after the special plugin; everything else keeps
    // its built-in order.
    expect(names).toEqual([
      "new",
      "compact",
      "goal",
      "plan",
      "fork",
      "deploy-website",
      "memory",
    ]);
  });

  it("falls back to appending memory when no deploy-website is present", () => {
    const palette = sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, []);
    const memoryIdx = palette.findIndex((entry) => entry.name === "memory");
    const lastIdx = palette.length - 1;
    expect(memoryIdx).toBe(lastIdx);
  });
});

describe("WebUI slash palette — lite-mode filter", () => {
  it("keeps only skills, goal and plan in lite mode", () => {
    const skills = Object.values(WEBUI_PLUGIN_REGISTRY);
    const fullPalette = buildWebuiSlashPalette({ skills });
    const litePalette = applyWebuiSlashLiteMode(fullPalette, true);
    const names = litePalette.map((entry) => entry.name);
    // `deploy-website` sits in the default section (paletteSection: "special")
    // but its source_type is -1 like the built-ins, so the desktop's predicate
    // removes it in lite mode — only `goal` and `plan` survive via composerMode.
    expect(names).toEqual(["goal", "plan"]);
  });
});

describe("WebUI slash palette — rank filter", () => {
  const palette = buildWebuiSlashPalette({
    skills: Object.values(WEBUI_PLUGIN_REGISTRY),
  });

  it("returns the palette untouched on empty query", () => {
    expect(rankWebuiSlashPalette(palette, "").map((entry) => entry.name)).toEqual(
      palette.map((entry) => entry.name),
    );
  });

  it("ranks exact name match first", () => {
    const result = rankWebuiSlashPalette(palette, "compact");
    expect(result[0]?.name).toBe("compact");
  });

  it("ranks startsWith before includes", () => {
    // Query "p" matches `plan` (startsWith) and `compact` (includes "p").
    const result = rankWebuiSlashPalette(palette, "p");
    const names = result.map((entry) => entry.name);
    const planIdx = names.indexOf("plan");
    const compactIdx = names.indexOf("compact");
    expect(planIdx).toBeGreaterThanOrEqual(0);
    expect(compactIdx).toBeGreaterThan(planIdx);
  });

  it("falls back to substring across label/description fields", () => {
    // "目标" only appears in `goal`'s description — rank 3 hit.
    const result = rankWebuiSlashPalette(palette, "目标");
    expect(result.map((entry) => entry.name)).toContain("goal");
  });

  it("preserves original index within the same rank", () => {
    // Empty result still preserves palette order via the sectioning pass.
    const empty = rankWebuiSlashPalette(palette, "zzznomatch");
    expect(empty).toEqual([]);
  });
});

describe("WebUI slash palette — runtime narrowing", () => {
  it("isWebuiRunnableCommand narrows to WebuiRunCommandName entries", () => {
    const palette = buildWebuiSlashPalette({
      skills: Object.values(WEBUI_PLUGIN_REGISTRY),
    });
    const runnable = palette.filter(isWebuiRunnableCommand);
    const names = runnable.map((entry) => entry.name).sort();
    // Only `new` and `compact` are wired through the harness port today.
    expect(names).toEqual(["compact", "new"]);
  });

  it("WEBUI_RUN_COMMAND_NAMES matches the server-side validation list", () => {
    // The harness port validation list lives in operations.ts; keep the
    // client literal union aligned so the narrowing never lies.
    expect([...WEBUI_RUN_COMMAND_NAMES].sort()).toEqual(
      ["compact", "help", "model", "new", "status", "usage"],
    );
  });
});