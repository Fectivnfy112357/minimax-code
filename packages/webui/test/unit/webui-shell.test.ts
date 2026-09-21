// Verify the two-column shell (ticket 04).
//
// The shell renders a left navigation rail and a main surface; it uses
// token-derived utility classes so the layout reads from the desktop
// application's visual conventions. We render the React component to a
// string and assert the regions are present in the markup, without
// depending on the exact attribute set every later ticket will rewrite.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { WebuiClientFoundationApp } from "../../src/client/app.js";

function renderShell(label = "webui-foundation"): string {
  return renderToStaticMarkup(
    createElement(WebuiClientFoundationApp, { label }),
  );
}

describe("WebUI shell", () => {
  it("renders a two-column layout with a rail and a main surface", () => {
    const html = renderShell();

    // The shell declares a data attribute on its outermost element so later
    // tickets can locate it without scraping class names; the rail and main
    // surface each have their own region marker.
    expect(html).toMatch(/data-webui-shell="two-column"/u);
    expect(html).toMatch(/data-webui-shell-region="rail"/u);
    expect(html).toMatch(/data-webui-shell-region="surface"/u);
  });

  it("uses token-derived background and text utilities", () => {
    const html = renderShell();

    // The rail sits one step darker than the main surface — bg_grouped_secondary
    // over bg_default_primary — and uses the text-label set for its menu rows.
    expect(html).toMatch(/bg-bg_grouped_secondary/u);
    expect(html).toMatch(/bg-bg_default_primary/u);
    expect(html).toMatch(/text-text_default_primary/u);
    expect(html).toMatch(/text-text_default_secondary/u);
  });

  it("uses token-derived radii, spacing and type-size utilities", () => {
    const html = renderShell();

    // The shell declares a border between the rail and the main surface,
    // a small menu-row radius, and a larger block radius for the
    // code-snippet block. Tokens, not defaults.
    expect(html).toMatch(/rounded-radius_/u);
    expect(html).toMatch(/p-spacing_/u);
    expect(html).toMatch(/gap-spacing_/u);
    expect(html).toMatch(/text-size_/u);
    expect(html).toMatch(/leading-line_height_/u);
    expect(html).toMatch(/border-border_default/u);
  });

  it("falls back to the desktop mono stack for code blocks", () => {
    const html = renderShell();

    // font-mono is the only utility Tailwind ships that maps directly onto
    // the desktop's `code, kbd, pre, samp` font-family rule.
    expect(html).toMatch(/font-mono/u);
  });
});

describe("WebUI shell — theme switching", () => {
  it("is opt-in via a class on the root element", () => {
    // The HTML wrapper that ships with the build sets `class="light"` on
    // <html> so the compiled `.light` rule applies by default. Switching
    // happens by toggling the class on the root element.
    const html = readFileSync(
      new URL("../../src/client/index.html", import.meta.url),
      "utf8",
    );
    expect(html).toMatch(/<html[^>]+class="light"/u);
  });

  it("flips the primary surface when the root class changes", () => {
    const tokens = readFileSync(
      new URL("../../src/client/styles/tokens.css", import.meta.url),
      "utf8",
    );
    const lightMatch = tokens.match(/\.light\s*\{([^}]*--bg_default_primary[^;]*);/u);
    const darkMatch = tokens.match(/\.dark\s*\{([^}]*--bg_default_primary[^;]*);/u);
    expect(lightMatch, ".light must rebind --bg_default_primary").not.toBeNull();
    expect(darkMatch, ".dark must rebind --bg_default_primary").not.toBeNull();
    expect(lightMatch![1].trim()).not.toBe(darkMatch![1].trim());
  });
});