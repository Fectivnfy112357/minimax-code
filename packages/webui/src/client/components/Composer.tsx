import { useState, type ReactNode } from "react";

export function Composer({ onSubmit, disabled, children }: { readonly onSubmit?: (text: string) => void; readonly disabled?: boolean; readonly children?: ReactNode }) {
  if (children)
    return <div data-webui-component="composer" className="contents">{children}</div>;
  const [draft, setDraft] = useState("");
  return <form className="webui-card flex flex-col gap-spacing_8 p-spacing_16" onSubmit={(event) => { event.preventDefault(); if (draft.trim()) { onSubmit?.(draft.trim()); setDraft(""); } }}>
    <textarea className="webui-textarea webui-composer-input" value={draft} disabled={disabled} onChange={(event) => setDraft(event.target.value)} placeholder="Ask MiniMax Code anything" />
    <div className="flex items-center justify-end gap-spacing_8"><button className="webui-send-button" type="submit" disabled={disabled || !draft.trim()}>Send</button></div>
  </form>;
}
