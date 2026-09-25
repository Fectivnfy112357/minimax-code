import { marked, type Token } from "marked";
import katex from "katex";
import {
  createElement,
  Fragment,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";
import { parseWebuiMessageFileReference } from "./projection/message-file-reference.js";

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
        const delimiter = match[1];
        const body = match[2];
        if (delimiter === undefined || body === undefined) return undefined;
        // A single dollar is inline math only. It cannot cross a line or
        // attach to a number, so ordinary prose such as "$5 and $10" stays
        // prose. Display math keeps the existing multiline behaviour.
        if (
          delimiter === "$" &&
          (body.includes("\n") || /^\d/u.test(body))
        )
          return undefined;
        return {
          type: "webuiMath",
          raw: match[0],
          text: body,
          display: delimiter === "$$",
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

function inline(tokens: readonly Token[] | undefined, onOpenFile?: (reference: NonNullable<ReturnType<typeof parseWebuiMessageFileReference>>) => void): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "strong")
      return <strong key={key}>{inline(token.tokens, onOpenFile)}</strong>;
    if (token.type === "em") return <em key={key}>{inline(token.tokens, onOpenFile)}</em>;
    if (token.type === "codespan") {
      const reference = onOpenFile ? parseWebuiMessageFileReference(token.text) : undefined;
      return reference
        ? <a key={key} href={token.text} data-webui-file-reference={reference.path} onClick={(event) => { event.preventDefault(); onOpenFile?.(reference); }}><code>{token.text}</code></a>
        : <code key={key}>{token.text}</code>;
    }
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
    if (token.type === "link") {
      const fileReference = onOpenFile ? parseWebuiMessageFileReference(token.href) : undefined;
      return isSafeWebuiMarkdownHref(token.href) ? (
        <a key={key} href={token.href} rel="noreferrer" {...(fileReference ? { "data-webui-file-reference": fileReference.path, onClick: (event: React.MouseEvent<HTMLAnchorElement>) => { event.preventDefault(); onOpenFile?.(fileReference); } } : {})}>
          {inline(token.tokens)}
        </a>
      ) : (
        <Fragment key={key}>{inline(token.tokens, onOpenFile)}</Fragment>
      );
    }
    if (token.type === "br") return <br key={key} />;
    if (token.type === "text") {
      if (token.tokens) return <Fragment key={key}>{inline(token.tokens, onOpenFile)}</Fragment>;
      if (!onOpenFile) return token.text;
      const parts: ReactNode[] = [];
      const expression = /(?<![\w/:])(?:\.\.?\/)?[\w@.+-]+(?:\/[\w@.+-]+)*\.[A-Za-z0-9_-]+(?::\d+(?:-\d+)?)?/gu;
      let cursor = 0;
      for (const match of token.text.matchAll(expression)) {
        const start = match.index ?? 0;
        const text = match[0];
        const reference = parseWebuiMessageFileReference(text);
        if (!reference || !(/\//u.test(reference.path) || /\.(?:[cm]?[jt]sx?|html|css|json|md|ya?ml|toml|rs|py|go|java|kt|sh)$/iu.test(reference.path))) continue;
        if (start > cursor) parts.push(token.text.slice(cursor, start));
        parts.push(<a key={`${key}-file-${start}`} href={text} data-webui-file-reference={reference.path} onClick={(event) => { event.preventDefault(); onOpenFile(reference); }}>{text}</a>);
        cursor = start + text.length;
      }
      if (cursor === 0) return token.text;
      if (cursor < token.text.length) parts.push(token.text.slice(cursor));
      return <Fragment key={key}>{parts}</Fragment>;
    }
    return (
      <Fragment key={key}>
        {"text" in token && typeof token.text === "string"
          ? token.text
          : token.raw}
      </Fragment>
    );
  });
}

function blocks(tokens: readonly Token[] | undefined, onOpenFile?: (reference: NonNullable<ReturnType<typeof parseWebuiMessageFileReference>>) => void): ReactNode[] {
  return (tokens ?? []).map((token, index) => {
    const key = `${token.type}-${index}`;
    if (token.type === "paragraph")
      return <p key={key}>{inline(token.tokens, onOpenFile)}</p>;
    if (token.type === "heading")
      return createElement(`h${token.depth}`, { key }, ...inline(token.tokens, onOpenFile));
    if (token.type === "code" && token.lang?.toLowerCase() === "math") {
      try {
        return (
          <span
            key={key}
            className="webui-math webui-math-block"
            dangerouslySetInnerHTML={{
              __html: katex.renderToString(token.text, { displayMode: true }),
            }}
          />
        );
      } catch {
        return <pre key={key}>{token.text}</pre>;
      }
    }
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
      return <blockquote key={key}>{blocks(token.tokens, onOpenFile)}</blockquote>;
    if (token.type === "list") {
      const items = token.items as Array<{ tokens: Token[] }>;
      return token.ordered ? (
        <ol key={key}>
          {items.map((item, i) => (
          <li key={i}>{blocks(item.tokens, onOpenFile)}</li>
          ))}
        </ol>
      ) : (
        <ul key={key}>
          {items.map((item, i) => (
          <li key={i}>{blocks(item.tokens, onOpenFile)}</li>
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

export function WebuiMarkdown({ source, onOpenFile }: {
  readonly source: string;
  readonly onOpenFile?: (reference: NonNullable<ReturnType<typeof parseWebuiMessageFileReference>>) => void;
}): ReactElement {
  let tokens: Token[];
  try {
    tokens = marked.lexer(source);
  } catch {
    tokens = [{ type: "text", raw: source, text: source }];
  }
  return (
    <div data-webui-markdown="true" className="matrix-markdown webui-markdown">
      {blocks(tokens, onOpenFile)}
    </div>
  );
}
