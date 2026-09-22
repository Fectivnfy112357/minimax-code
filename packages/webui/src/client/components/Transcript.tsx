import type { ReactNode } from "react";
import { WebuiMarkdown } from "../markdown.js";

export function Transcript({ messages, children }: { readonly messages?: readonly { readonly id: string; readonly answer: string }[]; readonly children?: ReactNode }) {
  if (children)
    return <div data-webui-component="transcript" className="contents">{children}</div>;
  if (!messages) return null;
  return <div className="flex flex-col gap-spacing_12">{messages.map((message) => <article key={message.id} className="webui-message"><WebuiMarkdown source={message.answer} /></article>)}</div>;
}
