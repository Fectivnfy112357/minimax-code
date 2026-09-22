import { WebuiMarkdown } from "../markdown.js";

export function Transcript({ messages }: { readonly messages: readonly { readonly id: string; readonly answer: string }[] }) {
  return <div className="flex flex-col gap-spacing_12">{messages.map((message) => <article key={message.id} className="webui-message"><WebuiMarkdown source={message.answer} /></article>)}</div>;
}

