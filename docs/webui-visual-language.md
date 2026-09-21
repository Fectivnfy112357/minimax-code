# WebUI visual language

The WebUI does not invent a visual language. It reuses the one the desktop
application already ships, extracted from the compiled stylesheet in the unpacked
desktop build and from a rendered screenshot of its conversation surface. Nothing
below is designed here; it is read out of those two sources.

## Sources

- The desktop build's main compiled stylesheet, 235 KB, under the static export's
  CSS directory. The design tokens are the first three blocks in it.
- A rendered screenshot of the desktop conversation surface, kept with the
  unpacking project rather than in this repository.

## Token architecture

Three layers, all of them plain custom properties.

**1. Primitive ramps.** Ten-step ramps named `--<hue>_25` through `--<hue>_1000`
for `blue`, `cyan`, `gray`, `green`, `orange`, `purple`, `red` and `yellow`, plus a
single `--violet_500`, and two opacity ramps: `--opacity_black_1_*` and
`--opacity_white_0_*`.

**2. Scale tokens.**

| Group | Tokens |
| --- | --- |
| Radius | `--radius_4` `_8` `_12` `_16` `_20` `_24` `_32` `_full` |
| Spacing | `--spacing_0` `_2` `_4` `_6` `_8` `_12` `_16` `_20` `_24` `_32` `_40` `_48` `_64` `_90` `_128` |
| Type size | `--size_12` `_14` `_16` `_20` `_24` `_32` `_40` `_48` `_64` |
| Line height | `--line_height_16` `_18` `_20` `_22` `_26` `_28` `_36` `_40` |
| Weight | `--weight_regular` `--weight_medium` |

**3. Semantic tokens.** 211 of them, named
`<role>_<group>_<component>_<state>`:

- Roles: `bg`, `text`, `icon`, `border`, `utility`, `terminal`, `shadow`, `screen`
- Groups: `default`, `grouped`, `interaction`, `label`, `status`
- States: `default`, `hover`, `press`, `inactive`, `selected`, `focus`, `elevated`

Representative names: `bg_default_primary`, `bg_grouped_secondary`,
`bg_interaction_primary_hover`, `text_default_tertiary`,
`text_label_danger_primary_press`, `icon_interaction_accent_selected`,
`border_status_warning`, `utility_popover`, `utility_scrim`,
`terminal_ansi_bright_magenta`, `shadow_default`.

## Theme mechanism

`:root` carries the ramps and the light values. `.light` and `.dark` each rebind the
211 semantic tokens, and neither block contains anything but custom properties, so
either can be lifted whole. The rebinding is a straight swap onto the ramps:

| Token | Light | Dark |
| --- | --- | --- |
| `--bg_default_primary` | `var(--gray_0)` | `var(--gray_1000)` |
| `--bg_default_secondary` | `var(--gray_75)` | `var(--gray_900)` |
| `--text_default_primary` | `var(--gray_1000)` | `var(--gray_100)` |
| `--text_default_secondary` | `var(--gray_500)` | `var(--gray_400)` |
| `--border_default` | `var(--opacity_black_1_8)` | `var(--opacity_white_0_8)` |
| `--utility_popover` | `var(--opacity_black_1_90)` | `var(--opacity_white_0_95)` |

## Typography

- **Sans**: `HarmonyOS Sans`, then `Segoe UI` / `SF Pro Display` and the system
  stack, with `HarmonyOS Sans SC` and `PingFang SC` for Chinese.
- **Mono**: `Hack`, then `ui-monospace` / `SFMono-Regular` / `SF Mono` / `Menlo` /
  `Consolas`, with the same Chinese fallbacks.
- **Serif**: a bundled `SourceSerif` / `SourceSerifItalic` face, used for
  document-like surfaces.

## Utility naming

The stylesheet is Tailwind, configured so that token names become utility names:
`bg-bg_default_primary`, `text-text_default_primary`, `border-border_default`,
`rounded-radius_8`, `size-size_14`, `leading-line_height_20`, `gap-spacing_4`,
`shadow-shadow_default`. Roughly a thousand token-derived utilities appear in the
compiled output, alongside `w-*` / `h-*` sizes and ordinary layout utilities.

## Layout, read from the rendered reference

- Two columns: a left navigation rail at roughly 18% of the width on a surface one
  step darker than the main one, and the main surface at the lightest step.
- The conversation surface is a vertical stack: generous space at the top, the
  centred brand welcome as the visual anchor, the composer low on the screen.
- The composer is a large-radius field (16–20px) with a near-invisible 1px border,
  a leading attach button, a trailing model selector, and a solid dark circular send
  button — the highest-contrast element on the screen.
- Below it, a one-step-darker capsule row carries the workspace picker and a local
  tag; below that, a row of outlined suggestion chips.
- The emphasis colour is the bright blue from the ramp, used sparingly: a link, the
  accent bar on a card, small badges. One purple badge appears once.
- Density is low. Menu rows sit around 13–14px with 12–14px gaps, and the composer
  is surrounded by a lot of empty space.

## Consequences for the WebUI

- Reuse these token names and values. A second palette would make the two clients
  look like two products.
- Theme switching is a `.light` / `.dark` class on a root element, which lines up
  with the theme the harness already reports.
- Surfaces the desktop app has no equivalent for — the browser session list,
  reconnect state, queue state — are built from these tokens rather than from new
  colours.
- Do not lift the compiled stylesheet into this repository. The values are design
  facts, but the file belongs to the distributed desktop build and this repository
  carries a license audit (`LICENSE-STATUS.md`,
  `release/dependency-licenses.json`). Re-author the token file from these values.
