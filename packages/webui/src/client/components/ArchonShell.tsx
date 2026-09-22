import type { ReactNode } from "react";

export function ArchonShell({ rail, children }: { readonly rail?: ReactNode; readonly children: ReactNode }) {
  if (rail === undefined)
    return <div data-webui-archon-shell="true" className="contents">{children}</div>;
  return <div className="flex min-h-screen bg-bg_default_primary text-text_default_primary">
    <aside className="webui-rail hidden min-h-screen shrink-0 p-spacing_16 md:flex">{rail}</aside>
    <main className="min-w-0 flex-1">{children}</main>
  </div>;
}
