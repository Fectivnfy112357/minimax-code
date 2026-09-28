import type { ReactNode } from "react";

/** Layout wrapper only — the real two-column shell is assembled inline in
 * `WebuiClientFoundationApp`, which renders the rail itself and passes just
 * `children` here.
 *
 * The `rail`-driven `aside`/`main` branch below is unreachable: the single
 * call site has never passed `rail`, so the shell has rendered through the
 * `contents` short-circuit since introduction. Note that `.webui-rail` stays
 * in the stylesheet regardless — the live rail markup uses that class too. */
export function ArchonShell({ children }: { readonly children: ReactNode }) {
  return <div data-webui-archon-shell="true" className="contents">{children}</div>;
}
