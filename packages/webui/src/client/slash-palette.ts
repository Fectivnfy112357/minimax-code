// Slash palette for the composer hinting model.
//
// Mirrors the desktop's `app/out/_next/static/chunks/10118-*` palette exactly:
// the data layer is split into three pools (built-in commands, the plugin
// registry, and the skills resolver), the sectioning logic mirrors the
// desktop's `eR` + memory splice, and the filter is the same four-rank
// scoring the desktop uses. Behaviour fields (`composerMode` / `sendIntent`
// / `directAction`) are kept verbatim so a future harness port can wire
// them without renaming; today the WebUI only acts on the supported
// built-ins (new, compact), and the rest render in the desktop's row
// shape with `aria-disabled` so the visual stays 1:1.
//
// Source attribution: `docs/webui-visual-language.md` (visual language),
// ADR 0009 (reuse the desktop's vocabulary), `chunks/10118-*` (palette
// data structure), `chunks/60554-*` (i18n strings).

import type { ReactElement } from "react";
import {
  WebuiIconCommandCompact,
  WebuiIconCommandFork,
  WebuiIconCommandGoal,
  WebuiIconCommandMemory,
  WebuiIconCommandPlan,
  WebuiIconNewTask,
  WebuiIconSites,
  WebuiIconSkillAskMatt,
  WebuiIconSkillCodebaseDesign,
  WebuiIconSkillCodeReview,
  WebuiIconSkillDiagnosingBugs,
} from "./icons.js";

/** Behaviour an entry can declare. Mirrors the desktop's three special fields. */
export type SlashComposerMode = "goal" | "plan" | "review";
export type SlashSendIntent = "cloud-handoff" | "review";
export type SlashDirectAction = "memory" | "fork";

/** Where an entry lives in the popover. The desktop uses "special" only. */
export type SlashPaletteSection = "special" | "skills";

/**
 * One row in the slash palette. Mirrors the desktop record shape so a future
 * `listSkills` RPC can be slotted into `resolveWebuiSkills` without renaming.
 *
 * `supported` is the WebUI-specific capability flag — entries where the
 * harness port is not wired render as inert rows (`aria-disabled`, no click,
 * no hover tint, dimmed icon + label + description).
 */
export interface SlashCommandEntry {
  readonly name: string;
  readonly displayName: string;
  readonly label: string;
  readonly description: string;
  readonly source_type: -1 | 0 | 1;
  readonly icon: (props: { className?: string }) => ReactElement;
  readonly composerMode?: SlashComposerMode;
  readonly sendIntent?: SlashSendIntent;
  readonly directAction?: SlashDirectAction;
  readonly slashPrompt?: string;
  readonly paletteSection?: SlashPaletteSection;
  readonly paletteDescriptionClassName?: string;
  readonly searchTerms?: readonly string[];
  readonly display_name?: string;
  readonly display_description?: string;
  readonly source_kind?: string;
  /** WebUI-specific: true if the runCommand path is wired for this entry. */
  readonly supported: boolean;
}

/**
 * Built-in commands. Order is the desktop's natural order; the sectioning
 * pass pulls `memory` out and splices it after `deploy-website` so the
 * default section reads: new → compact → goal → plan → fork → deploy-website
 * → memory, then the skills section.
 *
 * Capability gating today is the static `supported` flag. When the harness
 * port grows new behaviours (goal mode, fork, deploy, memory), flip the
 * matching `supported` and the row goes live without UI changes.
 */
export const WEBUI_BUILTIN_COMMANDS: readonly SlashCommandEntry[] = [
  {
    name: "new",
    displayName: "new",
    label: "新建会话",
    description: "新建会话",
    source_type: -1,
    icon: WebuiIconNewTask,
    supported: true,
  },
  {
    name: "compact",
    displayName: "compact",
    label: "总结",
    description: "总结上下文，继续当前对话",
    source_type: -1,
    icon: WebuiIconCommandCompact,
    supported: true,
  },
  {
    name: "goal",
    displayName: "goal",
    label: "目标",
    description: "为当前会话设置或更新目标",
    source_type: -1,
    composerMode: "goal",
    icon: WebuiIconCommandGoal,
    supported: false,
  },
  {
    name: "plan",
    displayName: "plan",
    label: "计划",
    description: "执行前先梳理复杂任务",
    source_type: -1,
    composerMode: "plan",
    icon: WebuiIconCommandPlan,
    supported: false,
  },
  {
    name: "fork",
    displayName: "fork",
    label: "复制为新会话",
    description: "保留当前上下文，在新会话中继续",
    source_type: -1,
    directAction: "fork",
    icon: WebuiIconCommandFork,
    supported: false,
  },
  {
    name: "memory",
    displayName: "memory",
    label: "记忆",
    description: "在本次会话中使用和引用记忆",
    source_type: -1,
    directAction: "memory",
    icon: WebuiIconCommandMemory,
    supported: false,
  },
];

/**
 * Plugin registry. Mirrors the desktop's `ez` map: a fixed name → metadata
 * table for entries that should sit between the built-in commands and the
 * skills section. The desktop currently registers exactly one — deploy-website.
 *
 * The WebUI's harness port has no deploy path today, so the entry renders
 * inert; the row is the desktop's row, just non-functional.
 */
export const WEBUI_PLUGIN_REGISTRY: Record<
  string,
  Pick<
    SlashCommandEntry,
    | "name"
    | "displayName"
    | "label"
    | "description"
    | "source_type"
    | "icon"
    | "paletteSection"
    | "supported"
  >
> = {
  "deploy-website": {
    name: "deploy-website",
    displayName: "deploy-website",
    label: "网站部署",
    description:
      "支持静态网站部署，适合前端网站分享、作品展示和快速发布。",
    source_type: -1,
    icon: WebuiIconSites,
    paletteSection: "special",
    supported: false,
  },
};

/**
 * Static skill catalogue. The desktop surfaces skills in the slash palette
 * via `listSkills(agentName, ...)`; the WebUI's harness port has no skill
 * RPC yet, so we ship a fixture set that mirrors what the desktop shows
 * today (the four `mavis-*` skills whose descriptions are quoted verbatim
 * from the local `~/.hermes/skills` registry). When the harness port adds
 * `listSkills`, replace `resolveWebuiSlashSkills` with a real fetch — the
 * fixture entries map onto the same `SlashCommandEntry` shape.
 *
 * Each row is inert (`supported: false`) because clicking a skill today
 * does nothing in WebUI. The icons follow the desktop's "lamp / paper /
 * blueprint / bug" vocabulary; in lieu of an extracted path, use generic
 * but consistent monoline glyphs sized to the desktop's 18×18.
 */
export const WEBUI_SKILL_FIXTURES: readonly SlashCommandEntry[] = [
  {
    name: "ask-matt",
    displayName: "ask-matt",
    label: "ask-matt",
    description: "Ask which skill or flow fits your situation.",
    source_type: 1,
    source_kind: "plugin",
    icon: WebuiIconSkillAskMatt,
    paletteSection: "skills",
    supported: false,
  },
  {
    name: "code-review",
    displayName: "code-review",
    label: "code-review",
    description:
      "Review the changes since a fixed point (commit, branch, tag, or merge-base) along two axes: Standards and Spec.",
    source_type: 1,
    source_kind: "plugin",
    icon: WebuiIconSkillCodeReview,
    paletteSection: "skills",
    supported: false,
  },
  {
    name: "codebase-design",
    displayName: "codebase-design",
    label: "codebase-design",
    description:
      "Shared vocabulary for designing deep modules. Use when the user wants to introduce, redesign, or reshape a module's interface.",
    source_type: 1,
    source_kind: "plugin",
    icon: WebuiIconSkillCodebaseDesign,
    paletteSection: "skills",
    supported: false,
  },
  {
    name: "diagnosing-bugs",
    displayName: "diagnosing-bugs",
    label: "diagnosing-bugs",
    description:
      "Diagnosis loop for hard bugs and performance regressions. Use when the user reports something broken, throwing, or slow.",
    source_type: 1,
    source_kind: "plugin",
    icon: WebuiIconSkillDiagnosingBugs,
    paletteSection: "skills",
    supported: false,
  },
];

/**
 * Skills resolver. Mirrors the desktop's `listSkillHub` (signed-out web) /
 * `listSkills(agentName, ...)` split. The WebUI today does not expose a
 * slash-palette skill RPC, so the resolver returns the fixture set above
 * (plus the plugin registry, which the sectioning pass routes to the
 * default section via `paletteSection: "special"`). When the harness port
 * adds skill fetching, replace this body with the equivalent of the
 * desktop's calls and the sectioning will pick them up unchanged.
 */
export async function resolveWebuiSlashSkills(): Promise<SlashCommandEntry[]> {
  return [
    ...Object.values(WEBUI_PLUGIN_REGISTRY).map((entry) => ({
      ...entry,
      display_name: entry.label,
      display_description: entry.description,
      source_kind: "plugin",
    })),
    ...WEBUI_SKILL_FIXTURES,
  ];
}

/**
 * Sectioning pass. Mirrors the desktop's `eR` predicate and the memory
 * splice that pulls `memory` out of the built-in order and inserts it after
 * `deploy-website` in the default section. The default section ends up
 * holding built-ins (sans memory) plus all entries whose `paletteSection` is
 * `"special"` (currently `deploy-website`); the skills section holds
 * everything else. The order is preserved within each section.
 */
export function sectionWebuiSlashPalette(
  builtins: readonly SlashCommandEntry[],
  skills: readonly SlashCommandEntry[],
): SlashCommandEntry[] {
  const isInDefault = (entry: SlashCommandEntry): boolean =>
    entry.source_type === -1 || entry.paletteSection === "special";

  const memoryItem = builtins.filter((entry) => entry.name === "memory");
  const others = builtins.filter((entry) => entry.name !== "memory");

  const inDefault: SlashCommandEntry[] = [];
  const inSkills: SlashCommandEntry[] = [];
  for (const skill of skills) {
    if (isInDefault(skill)) inDefault.push(skill);
    else inSkills.push(skill);
  }

  const deployIdx = inDefault.findIndex(
    (entry) => entry.name === "deploy-website",
  );
  if (memoryItem.length > 0) {
    inDefault.splice(
      deployIdx >= 0 ? deployIdx + 1 : inDefault.length,
      0,
      ...memoryItem,
    );
  }

  // Tag every skills-section entry so the popover can render the `技能`
  // header before them. Mirrors the desktop's static `技能` divider that
  // appears between the default section and the skill rows.
  const taggedSkills = inSkills.map((entry) => ({
    ...entry,
    paletteSection: entry.paletteSection ?? "skills",
  }));

  return [...others, ...inDefault, ...taggedSkills];
}

/**
 * Optional lite-mode filter. Mirrors the desktop's `tL` branch: drop every
 * built-in except `goal` and `plan`, keep all skills. The WebUI does not
 * surface a lite mode today, but the predicate is here so a future flag
 * can be wired without rebuilding the sectioning.
 */
export function applyWebuiSlashLiteMode(
  palette: readonly SlashCommandEntry[],
  lite: boolean,
): SlashCommandEntry[] {
  if (!lite) return [...palette];
  return palette.filter(
    (entry) =>
      entry.source_type !== -1 ||
      entry.composerMode === "goal" ||
      entry.composerMode === "plan",
  );
}

/**
 * Rank-based filter. Mirrors the desktop's four-rank scoring:
 *
 *   0 — exact match on name or displayName
 *   1 — startsWith on name or displayName
 *   2 — includes on name or displayName
 *   3 — substring across every searchable field, including searchTerms
 *
 * Within the same rank, items keep their original palette order. Empty
 * query returns the palette untouched.
 */
export function rankWebuiSlashPalette(
  palette: readonly SlashCommandEntry[],
  query: string,
): SlashCommandEntry[] {
  const trimmed = query.trim();
  if (!trimmed) return [...palette];
  const needle = trimmed.toLowerCase();

  const scored: { cmd: SlashCommandEntry; rank: number; idx: number }[] = [];
  palette.forEach((entry, idx) => {
    const name = entry.name.toLowerCase();
    const display = entry.displayName.toLowerCase();
    let rank: number;
    if (name === needle || display === needle) rank = 0;
    else if (name.startsWith(needle) || display.startsWith(needle)) rank = 1;
    else if (name.includes(needle) || display.includes(needle)) rank = 2;
    else {
      const haystack = [
        entry.name,
        entry.displayName,
        entry.label,
        entry.description,
        entry.display_name,
        entry.display_description,
        ...(entry.searchTerms ?? []),
      ]
        .filter((value): value is string => Boolean(value))
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(needle)) return;
      rank = 3;
    }
    scored.push({ cmd: entry, rank, idx });
  });
  scored.sort((left, right) => left.rank - right.rank || left.idx - right.idx);
  return scored.map((entry) => entry.cmd);
}

/**
 * Composed API: section + lite-mode filter. Returns the static slice; skills
 * are awaited in `buildWebuiSlashPaletteAsync` below because the desktop's
 * skills come from a runtime IPC call.
 */
export function buildWebuiSlashPalette(options: {
  readonly skills?: readonly SlashCommandEntry[];
  readonly lite?: boolean;
}): SlashCommandEntry[] {
  const skills = options.skills ?? [];
  const sectioned = sectionWebuiSlashPalette(WEBUI_BUILTIN_COMMANDS, skills);
  return applyWebuiSlashLiteMode(sectioned, !!options.lite);
}

/**
 * Async form: resolves the skills pool, then runs the sectioning pass. The
 * WebUI today calls this once per popover open (or once per session if the
 * popover persists across opens) so the resolver cost stays bounded.
 */
export async function buildWebuiSlashPaletteAsync(options: {
  readonly lite?: boolean;
} = {}): Promise<SlashCommandEntry[]> {
  const skills = await resolveWebuiSlashSkills();
  return buildWebuiSlashPalette({ skills, lite: options.lite });
}

/**
 * Names the harness port's `runCommand` accepts. Mirrors the server-side
 * validation list in `packages/webui/src/server/operations.ts`; the
 * `WebuiRunCommandName` literal union is the single source of truth on the
 * client side. `isWebuiRunnableCommand` narrows a `SlashCommandEntry` so
 * the submit handler can pass `command.name` to `runCommand` without an
 * unsafe cast.
 */
export const WEBUI_RUN_COMMAND_NAMES = [
  "help",
  "new",
  "compact",
  "status",
  "usage",
  "model",
] as const;
export type WebuiRunCommandName = (typeof WEBUI_RUN_COMMAND_NAMES)[number];

export function isWebuiRunnableCommand(
  entry: SlashCommandEntry,
): entry is SlashCommandEntry & {
  readonly name: WebuiRunCommandName;
  readonly supported: true;
} {
  return (
    entry.supported &&
    (WEBUI_RUN_COMMAND_NAMES as readonly string[]).includes(entry.name)
  );
}