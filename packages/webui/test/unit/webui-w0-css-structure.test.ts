// W0 safety net — the shell stylesheet's structure.
//
// `webui-design-tokens.test.ts` guards the token surface and the compiled
// stylesheet's `var()` closure. This file guards the layer those assertions do
// not reach: the structural declarations and the at-rules that W5 is allowed to
// touch when it deduplicates the two stacked generations of the same selector.
//
// Why it matters: `shell.css` defines 39 selectors more than once, and the
// winner is decided by cascade order. A deduplication that keeps the *wrong*
// declaration, or that deletes a `@media (prefers-reduced-motion: reduce)`
// override while keeping the base rule, produces a stylesheet that still parses
// and still contains every class name — the existing assertions would stay
// green. Every value below is copied from the current source, so such an edit
// fails here.
//
// This reads the SOURCE stylesheets, not `dist-webui/client/styles.css`, so it
// does not depend on `pnpm build:styles` having run.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stylesDir = path.resolve(here, "../../src/client/styles");

interface CssRule {
  readonly selector: string;
  readonly body: string;
  /** At-rule preludes this rule is nested inside, outermost first. */
  readonly context: readonly string[];
}

function normalizeSelector(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

/**
 * A brace-matching scanner rather than a full CSS parser: enough to answer
 * "what is the winning declaration for this selector", which is all the
 * cascade checks below need. Comments are skipped so a commented-out rule is
 * never mistaken for a live one.
 */
function parseRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const context: string[] = [];
  let buffer = "";
  let index = 0;

  while (index < css.length) {
    const char = css[index];
    if (char === "/" && css[index + 1] === "*") {
      const end = css.indexOf("*/", index + 2);
      index = end < 0 ? css.length : end + 2;
      continue;
    }
    if (char === "{") {
      const prelude = normalizeSelector(buffer);
      buffer = "";
      if (prelude.startsWith("@")) {
        context.push(prelude);
        index += 1;
        continue;
      }
      let depth = 1;
      let cursor = index + 1;
      while (cursor < css.length && depth > 0) {
        const inner = css[cursor];
        if (inner === "/" && css[cursor + 1] === "*") {
          const end = css.indexOf("*/", cursor + 2);
          cursor = end < 0 ? css.length : end + 2;
          continue;
        }
        if (inner === "{") depth += 1;
        else if (inner === "}") depth -= 1;
        if (depth === 0) break;
        cursor += 1;
      }
      rules.push({
        selector: prelude,
        body: css.slice(index + 1, cursor),
        context: [...context],
      });
      index = cursor + 1;
      continue;
    }
    if (char === "}") {
      context.pop();
      buffer = "";
      index += 1;
      continue;
    }
    buffer += char;
    index += 1;
  }
  return rules;
}

function declaration(body: string, property: string): string | undefined {
  const match = body.match(
    new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+);`, "u"),
  );
  return match ? normalizeSelector(match[1]) : undefined;
}

let shellRules: CssRule[];
let transcriptCss: string;
let shellCss: string;
let indexCss: string;

/**
 * A rule that participates in the file's normal cascade: inside the
 * `@layer components` wrapper, but not inside a conditional at-rule. Rules
 * nested in `@media` are a separate concern and are asserted separately.
 */
function isCascading(rule: CssRule): boolean {
  return (
    rule.context.includes("@layer components") &&
    !rule.context.some(
      (entry) =>
        entry.startsWith("@media") ||
        entry.startsWith("@supports") ||
        entry.startsWith("@keyframes"),
    )
  );
}

/** The rule that wins for a selector: the last cascading one. */
function winning(selector: string, rules: CssRule[] = shellRules): CssRule {
  const matches = rules.filter(
    (rule) => rule.selector === selector && isCascading(rule),
  );
  expect(
    matches.length,
    `no cascading rule found for ${selector}`,
  ).toBeGreaterThan(0);
  return matches[matches.length - 1];
}

function declarationsFor(selector: string, rules: CssRule[] = shellRules): string {
  return rules
    .filter((rule) => rule.selector === selector && isCascading(rule))
    .map((rule) => rule.body)
    .join("\n");
}

beforeAll(() => {
  shellCss = readFileSync(path.join(stylesDir, "shell.css"), "utf8");
  indexCss = readFileSync(path.join(stylesDir, "index.css"), "utf8");
  transcriptCss = readFileSync(
    path.join(stylesDir, "transcript-widgets.css"),
    "utf8",
  );
  shellRules = parseRules(shellCss);
});

describe("W0 · stylesheet composition", () => {
  it("layers the three stylesheets in the documented order", () => {
    const imports = [...indexCss.matchAll(/@import\s+"([^"]+)"/gu)].map(
      (match) => match[1],
    );
    expect(imports).toEqual([
      "./tokens.css",
      "./shell.css",
      "./transcript-widgets.css",
      "katex/dist/katex.min.css",
    ]);
  });

  it("emits the three tailwind directives exactly once each", () => {
    for (const directive of ["base", "components", "utilities"])
      expect(indexCss).toContain(`@tailwind ${directive};`);
    expect([...indexCss.matchAll(/@tailwind\s+\w+;/gu)]).toHaveLength(3);
  });

  it("wraps shell.css in the components layer", () => {
    expect(shellCss).toContain("@layer components {");
    // Every rule in the file is inside that layer, so none of them may sit at
    // the top level of the parsed output.
    expect(shellRules.filter((rule) => rule.context.length === 0)).toHaveLength(
      0,
    );
  });
});

describe("W0 · structural declarations W5 must preserve", () => {
  it("keeps the rail at the desktop's fixed width", () => {
    expect(declaration(winning(".webui-rail").body, "width")).toBe("256px");
  });

  it("reserves a non-overlapping right gutter while the progress panel floats", () => {
    expect(declarationsFor(".webui-session-layout")).toContain("min-height: 0");
    expect(declaration(winning(".webui-session-layout").body, "position")).toBe(
      "relative",
    );
    expect(declaration(winning(".webui-session-layout").body, "width")).toBe(
      "100%",
    );
    expect(
      declaration(winning(".webui-session-has-progress-panel").body, "padding-right"),
    ).toBe("368px");

    const viewport = winning(".webui-session-scroll-viewport");
    expect(declaration(viewport.body, "min-height")).toBe("0");
    expect(declaration(viewport.body, "flex")).toBe("1 1 auto");
    expect(declaration(viewport.body, "overflow-y")).toBe("auto");

    const scroll = declarationsFor(
      ".webui-session-layout .webui-session-transcript-scroll",
    );
    expect(scroll).toContain("order: 1");
    expect(scroll).toContain("min-height: 0");
    expect(scroll).toContain("flex: 0 0 auto");
    expect(scroll).toContain("overflow: visible");

    const emptyTranscript = winning(
      '.webui-session-layout .webui-session-transcript-scroll[data-webui-transcript-empty="true"]',
    );
    expect(declaration(emptyTranscript.body, "flex")).toBe("1 1 auto");

    const emptyMessageList = winning(
      '.webui-session-layout .webui-session-transcript-scroll[data-webui-transcript-empty="true"] .message-list',
    );
    expect(declaration(emptyMessageList.body, "flex")).toBe("1 1 auto");
    expect(declaration(emptyMessageList.body, "align-items")).toBe("center");
    expect(declaration(emptyMessageList.body, "justify-content")).toBe("center");

    const emptyState = winning(".webui-transcript-empty-state");
    expect(declaration(emptyState.body, "display")).toBe("flex");
    expect(declaration(emptyState.body, "align-items")).toBe("center");
    expect(declaration(emptyState.body, "justify-content")).toBe("center");
    expect(declaration(emptyState.body, "text-align")).toBe("center");

    const messageList = winning(".webui-session-layout .message-list");
    expect(declaration(messageList.body, "max-width")).toBe("768px");
    expect(declaration(messageList.body, "margin-left")).toBe("auto");
    expect(declaration(messageList.body, "margin-right")).toBe("auto");

    const composer = winning(".webui-session-layout .webui-session-composer");
    expect(declaration(composer.body, "display")).toBe("contents");

    const liveColumn = winning(".webui-session-layout .webui-stream-column");
    expect(declaration(liveColumn.body, "order")).toBe("2");
    expect(declaration(liveColumn.body, "flex")).toBe("0 0 auto");
    expect(declaration(liveColumn.body, "max-width")).toBe("768px");
    expect(declaration(liveColumn.body, "margin-left")).toBe("auto");
    expect(declaration(liveColumn.body, "margin-right")).toBe("auto");
    expect(declaration(liveColumn.body, "overflow-y")).toBeUndefined();

    const bottomPadding = winning(
      ".webui-session-layout .webui-session-bottom-padding",
    );
    expect(declaration(bottomPadding.body, "height")).toBe(
      "var(--webui-composer-bottom-padding, 168px)",
    );

    const emptyLiveTranscript = winning(
      '.webui-session-layout .webui-session-transcript-scroll[data-webui-transcript-empty-live="true"]',
    );
    expect(declaration(emptyLiveTranscript.body, "flex")).toBe("0 0 0");
    expect(declaration(emptyLiveTranscript.body, "height")).toBe("0");
    expect(declaration(emptyLiveTranscript.body, "overflow")).toBe("hidden");

    const composerContent = winning(
      ".webui-session-layout .webui-session-composer-overlay > *",
    );
    expect(declaration(composerContent.body, "max-width")).toBe("768px");
    expect(declaration(composerContent.body, "margin-left")).toBe("auto");
    expect(declaration(composerContent.body, "margin-right")).toBe("auto");
  });

  it("keeps the workspace beside the session and preserves a right-side explorer", () => {
    const panel = winning(".webui-workspace-panel");
    expect(declaration(panel.body, "position")).toBe("relative");
    expect(declaration(panel.body, "flex")).toBe("0 1 50%");
    expect(declaration(panel.body, "width")).toBe("50%");
    expect(declaration(panel.body, "min-width")).toBe("0");
    const expanded = winning(".webui-workspace-panel.is-expanded");
    expect(declaration(expanded.body, "position")).toBe("fixed");
    expect(declaration(expanded.body, "inset")).toBe("0");
    expect(declaration(winning(".webui-workspace-panel-body").body, "display")).toBe("flex");
    expect(declaration(winning(".webui-workspace-file-tree-panel").body, "border-left")).toBe("1px solid var(--border_default)");
  });

  it("indents expanded workspace file-tree children", () => {
    const children = winning(".webui-file-tree-children");
    expect(declaration(children.body, "padding-left")).toBe("var(--spacing_12)");
  });

  it("keeps the markdown and code surfaces scrollable where they were", () => {
    expect(
      declaration(winning(".webui-markdown").body, "overflow-wrap"),
    ).toBe("anywhere");
    expect(declaration(winning(".webui-code-block").body, "overflow")).toBe(
      "hidden",
    );
    expect(declaration(winning(".webui-table-shell").body, "overflow-x")).toBe(
      "auto",
    );
  });
});

describe("W0 · at-rules and animations W5/W6 must not remove", () => {
  it("keeps every reduced-motion override and its animation-disabling body", () => {
    const reducedMotion = shellRules.filter((rule) =>
      rule.context.some((entry) => entry.includes("prefers-reduced-motion")),
    );

    // Four blocks in shell.css, five rules inside them. Deleting one of these
    // is the failure mode this assertion exists for: the base rule would keep
    // animating for a user who asked for reduced motion.
    expect(reducedMotion).toHaveLength(5);
    for (const rule of reducedMotion)
      expect(rule.body).toMatch(/(?:animation|transition):\s*none/u);

    const selectors = reducedMotion.map((rule) => rule.selector).sort();
    expect(selectors).toEqual([
      ".message-animate-in",
      ".signin-card-collapsing, .signin-day-claimed-animation",
      ".webui-message-actions",
      ".webui-settings-content",
      ".webui-settings-toggle span",
    ]);
  });

  it("keeps every keyframe animation the shell references", () => {
    const names = [
      ...shellCss.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/gu),
    ].map((match) => match[1]);
    const transcriptNames = [
      ...transcriptCss.matchAll(/@keyframes\s+([A-Za-z0-9_-]+)/gu),
    ].map((match) => match[1]);

    expect(names.sort()).toEqual([
      "message-appear",
      "signin-card-collapse",
      "signin-day-claimed",
      "webui-settings-content-in",
      "webui-settings-search-highlight",
      "webui-signin-claim-spin",
      "webui-user-menu-usage-pulse",
    ]);
    expect(transcriptNames).toEqual(["transcript-shimmer"]);
  });

  it("keeps the three !important declarations in place", () => {
    const important = shellRules.filter((rule) =>
      rule.body.includes("!important"),
    );
    expect(important).toHaveLength(3);
    expect(
      important.some((rule) =>
        rule.selector.includes(".webui-xterm-host .xterm-viewport"),
      ),
    ).toBe(true);
  });
});

describe("W0 · stacking order", () => {
  it("keeps the overlay stacking values declared by the shell", () => {
    const values = [
      ...shellCss.matchAll(/z-index:\s*(-?[0-9]+)/gu),
    ].map((match) => Number(match[1]));
    expect([...new Set(values)].sort((left, right) => left - right)).toEqual([
      2, 4, 20, 45, 50, 70, 80, 100, 110, 111, 120, 121,
    ]);
  });
});
