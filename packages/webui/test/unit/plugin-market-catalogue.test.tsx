// The marketplace is one catalogue per kind of thing.
//
// It used to be a single page: a 市场/个人 header toggle, a plugin grid, and the
// marketplace's skills appended below it in their own `技能` section — fetched
// as a side payload (`skillLimit: 8`) of the plugin listing. One list to
// scroll, one search box labelled 「搜索插件或技能」 narrowing two different
// result sets. The header toggle is now 插件 / 技能, and each tab owns its page.
//
// Market/personal did not disappear with it: that is the 管理 view, whose own
// header keeps the pair, and it is still how you reach what is installed.
//
// No DOM framework is allowed in this package, so the two marketplace branches
// are asserted through `renderToStaticMarkup` — `initialArea` is the only prop
// that reaches the catalogue, and it is enough to render either one. The
// managing header and the fetch paths are effects SSR never runs; those are
// pinned by reading the source, the same way `webui-shell.test.ts` does.

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { PluginManagement } from "../../src/client/components/PluginManagement.js";
import type { WebuiTransport } from "../../src/client/contracts.js";

const transport = {
  pluginManagement: async () => ({ plugins: [] }),
} as unknown as WebuiTransport;

const marketplace = (initialArea: "plugins" | "skills"): string =>
  renderToStaticMarkup(
    createElement(PluginManagement, {
      transport,
      onClose: () => undefined,
      initialArea,
    }),
  );

const component = readFileSync(
  new URL("../../src/client/components/PluginManagement.tsx", import.meta.url),
  "utf8",
);

describe("plugin marketplace catalogue", () => {
  it("offers 插件 and 技能 instead of 市场 and 个人", () => {
    const html = marketplace("plugins");
    expect(html).toContain('aria-pressed="true">插件</button>');
    expect(html).toContain(">技能</button>");
    // The pair the split was asked for: gone from the marketplace header.
    expect(html).not.toContain(">市场</button>");
    expect(html).not.toContain(">个人</button>");
  });

  it("keeps plugins and skills on separate pages", () => {
    const plugins = marketplace("plugins");
    const skills = marketplace("skills");
    // Each tab marks its own page, and the plugin page no longer appends the
    // skill grid below the plugin grid.
    expect(plugins).toContain('aria-pressed="true">插件</button>');
    expect(plugins).not.toContain('aria-pressed="true">技能</button>');
    expect(skills).toContain('aria-pressed="true">技能</button>');
    expect(skills).not.toContain('aria-pressed="true">插件</button>');
    expect(plugins).not.toContain("webui-plugin-market-skill-grid");
    expect(skills).not.toContain("webui-plugin-market-skill-grid");
  });

  it("narrows the plugin page by category and the skill page by search alone", () => {
    const plugins = marketplace("plugins");
    const skills = marketplace("skills");
    // The marketplace categories are the plugin catalogue's; a skill hub has
    // no such axis, so the nav is withheld rather than shown inert.
    expect(plugins).toContain("市场分类");
    expect(skills).not.toContain("市场分类");
    expect(plugins).toContain('placeholder="搜索插件..."');
    expect(skills).toContain('placeholder="搜索技能..."');
  });

  it("labels each page for what it lists", () => {
    expect(marketplace("plugins")).toContain(">插件</h2>");
    expect(marketplace("skills")).toContain(">技能</h2>");
  });
});

describe("plugin marketplace data paths", () => {
  it("stops asking the plugin listing for a skills side payload", () => {
    // `skillLimit` existed only to feed the embedded grid. The skill catalogue
    // has its own operation, so the plugin request no longer carries it.
    expect(component).not.toContain("skillLimit");
    expect(component).not.toContain("marketSkills");
    expect(component).toContain('request("listSkillHub"');
  });

  it("clears the plugin category filter when the catalogue changes", () => {
    // The categories cannot narrow the skill list, so carrying one over would
    // leave a filter applied to a list it does not describe.
    expect(component).toMatch(
      /const selectMarketCatalog = \(catalog: "plugins" \| "skills"\) => \{[\s\S]*?setCategory\(""\);/,
    );
  });

  it("keeps 市场 / 个人 on the management header", () => {
    // The pair still means something there — it is how you reach what is
    // installed — so the split moved the control rather than deleting it.
    // Bounded by the create-menu anchor that follows the header's two branches.
    const managingHeader = component.slice(
      component.indexOf("{managementOpen ? ("),
      component.indexOf("webui-plugin-create-anchor"),
    );
    // The label sits on its own line in the source, so match it the way the
    // file is written rather than the way it renders.
    expect(managingHeader).toMatch(/>\s*市场\s*<\/button>/);
    expect(managingHeader).toMatch(/>\s*个人\s*<\/button>/);
    expect(managingHeader).toContain('aria-pressed={view === "market"}');
    expect(managingHeader).toContain('aria-pressed={view === "personal"}');
    expect(managingHeader).toContain('setView("market")');
    expect(managingHeader).toContain('setView("personal")');
    // …and the marketplace branch in the same span is the catalogue pair.
    expect(managingHeader).toContain('onClick={() => selectMarketCatalog("plugins")}');
    expect(managingHeader).toContain('onClick={() => selectMarketCatalog("skills")}');
  });
});
