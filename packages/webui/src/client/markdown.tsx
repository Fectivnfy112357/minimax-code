import { marked, type Token } from "marked";
import katex from "katex";
import {
  createElement,
  Fragment,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

marked.use({
  extensions: [
    {
      name: "webuiMath",
      level: "inline",
      start(source) {
        const index = source.search(/\$\$?|\\\(/u);
        return index >= 0 ? index : undefined;
      },
      tokenizer(source) {
        const match = source.match(/^(\$\$?)([\s\S]+?)\1/u);
        if (!match) return undefined;
        return {
          type: "webuiMath",
          raw: match[0],
          text: match[2],
          display: match[1] === "$$",
        } as Token & { readonly display: boolean };
      },
    },
  ],
});

export function isSafeWebuiMarkdownHref(href: string): boolean {
  const value = href.trim();
  if (value.startsWith("#")) return true;
  if (value.startsWith("//")) return false;
  if (/^(?:https?|mailto):/iu.test(value)) return true;
  return !/^[a-z][a-z\d+.-]*:/iu.test(value);
}

function inline(tokens: readonly Token[] | undefined): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong")
      return <strong key={key}>{inline(token.tokens)}</strong>;
    if (token.type === "em") return <em key={key}>{inline(token.tokens)}</em>;
    if (token.type === "codespan") return <code key={key}>{token.text}</code>;
    if (token.type === "webuiMath") {
      const math = token as Token & { readonly text: string; readonly display: boolean };
      try {
        return (
          <span
            key={key}
            className={math.display ? "webui-math webui-math-block" : "webui-math"}
            dangerouslySetInnerHTML={{ __html: katex.renderToString(math.text, { displayMode: math.display }) }}
          />
        );
      } catch {
        return <code key={key}>{math.raw}</code>;
      }
    }
    if (token.type === "link")
      return isSafeWebuiMarkdownHref(token.href) ? (
        <a key={key} href={token.href} rel="noreferrer">
          {inline(token.tokens)}
        </a>
      ) : (
        <Fragment key={key}>{inline(token.tokens)}</Fragment>
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
        <div key={key} className="webui-code-block">
          <pre>
            <code data-language={token.lang ?? undefined}>{token.text}</code>
          </pre>
        </div>
      );
    if (token.type === "table") {
      type Align = "left" | "right" | "center" | null | undefined;
      const table = token as {
        header: Array<{ text: string; tokens?: Token[]; align?: Align }>;
        rows: Array<Array<{ text: string; tokens?: Token[]; align?: Align }>>;
        align?: Align[];
      };
      const cellAlign = (
        cell: { align?: Align },
        index: number,
      ): CSSProperties | undefined => {
        const value = cell.align ?? table.align?.[index];
        return value ? { textAlign: value } : undefined;
      };
      return (
        <div key={key} className="webui-table-shell">
          <table>
            <thead>
              <tr>
                {table.header.map((cell, index) => (
                  <th key={index} style={cellAlign(cell, index)}>
                    {inline(cell.tokens)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={cellAlign(cell, cellIndex)}>
                      {inline(cell.tokens)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
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
  return (
    <div data-webui-markdown="true" className="webui-markdown">
      {blocks(tokens)}
    </div>
  );
}
