import { marked, type Token } from "marked";
import {
  createElement,
  Fragment,
  type ReactElement,
  type ReactNode,
} from "react";

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong")
      return <strong key={key}>{inline(token.tokens)}</strong>;
    if (token.type === "em") return <em key={key}>{inline(token.tokens)}</em>;
    if (token.type === "codespan") return <code key={key}>{token.text}</code>;
    if (token.type === "link")
      return (
        <a key={key} href={token.href} rel="noreferrer">
          {inline(token.tokens)}
        </a>
      );
    if (token.type === "br") return <br key={key} />;
    if (token.type === "text")
      return (
        <Fragment key={key}>
          {token.tokens ? inline(token.tokens) : token.text}
        </Fragment>
      );
    return (
      <Fragment key={key}>
        {"text" in token && typeof token.text === "string"
          ? token.text
          : token.raw}
      </Fragment>
    );
  });
}

function blocks(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "paragraph")
      return <p key={key}>{inline(token.tokens)}</p>;
    if (token.type === "heading")
      return createElement(`h${token.depth}`, { key }, ...inline(token.tokens));
    if (token.type === "code")
      return (
        <pre key={key}>
          <code data-language={token.lang ?? undefined}>{token.text}</code>
        </pre>
      );
    if (token.type === "blockquote")
      return <blockquote key={key}>{blocks(token.tokens)}</blockquote>;
    if (token.type === "list") {
      const items = token.items as Array<{ tokens: Token[] }>;
      return token.ordered ? (
        <ol key={key}>
          {items.map((item, i) => (
            <li key={i}>{blocks(item.tokens)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {items.map((item, i) => (
            <li key={i}>{blocks(item.tokens)}</li>
          ))}
        </ul>
      );
    }
    if (token.type === "hr") return <hr key={key} />;
    if (token.type === "space") return <br key={key} />;
    return (
      <p key={key}>
        {"text" in token && typeof token.text === "string"
          ? token.text
          : token.raw}
      </p>
    );
  });
}

export function WebuiMarkdown({
  source,
}: {
  readonly source: string;
}): ReactElement {
  let tokens: Token[];
  try {
    tokens = marked.lexer(source);
  } catch {
    tokens = [{ type: "text", raw: source, text: source }];
  }
  return <div data-webui-markdown="true">{blocks(tokens)}</div>;
}
