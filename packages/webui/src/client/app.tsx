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

import { useEffect, useMemo, useState, type ReactElement } from "react";

export interface WebuiClientMessage {
  readonly msgId: string;
  readonly msgContent?: string;
  readonly role?: string;
  readonly thinkingContent?: string;
  readonly thinkingDurationMs?: number;
  readonly toolCalls?: readonly Record<string, unknown>[];
}

export interface WebuiClientSession {
  readonly sessionId: string;
  readonly agentName: string;
  readonly title?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface WebuiClientSessionPage {
  readonly sessions: readonly WebuiClientSession[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export type WebuiClientSessionLoader = (cursor?: string) => Promise<WebuiClientSessionPage>;

export interface WebuiClientMessagePage {
  readonly messages?: readonly WebuiClientMessage[];
  readonly nextCursor?: string;
  readonly hasMore?: boolean;
}

export type WebuiClientMessageLoader = (request: {
  readonly id: string;
  readonly before?: string;
}) => Promise<WebuiClientMessagePage>;

export function readSessionIdFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const id = params.get("session");
  return id?.trim() || undefined;
}

export function sessionHash(sessionId: string): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  return `#${params.toString()}`;
}

export type WebuiTranscriptItem =
  | { readonly kind: "user" | "assistant" | "thinking"; readonly text: string; readonly messageId: string }
  | { readonly kind: "tool"; readonly messageId: string; readonly tools: readonly Record<string, unknown>[] };

export function projectWebuiMessage(message: WebuiClientMessage): WebuiTranscriptItem[] {
  const items: WebuiTranscriptItem[] = [];
  if (message.thinkingContent)
    items.push({ kind: "thinking", text: message.thinkingContent, messageId: message.msgId });
  if (message.toolCalls?.length)
    items.push({ kind: "tool", tools: message.toolCalls, messageId: message.msgId });
  if (message.msgContent)
    items.push({ kind: message.role === "user" ? "user" : "assistant", text: message.msgContent, messageId: message.msgId });
  return items;
}

export interface WebuiClientFoundationAppProps {
  readonly label: string;
  readonly sessionPage?: WebuiClientSessionPage;
  readonly loadSessions?: WebuiClientSessionLoader;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly locationHash?: string;
}

function sessionLabel(session: WebuiClientSession): string {
  return session.title?.trim() || session.agentName || session.sessionId;
}

function sessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

export function WebuiSessionList({
  page,
  loading,
  onLoadMore,
}: {
  readonly page: WebuiClientSessionPage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
}): ReactElement {
  const sessions = useMemo(
    () => [...page.sessions].sort((left, right) => right.updatedAt - left.updatedAt),
    [page.sessions],
  );
  return (
    <section aria-label="Sessions" className="flex flex-col gap-spacing_8">
      <h2 className="text-text_default_primary text-size_16 leading-line_height_22 font-weight_medium">Sessions</h2>
      {sessions.length === 0 ? (
        <p className="text-text_default_secondary text-size_14 leading-line_height_20">No sessions yet.</p>
      ) : (
        <ul className="flex flex-col gap-spacing_4" data-webui-session-list="true">
          {sessions.map((session) => (
            <li key={session.sessionId} className="rounded-radius_8 bg-bg_grouped_secondary p-spacing_8">
              <a href={sessionHash(session.sessionId)} data-webui-session-link={session.sessionId}>
                <div className="text-text_default_primary text-size_14 leading-line_height_20">{sessionLabel(session)}</div>
              </a>
              <time
                className="text-text_default_secondary text-size_12 leading-line_height_16"
                dateTime={new Date(session.updatedAt).toISOString()}
              >
                {sessionTime(session.updatedAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <button type="button" onClick={onLoadMore} disabled={loading}>
          {loading ? "Loading…" : "Load more"}
        </button>
      ) : null}
    </section>
  );
}

export function WebuiSessionTranscript({
  sessionId,
  loadMessages,
}: {
  readonly sessionId: string;
  readonly loadMessages: WebuiClientMessageLoader;
}): ReactElement {
  const [page, setPage] = useState<WebuiClientMessagePage>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(undefined);
    void loadMessages({ id: sessionId }).then((nextPage) => {
      if (!cancelled) setPage(nextPage);
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadMessages, sessionId]);
  const items = useMemo(() => (page.messages ?? []).flatMap(projectWebuiMessage), [page.messages]);
  const loadOlder = page.hasMore && page.nextCursor ? () => {
    setLoading(true);
    void loadMessages({ id: sessionId, before: page.nextCursor }).then((olderPage) => {
      setPage((current) => ({
        messages: [...(olderPage.messages ?? []), ...(current.messages ?? [])],
        nextCursor: olderPage.nextCursor,
        hasMore: olderPage.hasMore,
      }));
    }).finally(() => setLoading(false));
  } : undefined;
  return (
    <section aria-label="Transcript" data-webui-transcript={sessionId}>
      <h2>Conversation</h2>
      {error ? <p role="alert">Unable to load messages: {error}</p> : null}
      {!error && !loading && items.length === 0 ? <p>No messages in this session.</p> : null}
      <ol>{items.map((item, index) => (
        <li key={`${item.messageId}-${item.kind}-${index}`} data-webui-message-kind={item.kind}>
          {item.kind === "tool" ? `Tool activity (${item.tools.length})` : item.text}
        </li>
      ))}</ol>
      {loadOlder ? <button type="button" onClick={loadOlder} disabled={loading}>Load older</button> : null}
    </section>
  );
}

export function WebuiClientFoundationApp({
  label,
  sessionPage,
  loadSessions,
  locationHash,
  loadMessages,
}: WebuiClientFoundationAppProps): ReactElement {
  const [page, setPage] = useState<WebuiClientSessionPage>(sessionPage ?? { sessions: [], hasMore: false });
  const [loading, setLoading] = useState(false);
  const [selectedSessionId] = useState(() =>
    readSessionIdFromHash(locationHash ?? (typeof window === "undefined" ? "" : window.location.hash)),
  );
  useEffect(() => {
    if (!loadSessions || sessionPage) return;
    let cancelled = false;
    setLoading(true);
    void loadSessions().then((nextPage) => {
      if (!cancelled) setPage(nextPage);
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [loadSessions, sessionPage]);
  const loadMore = loadSessions && page.hasMore ? () => {
    setLoading(true);
    void loadSessions(page.nextCursor).then((nextPage) => {
      setPage((current) => ({
        sessions: [...current.sessions, ...nextPage.sessions],
        hasMore: nextPage.hasMore,
        nextCursor: nextPage.nextCursor,
      }));
    }).finally(() => setLoading(false));
  } : undefined;
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
          <WebuiSessionList page={page} loading={loading} onLoadMore={loadMore} />
          {selectedSessionId && loadMessages ? (
            <WebuiSessionTranscript sessionId={selectedSessionId} loadMessages={loadMessages} />
          ) : null}
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
