# The WebUI reuses the desktop application's visual language

The WebUI adopts the design tokens, typography and layout conventions of the
desktop application's frontend instead of designing its own. The desktop build
already ships a complete token system — primitive ramps, scale tokens, and 211
semantic tokens rebound per theme — and reusing it is what makes the browser client
look like the same product rather than a second one. The extraction is recorded in
[`docs/webui-visual-language.md`](../webui-visual-language.md).

## Considered Options

- **A new visual language for the WebUI** — rejected: two clients of one product
  would diverge in colour, spacing and type for no user benefit.
- **Reusing the terminal client's palette** — rejected: a terminal palette encodes
  ANSI colours and cell-based layout, which do not describe a browser surface.
- **Lifting the desktop stylesheet into this repository** — rejected: the values are
  design facts, but the file belongs to the distributed desktop build and this
  repository carries a license audit. The token file is re-authored from the values.

## Consequences

The desktop application is the reference, so a deliberate WebUI-only surface has to
be justified rather than defaulted to. Drift is easy to miss: nothing in this
repository compares the two token sets, so a change to the desktop tokens does not
reach the WebUI on its own.
