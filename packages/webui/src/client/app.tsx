// Two-column shell for the WebUI (ticket 04).
//
// Layout (from docs/webui-visual-language.md):
//   * A left navigation rail at ~18% of the viewport, one step darker than
//     the main surface (bg_grouped_secondary on top of bg_default_primary).
//   * A main surface at the lightest step, holding placeholder content.
//
// The shell uses token-derived utility classes so the rendered output
// lines up with the desktop application even when the harness is not
// running.

import type { ReactElement } from "react";

export interface WebuiClientFoundationAppProps {
  readonly label: string;
}

export function WebuiClientFoundationApp({
  label,
}: WebuiClientFoundationAppProps): ReactElement {
  return (
    <div
      data-webui-shell="two-column"
      className="grid grid-cols-[18%_1fr] size-size_full min-h-screen"
    >
      <nav
        aria-label="Primary navigation"
        data-webui-shell-region="rail"
        className="bg-bg_grouped_secondary border-r border-border_default"
      >
        <div className="flex flex-col gap-spacing_4 p-spacing_8">
          <span
            className="text-text_default_secondary text-size_12 leading-line_height_16"
            data-webui-shell-placeholder="rail-header"
          >
            {label}
          </span>
          <ul className="flex flex-col gap-spacing_2">
            <li className="rounded-radius_8 p-spacing_6 text-text_default_primary text-size_14 leading-line_height_20">
              Sessions
            </li>
            <li className="rounded-radius_8 p-spacing_6 text-text_default_secondary text-size_14 leading-line_height_20">
              New session
            </li>
            <li className="rounded-radius_8 p-spacing_6 text-text_default_secondary text-size_14 leading-line_height_20">
              Settings
            </li>
          </ul>
        </div>
      </nav>
      <main
        data-webui-shell-region="surface"
        className="bg-bg_default_primary"
      >
        <div className="flex flex-col gap-spacing_12 p-spacing_16 size-size_full">
          <header className="flex flex-col gap-spacing_4">
            <span className="text-text_default_secondary text-size_12 leading-line_height_16">
              webui-foundation 0.1.0
            </span>
            <h1 className="text-text_default_primary text-size_24 leading-line_height_28 font-weight_medium">
              Placeholder conversation surface
            </h1>
          </header>
          <p className="text-text_default_secondary text-size_14 leading-line_height_20 max-w-[640px]">
            Two-column shell with the desktop application's design tokens. The
            harness data is not wired up in this slice; later tickets will
            stream messages, render tool output and handle permission prompts
            here.
          </p>
          <pre
            className="font-mono text-size_12 leading-line_height_16 bg-bg_grouped_secondary rounded-radius_8 p-spacing_8 text-text_default_secondary"
            data-webui-shell-placeholder="code-snippet"
          >{`const greeting = "你好, monospace code sample";\nconsole.log(greeting);`}</pre>
        </div>
      </main>
    </div>
  );
}

export default WebuiClientFoundationApp;