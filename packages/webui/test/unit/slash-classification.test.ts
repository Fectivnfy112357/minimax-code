import { describe, expect, it } from "vitest";
import {
  WEBUI_BUILTIN_COMMANDS,
  WEBUI_RUN_COMMAND_NAMES,
  WEBUI_SKILL_FIXTURES,
  classifyWebuiSlashCommand,
  isWebuiRunnableCommand,
  sectionWebuiSlashPalette,
  type SlashCommandEntry,
} from "../../src/client/slash-palette.js";

/**
 * Pure tests for the slash palette decision layer.
 *
 * The three-state classification (`runnable` / `inert-wired` /
 * `inert-unsupported`) is the surface the submit pipeline dispatches on.
 * `isWebuiRunnableCommand` is the boolean narrowing predicate the
 * `resolveWebuiSubmissionIntent` resolver reuses; both stay byte-identical
 * to the existing code — these tests pin the contract.
 *
 * Also covers the sectioning-pass order (memory splices after
 * deploy-website) and the disabled-doesn't-dispatch promise: a
 * `supported: false` entry must never reach the run-command intent path
 * even when its name is in WEBUI_RUN_COMMAND_NAMES (e.g. `plan`/`fork`/
 * `memory` are inert today; `compact` is wired).
 */

const ICON = () => null as never;

const newEntry = (name: string, supported: boolean): SlashCommandEntry => ({
  name,
  displayName: name,
  label: name,
  description: "",
  source_type: -1,
  icon: ICON,
  supported,
});

const skillEntry = (name: string): SlashCommandEntry => ({
  name,
  displayName: name,
  label: name,
  description: "",
  source_type: 1,
  source_kind: "plugin",
  paletteSection: "skills",
  icon: ICON,
  supported: true,
});

describe("classifyWebuiSlashCommand — three-state classification", () => {
  it("classifies a wired runnable name as `runnable`", () => {
    // help / new / compact / status / usage / model are the wired names.
    for (const name of WEBUI_RUN_COMMAND_NAMES) {
      const entry = newEntry(name, true);
      expect(classifyWebuiSlashCommand(entry)).toBe(`runnable`);
    }
  });

  it("classifies a wired but non-runnable name as `inert-wired` (skill case)", () => {
    // Skills are `supported: true` but their names are not in
    // WEBUI_RUN_COMMAND_NAMES; clicking inserts the slash and the user
    // edits before sending. They must NOT reach the run-command intent.
    const entry = skillEntry("ask-matt");
    expect(classifyWebuiSlashCommand(entry)).toBe("inert-wired");
  });

  it("classifies a disabled entry whose name IS in WEBUI_RUN_COMMAND_NAMES as `inert-unsupported`", () => {
    // Disabled entries stay inert even when the name itself would be
    // runnable if wired. The pin is critical: a `supported: false` row
    // must never reach the run-command path, no matter what its name is.
    for (const name of WEBUI_RUN_COMMAND_NAMES) {
      const entry = newEntry(name, false);
      expect(classifyWebuiSlashCommand(entry)).toBe(
        "inert-unsupported",
      );
    }
  });

  it("classifies a disabled entry whose name is NOT in WEBUI_RUN_COMMAND_NAMES as `inert-unsupported`", () => {
    const entry = newEntry("plan", false);
    expect(classifyWebuiSlashCommand(entry)).toBe("inert-unsupported");
  });
});

describe("isWebuiRunnableCommand — boolean narrowing predicate (unchanged contract)", () => {
  it("returns true only when both `supported: true` AND the name is in WEBUI_RUN_COMMAND_NAMES", () => {
    expect(isWebuiRunnableCommand(newEntry("help", true))).toBe(true);
    expect(isWebuiRunnableCommand(newEntry("compact", true))).toBe(true);
  });

  it("returns false for skills (supported: true but name not in WEBUI_RUN_COMMAND_NAMES)", () => {
    expect(isWebuiRunnableCommand(skillEntry("ask-matt"))).toBe(false);
    expect(isWebuiRunnableCommand(skillEntry("code-review"))).toBe(false);
  });

  it("returns false for disabled entries, even when the name is in WEBUI_RUN_COMMAND_NAMES", () => {
    // If a future harness port drops `compact` support, the entry stays
    // inert and the submit path falls through to the user-message path.
    expect(isWebuiRunnableCommand(newEntry("compact", false))).toBe(false);
  });
});

describe("sectionWebuiSlashPalette — order snapshot (default + skills sections)", () => {
  it("places `memory` after `deploy-website` in the default section", () => {
    const builtins = WEBUI_BUILTIN_COMMANDS;
    const skills: SlashCommandEntry[] = [];
    const sectioned = sectionWebuiSlashPalette(builtins, skills);
    // Default section ends up: new → compact → goal → plan → fork → memory.
    // (deploy-website is absent from builtins; the splice still puts
    // memory at the end of the default section.)
    const defaultNames = sectioned
      .filter((entry) => entry.source_type === -1)
      .map((entry) => entry.name);
    expect(defaultNames).toEqual([
      "new",
      "compact",
      "goal",
      "plan",
      "fork",
      "memory",
    ]);
  });

  it("places the `skills` section after the default section, with the `技能` divider tag", () => {
    const builtins = WEBUI_BUILTIN_COMMANDS;
    const skills = WEBUI_SKILL_FIXTURES;
    const sectioned = sectionWebuiSlashPalette(builtins, skills);
    const skillsStart = sectioned.findIndex(
      (entry) => entry.paletteSection === "skills",
    );
    expect(skillsStart).toBeGreaterThan(0);
    // Every skills-section entry keeps the `skills` paletteSection.
    for (const entry of sectioned.slice(skillsStart)) {
      expect(entry.paletteSection).toBe("skills");
    }
    // The skills start with the first fixture and end with the last.
    const skillsNames = sectioned
      .slice(skillsStart)
      .map((entry) => entry.name);
    expect(skillsNames[0]).toBe(WEBUI_SKILL_FIXTURES[0]?.name);
    expect(skillsNames[skillsNames.length - 1]).toBe(
      WEBUI_SKILL_FIXTURES[WEBUI_SKILL_FIXTURES.length - 1]?.name,
    );
  });

  it("splices `memory` after `deploy-website` when a deploy-website plugin entry exists", () => {
    const builtins = WEBUI_BUILTIN_COMMANDS;
    const deployEntry: SlashCommandEntry = {
      name: "deploy-website",
      displayName: "deploy-website",
      label: "网站部署",
      description: "",
      source_type: -1,
      paletteSection: "special",
      icon: ICON,
      supported: false,
    };
    const sectioned = sectionWebuiSlashPalette(builtins, [deployEntry]);
    const defaultNames = sectioned
      .filter((entry) => entry.source_type === -1)
      .map((entry) => entry.name);
    // memory appears AFTER deploy-website, not at the end of builtins.
    expect(defaultNames.indexOf("memory")).toBe(
      defaultNames.indexOf("deploy-website") + 1,
    );
  });
});

describe("disabled entries do not produce run-command operations", () => {
  // The contract: a `supported: false` row must not reach the run-command
  // intent path. Even when its name is in WEBUI_RUN_COMMAND_NAMES
  // (hypothetically disabled for the runCommand port), the submit path
  // falls through to the user-message path. The classification table
  // above already pins the `inert-unsupported` state; this block pins
  // the operational consequence.

  it("`plan` (disabled in WEBUI_BUILTIN_COMMANDS) does NOT classify as runnable", () => {
    const plan = WEBUI_BUILTIN_COMMANDS.find((entry) => entry.name === "plan");
    expect(plan?.supported).toBe(false);
    expect(isWebuiRunnableCommand(plan as SlashCommandEntry)).toBe(false);
    expect(classifyWebuiSlashCommand(plan as SlashCommandEntry)).toBe(
      "inert-unsupported",
    );
  });

  it("`fork` (disabled in WEBUI_BUILTIN_COMMANDS) does NOT classify as runnable", () => {
    const fork = WEBUI_BUILTIN_COMMANDS.find((entry) => entry.name === "fork");
    expect(fork?.supported).toBe(false);
    expect(isWebuiRunnableCommand(fork as SlashCommandEntry)).toBe(false);
    expect(classifyWebuiSlashCommand(fork as SlashCommandEntry)).toBe(
      "inert-unsupported",
    );
  });

  it("`memory` (disabled in WEBUI_BUILTIN_COMMANDS) does NOT classify as runnable", () => {
    const memory = WEBUI_BUILTIN_COMMANDS.find(
      (entry) => entry.name === "memory",
    );
    expect(memory?.supported).toBe(false);
    expect(isWebuiRunnableCommand(memory as SlashCommandEntry)).toBe(false);
    expect(classifyWebuiSlashCommand(memory as SlashCommandEntry)).toBe(
      "inert-unsupported",
    );
  });

  it("only `new` / `compact` (of the wired built-ins) classify as runnable; `goal` is `inert-wired` (composerMode path)", () => {
    // Of the six WEBUI_BUILTIN_COMMANDS, three are `supported: true`:
    // `new`, `compact`, `goal`. Of those three, only `new` and `compact`
    // have names that appear in WEBUI_RUN_COMMAND_NAMES — `goal` is
    // wired but its name is absent from the runCommand list, so the
    // submit path takes the rule 1/2 `composerMode: "goal"` route instead
    // of the run-command path. This is exactly the inert-wired state the
    // classification table describes.
    const wiredRuntimes = WEBUI_BUILTIN_COMMANDS.filter(
      (entry) =>
        entry.supported &&
        WEBUI_RUN_COMMAND_NAMES.includes(
          entry.name as (typeof WEBUI_RUN_COMMAND_NAMES)[number],
        ),
    ).map((entry) => entry.name);
    expect(wiredRuntimes.sort()).toEqual(["compact", "new"]);

    const goalEntry = WEBUI_BUILTIN_COMMANDS.find(
      (entry) => entry.name === "goal",
    );
    expect(goalEntry?.supported).toBe(true);
    expect(classifyWebuiSlashCommand(goalEntry as SlashCommandEntry)).toBe(
      "inert-wired",
    );
  });
});

describe("classification ↔ isWebuiRunnableCommand consistency", () => {
  it("`runnable` matches `isWebuiRunnableCommand === true` for every entry", () => {
    const allEntries: SlashCommandEntry[] = [
      ...WEBUI_BUILTIN_COMMANDS,
      ...WEBUI_SKILL_FIXTURES,
    ];
    for (const entry of allEntries) {
      const classification = classifyWebuiSlashCommand(entry);
      const runnable = isWebuiRunnableCommand(entry);
      if (classification === "runnable") {
        expect(runnable, entry.name).toBe(true);
      } else {
        expect(runnable, entry.name).toBe(false);
      }
    }
  });

  it("classification returns one of exactly three values for every entry", () => {
    const allEntries: SlashCommandEntry[] = [
      ...WEBUI_BUILTIN_COMMANDS,
      ...WEBUI_SKILL_FIXTURES,
    ];
    for (const entry of allEntries) {
      const classification = classifyWebuiSlashCommand(entry);
      expect(
        classification === "runnable" ||
          classification === "inert-wired" ||
          classification === "inert-unsupported",
        entry.name,
      ).toBe(true);
    }
  });
});