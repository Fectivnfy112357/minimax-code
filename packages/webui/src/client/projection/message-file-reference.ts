export interface WebuiMessageFileReference {
  readonly path: string;
  readonly lineStart?: number;
  readonly lineEnd?: number;
}

/** Accept only workspace-relative paths; links and prose remain ordinary markdown. */
export function parseWebuiMessageFileReference(value: string): WebuiMessageFileReference | undefined {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "");
  if (!normalized || /^(?:https?:|mailto:|\/\/|\/|[a-z]:\/)/iu.test(normalized)) return undefined;
  const match = normalized.match(/^([^:]+?)(?::(\d+)(?:-(\d+))?)?$/u);
  if (!match) return undefined;
  const path = match[1];
  if (!path || (!path.includes("/") && !/\.[a-z\d_-]+$/iu.test(path))) return undefined;
  if (path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) return undefined;
  if (!/^[\w.@+-]+(?:[\w.@+\-/]*[\w.@+-])?$/u.test(path)) return undefined;
  const lineStart = match[2] ? Number(match[2]) : undefined;
  const lineEnd = match[3] ? Number(match[3]) : undefined;
  if (lineStart !== undefined && (!Number.isSafeInteger(lineStart) || lineStart < 1)) return undefined;
  if (lineEnd !== undefined && (!Number.isSafeInteger(lineEnd) || lineEnd < (lineStart ?? 1))) return undefined;
  return { path, ...(lineStart !== undefined ? { lineStart } : {}), ...(lineEnd !== undefined ? { lineEnd } : {}) };
}
