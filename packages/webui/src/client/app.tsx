// Shell and conversation surface for the WebUI client.
//
// The anatomy, the values and the icon set are read out of the desktop application's
// front-end as it renders; the extraction is recorded in
// `minimax-code-webui-work/webui-visual-align-spec.md` and
// `minimax-code-webui-work/webui-visual-align-icons.md`, and the reasoning is
// docs/webui-visual-language.md with ADR 0009.
//
// Two kinds of copy live on this screen and they do not mix:
//   * Shell chrome reproduced from the desktop (rail rows, section header, headline,
//     composer hint, chips, identity row) carries the desktop's own wording, because the
//     element is a replica of the desktop's element.
//   * Surfaces that exist only in the WebUI (the create-session card, the transcript,
//     stream refusals) keep this client's existing English copy. Changing the product's
//     interface language is not a styling decision.
//
// Elements marked `data-webui-placeholder-chrome` reproduce the desktop's shape with the
// desktop's label while the WebUI has no feature behind them yet. They are inert and
// carry `aria-disabled`, so the screen reads correctly without presenting a control that
// claims to do something it cannot.

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { WebuiMarkdown } from "./markdown.js";
import {
  WebuiIconAttach,
  WebuiIconBell,
  WebuiIconBrand,
  WebuiIconChevronDown,
  WebuiIconFolder,
  WebuiIconNewTask,
  WebuiIconPlugins,
  WebuiIconRemote,
  WebuiIconRunLocation,
  WebuiIconSchedule,
  WebuiIconSearch,
  WebuiIconSend,
  WebuiIconSidebarToggle,
  WebuiIconSites,
} from "./icons.js";
import { initialWebuiStreamState, type WebuiStreamState } from "./stream.js";
import {
  buildWebuiStreamLoopSink,
  runWebuiStreamLoop,
  type WebuiStreamLoopDeps,
  type WebuiStreamLoopSink,
} from "./stream-loop.js";
import type {
  WebuiInteractionReplyResult,
  WebuiPendingPermission,
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireRequest,
  WebuiQueueItem,
  WebuiEnqueueMessageRequest,
  WebuiEnqueueMessageResult,
  WebuiModelEntry,
  WebuiRuntimeEvent,
  WebuiStreamFrame,
} from "../server/port.js";

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
  readonly workspaceDir?: string;
}

export interface WebuiClientSessionPage {
  readonly sessions: readonly WebuiClientSession[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
}

export type WebuiClientSessionLoader = (
  cursor?: string,
) => Promise<WebuiClientSessionPage>;

export interface WebuiClientMessagePage {
  readonly messages?: readonly WebuiClientMessage[];
  readonly nextCursor?: string;
  readonly hasMore?: boolean;
}

export type WebuiClientMessageLoader = (request: {
  readonly id: string;
  readonly before?: string;
}) => Promise<WebuiClientMessagePage>;

export interface WebuiClientCreateSessionRequest {
  readonly name: string;
  readonly workspaceDir: string;
}
export interface WebuiClientCreateSessionResult {
  readonly sessionId?: string;
  readonly session?: {
    readonly sessionId?: string;
    readonly workspaceDir?: string;
  };
}
export type WebuiClientSessionCreator = (
  request: WebuiClientCreateSessionRequest,
) => Promise<WebuiClientCreateSessionResult>;
export type WebuiClientMessageSender = (
  request: { readonly id: string; readonly content: string },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export type WebuiClientMessageEnqueuer = (
  request: WebuiEnqueueMessageRequest,
) => Promise<WebuiEnqueueMessageResult>;

export type WebuiClientSessionResumer = (
  request: {
    readonly id: string;
    readonly afterCursor?: string;
    readonly afterMsgId?: string;
    readonly drainQueued?: boolean;
  },
  onFrame: (frame: WebuiStreamFrame) => void,
) => Promise<void>;

export type WebuiClientEventWatcher = (
  onEvent: (event: WebuiRuntimeEvent) => void,
  onReconnect?: () => void,
) => () => void;

/**
 * A provider/model pair is not always a unique picker identity: one catalog
 * entry can expose multiple variants. Keep the variant in the native select
 * value so the lookup that follows a change selects the same catalog entry
 * that the user actually chose.
 */
export function webuiModelOptionValue(model: WebuiModelEntry): string {
  return `${model.providerId}/${model.modelId}/${model.variant ?? ""}`;
}

export function readSessionIdFromHash(hash: string): string | undefined {
  const params = new URLSearchParams(
    hash.startsWith("#") ? hash.slice(1) : hash,
  );
  const id = params.get("session");
  return id?.trim() || undefined;
}

export function sessionHash(sessionId: string): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  return `#${params.toString()}`;
}

export type WebuiTranscriptItem =
  | {
      readonly kind: "user" | "assistant" | "thinking";
      readonly text: string;
      readonly messageId: string;
    }
  | {
      readonly kind: "tool";
      readonly messageId: string;
      readonly tools: readonly Record<string, unknown>[];
    };

export function projectWebuiMessage(
  message: WebuiClientMessage,
): WebuiTranscriptItem[] {
  const items: WebuiTranscriptItem[] = [];
  if (message.thinkingContent)
    items.push({
      kind: "thinking",
      text: message.thinkingContent,
      messageId: message.msgId,
    });
  if (message.toolCalls?.length)
    items.push({
      kind: "tool",
      tools: message.toolCalls,
      messageId: message.msgId,
    });
  if (message.msgContent)
    items.push({
      kind: message.role === "user" ? "user" : "assistant",
      text: message.msgContent,
      messageId: message.msgId,
    });
  return items;
}

export interface WebuiClientFoundationAppProps {
  readonly label: string;
  readonly sessionPage?: WebuiClientSessionPage;
  readonly loadSessions?: WebuiClientSessionLoader;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly locationHash?: string;
  readonly createSession?: WebuiClientSessionCreator;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly listPendingPermissions?: () => Promise<{
    readonly requests: readonly WebuiPendingPermission[];
  }>;
  readonly getPendingQuestionnaire?: (request: {
    readonly name: string;
    readonly sessionId: string;
  }) => Promise<{ readonly request?: WebuiQuestionnaireRequest }>;
  readonly replyPermission?: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly reply: "allowOnce" | "allowAlways" | "deny";
  }) => Promise<WebuiInteractionReplyResult>;
  readonly replyQuestionnaire?: (request: {
    readonly name: string;
    readonly requestId: string;
    readonly schemaVersion: number;
    readonly answers: readonly WebuiQuestionnaireAnswer[];
  }) => Promise<WebuiInteractionReplyResult>;
  readonly dismissQuestionnaire?: (request: {
    readonly name: string;
    readonly requestId: string;
  }) => Promise<WebuiInteractionReplyResult>;
  readonly abortSession?: (request: {
    readonly id: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly listQueueMessages?: (request: { readonly id: string }) => Promise<{
    readonly items?: readonly WebuiQueueItem[];
    readonly paused?: boolean;
    readonly pendingCount?: number;
  }>;
  readonly deleteQueueItem?: (request: {
    readonly id: string;
    readonly itemId: string;
  }) => Promise<{ readonly item?: WebuiQueueItem }>;
  readonly listModels?: (request?: {
    readonly sessionId?: string;
  }) => Promise<readonly WebuiModelEntry[]>;
  readonly selectModel?: (request: {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly sessionId?: string;
  }) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: (request: {
    readonly id: string;
  }) => Promise<Record<string, unknown>>;
  readonly getAccountStatus?: (request?: {
    readonly sessionId?: string;
  }) => Promise<Record<string, unknown>>;
  /**
   * What the identity row shows under the product name. The desktop puts the signed-in
   * account's plan there; the WebUI is loopback-only and has no account, so it reports
   * the scope it actually runs in. `main.tsx` passes the page's host.
   */
  readonly hostLabel?: string;
}

function useSelectedSessionId(
  locationHash?: string,
): [string | undefined, (id: string) => void] {
  const read = () =>
    readSessionIdFromHash(
      locationHash ??
        (typeof window === "undefined" ? "" : window.location.hash),
    );
  const [selected, setSelected] = useState(read);
  useEffect(() => {
    if (locationHash !== undefined || typeof window === "undefined") return;
    return subscribeToSessionHash((id) => setSelected(id));
  }, [locationHash]);
  return [selected, setSelected];
}

export function subscribeToSessionHash(
  onChange: (sessionId: string | undefined) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onHashChange = () =>
    onChange(readSessionIdFromHash(window.location.hash));
  window.addEventListener("hashchange", onHashChange);
  return () => window.removeEventListener("hashchange", onHashChange);
}

interface WebuiSessionRuntimeState {
  readonly stream: WebuiStreamState;
  readonly sending: boolean;
}

const sessionRuntimeStates = new Map<string, WebuiSessionRuntimeState>();
const sessionRuntimeListeners = new Map<
  string,
  Set<(state: WebuiSessionRuntimeState) => void>
>();

function readSessionRuntimeState(sessionKey: string): WebuiSessionRuntimeState {
  return (
    sessionRuntimeStates.get(sessionKey) ?? {
      stream: initialWebuiStreamState,
      sending: false,
    }
  );
}

function updateSessionRuntimeState(
  sessionKey: string,
  update: (current: WebuiSessionRuntimeState) => WebuiSessionRuntimeState,
): void {
  const next = update(readSessionRuntimeState(sessionKey));
  sessionRuntimeStates.set(sessionKey, next);
  for (const listener of sessionRuntimeListeners.get(sessionKey) ?? [])
    listener(next);
}

function useSessionRuntimeState(sessionId: string | undefined): {
  readonly state: WebuiSessionRuntimeState;
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: (sending: boolean) => void;
} {
  const sessionKey = sessionId ?? "__webui-home__";
  const [state, setState] = useState(() => readSessionRuntimeState(sessionKey));
  useEffect(() => {
    setState(readSessionRuntimeState(sessionKey));
    let listeners = sessionRuntimeListeners.get(sessionKey);
    if (!listeners) {
      listeners = new Set();
      sessionRuntimeListeners.set(sessionKey, listeners);
    }
    const listener = (next: WebuiSessionRuntimeState) => setState(next);
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) sessionRuntimeListeners.delete(sessionKey);
    };
  }, [sessionKey]);
  return {
    state,
    setStream: (update) =>
      updateSessionRuntimeState(sessionKey, (current) => ({
        ...current,
        stream: update(current.stream),
      })),
    setSending: (sending) =>
      updateSessionRuntimeState(sessionKey, (current) => ({
        ...current,
        sending,
      })),
  };
}

export function createdSessionId(
  result: WebuiClientCreateSessionResult,
): string | undefined {
  return (
    result.sessionId?.trim() || result.session?.sessionId?.trim() || undefined
  );
}

function sessionLabel(session: WebuiClientSession): string {
  return session.title?.trim() || session.agentName || session.sessionId;
}

function sessionTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}

/**
 * The rail's recent-tasks block. A row is the desktop's session row: 30px tall, 8px
 * radius, `text-sm`, a 0.5px hairline in the gutter, fill only on hover — see the spec's
 * "Measured values".
 */
export function WebuiSessionList({
  page,
  loading,
  onLoadMore,
  selectedSessionId,
  error,
}: {
  readonly page: WebuiClientSessionPage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly error?: string;
}): ReactElement {
  const sessions = useMemo(
    () =>
      [...page.sessions].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    [page.sessions],
  );
  return (
    <div
      className="transition-colors group/project-list"
      data-webui-rail-sessions="true"
    >
      <div
        className="group/section flex h-[30px] items-center gap-1 pl-2 pr-0.5"
        data-webui-rail-section-header="true"
      >
        <span className="truncate text-sm font-normal leading-5 text-text_default_tertiary">
          最近任务
        </span>
        <span className="ml-auto flex-shrink-0 text-sm font-normal leading-5 text-text_default_tertiary">
          {sessions.length}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load sessions: {error}
        </p>
      ) : null}
      {!error && sessions.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          No sessions yet.
        </p>
      ) : (
        <ul className="pt-px space-y-px" data-webui-session-list="true">
          {sessions.map((session) => (
            <li key={session.sessionId} data-webui-session-card="true">
              <a
                href={sessionHash(session.sessionId)}
                data-webui-session-link={session.sessionId}
                data-webui-session-active={
                  selectedSessionId === session.sessionId ? "true" : "false"
                }
                title={session.workspaceDir ?? undefined}
                className="webui-session-card text-text_default_primary"
              >
                <span className="flex h-[31px] w-[18px] flex-shrink-0 items-center justify-center">
                  <span className="block h-[31px] w-0 border-l-[0.5px] border-border_default" />
                </span>
                <span className="w-0 flex-1 truncate text-sm">
                  {sessionLabel(session)}
                </span>
                <time
                  className="ml-auto flex-shrink-0 text-xs leading-4 text-text_default_tertiary"
                  dateTime={new Date(session.updatedAt).toISOString()}
                >
                  {sessionTime(session.updatedAt)}
                </time>
              </a>
              {session.workspaceDir ? (
                <div
                  data-webui-workspace-dir={session.workspaceDir}
                  className="truncate pl-[28px] pr-1 text-xs leading-4 text-text_default_tertiary"
                >
                  {session.workspaceDir}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Group a flat transcript into one block per message, so a single turn renders
 * as the desktop renders it: one block carrying its process steps and its
 * answer. Exported because it is the contract the transcript's markup depends
 * on.
 */
export function groupWebuiTranscriptItems(
  items: readonly WebuiTranscriptItem[],
): { messageId: string; items: WebuiTranscriptItem[] }[] {
  const out: { messageId: string; items: WebuiTranscriptItem[] }[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (last && last.messageId === item.messageId) last.items.push(item);
    else out.push({ messageId: item.messageId, items: [item] });
  }
  return out;
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
    void loadMessages({ id: sessionId })
      .then((nextPage) => {
        if (!cancelled) setPage(nextPage);
      })
      .catch((reason: unknown) => {
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadMessages, sessionId]);
  const items = useMemo(
    () => (page.messages ?? []).flatMap(projectWebuiMessage),
    [page.messages],
  );
  // Group by message so one turn renders as one block, the way the desktop
  // does: a process disclosure carrying the thinking and the tool steps, then
  // the assistant's markdown. A user turn is its own block.
  const groups = useMemo(() => groupWebuiTranscriptItems(items), [items]);
  const loadOlder =
    page.hasMore && page.nextCursor
      ? () => {
          setLoading(true);
          void loadMessages({ id: sessionId, before: page.nextCursor })
            .then((olderPage) => {
              setPage((current) => ({
                messages: [
                  ...(olderPage.messages ?? []),
                  ...(current.messages ?? []),
                ],
                nextCursor: olderPage.nextCursor,
                hasMore: olderPage.hasMore,
              }));
            })
            .finally(() => setLoading(false));
        }
      : undefined;
  return (
    <section
      aria-label="Transcript"
      data-webui-transcript={sessionId}
      className="flex w-full flex-col"
    >
      <div
        className="flex w-full flex-col gap-spacing_8"
        data-webui-message-list="true"
      >
        {error ? (
          <p
            role="alert"
            className="text-text_default_secondary text-size_14 leading-line_height_20"
          >
            Unable to load messages: {error}
          </p>
        ) : null}
        {!error && !loading && items.length === 0 ? (
          <p className="text-text_default_secondary text-size_14 leading-line_height_20">
            No messages in this session.
          </p>
        ) : null}
        {loadOlder ? (
          <div className="flex justify-start">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loading}
              className="webui-button-secondary text-text_default_primary text-size_14 leading-line_height_20"
            >
              Load older
            </button>
          </div>
        ) : null}
        {groups.map((group) => {
          const userItem = group.items.find(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "user",
          );
          if (userItem)
            return (
              <div
                key={group.messageId}
                className="webui-message"
                data-webui-message-root={group.messageId}
                data-webui-message-role="user"
              >
                <div className="flex w-full justify-end">
                  <div className="flex w-full flex-col items-end gap-spacing_8">
                    <div
                      className="webui-user-bubble"
                      data-webui-user-bubble="true"
                    >
                      <div className="webui-user-text-clamp">
                        <p
                          className="webui-user-text"
                          data-webui-message-kind="user"
                          data-webui-user-text="true"
                        >
                          <span>{userItem.text}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          const processItems = group.items.filter(
            (item) => item.kind === "thinking" || item.kind === "tool",
          );
          const answers = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "assistant",
          );
          return (
            <div
              key={group.messageId}
              className="webui-message"
              data-webui-message-root={group.messageId}
              data-webui-message-role="assistant"
            >
              <div className="flex w-full flex-col">
                {processItems.length ? (
                  <section
                    className="pt-spacing_8"
                    data-webui-turn-process="true"
                  >
                    <details>
                      <summary className="flex w-fit cursor-pointer list-none items-center gap-spacing_4 py-spacing_4 text-activity-body-small text-text_default_tertiary">
                        <span>{`共 ${processItems.length} 步`}</span>
                      </summary>
                      <div className="webui-turn-process-separator" />
                      <div className="flex min-w-0 flex-col gap-spacing_8 overflow-hidden pt-spacing_8">
                        {processItems.map((item, index) => (
                          <div
                            key={`${item.messageId}-process-${index}`}
                            data-webui-message-kind={item.kind}
                            className="text-text_default_secondary text-size_14 leading-line_height_20"
                          >
                            {item.kind === "tool" ? (
                              `Tool activity (${item.tools.length})`
                            ) : (
                              <div className="webui-markdown-thinking">
                                <WebuiMarkdown source={item.text} />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  </section>
                ) : null}
                {answers.map((item, index) => (
                  <div
                    key={`${item.messageId}-answer-${index}`}
                    data-webui-message-kind="assistant"
                  >
                    <WebuiMarkdown source={item.text} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/**
 * A rail row. `webui-nav-item` carries the shared hover and selected treatment; the fixed
 * row passes `active` so the current destination reads differently from a hover-only row.
 */
function RailRow({
  label,
  icon,
  active,
  onSelect,
  inert,
}: {
  readonly label: string;
  readonly icon?: ReactElement;
  readonly active?: boolean;
  readonly onSelect?: () => void;
  readonly inert?: boolean;
}): ReactElement {
  return (
    <div
      className="webui-nav-item group/nav flex h-8 w-full items-center rounded-lg text-sm text-text_default_primary transition-colors hover:bg-bg_interaction_tertiary_hover"
      data-webui-placeholder-chrome={inert ? "rail-nav" : undefined}
      data-webui-nav-item={label}
      data-webui-nav-active={active ? "true" : "false"}
    >
      <button
        type="button"
        onClick={onSelect}
        disabled={inert}
        aria-disabled={inert ? "true" : undefined}
        tabIndex={inert ? -1 : undefined}
        className="flex h-full min-w-0 flex-1 items-center gap-2 pl-2 pr-2.5 text-left focus:outline-none"
      >
        {icon ? (
          <span className="flex flex-shrink-0 items-center justify-center">
            {icon}
          </span>
        ) : null}
        <span className="min-w-0 flex-1 truncate whitespace-nowrap">
          {label}
        </span>
      </button>
    </div>
  );
}

/**
 * Pure form-submit handler extracted from the React component so a test
 * can drive the production app-to-helper seam without standing up a
 * DOM. The React component in this file (`WebuiComposer`) calls this
 * helper with the same handlers it derives from `useState`; the helper
 * itself is the single source of truth for the production wiring.
 *
 * The seam that the test must cover is `buildWebuiStreamLoopSink`:
 * omitting the helper, passing a no-op state setter, or ignoring the
 * returned sink all leave the React component unable to render the
 * stream. The shell test drives this function end-to-end and asserts
 * the resulting state matches the reachable outcomes.
 */
export interface WebuiComposerSubmitArgs {
  readonly sessionId?: string;
  readonly draft: string;
  readonly sending: boolean;
  readonly deps: WebuiStreamLoopDeps;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
}

export interface WebuiComposerSubmitHandlers {
  readonly setStream: (
    update: (current: WebuiStreamState) => WebuiStreamState,
  ) => void;
  readonly setSending: (sending: boolean) => void;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
  readonly onQueued?: () => void;
}

/**
 * Assemble the React-state setters the submit handler needs into the
 * shape `submitWebuiComposerTurn` accepts. The component in this file
 * calls this once per render with the setters it derives from
 * `useState`, then hands the result to `submitWebuiComposerTurn`. The
 * helper is a single-line pass-through by design — its job is to make
 * the assembly a named unit that a test can drive, so a regression
 * that drops, swaps, or ignores a field is caught by a failing
 * assertion. The shell test
 * `webui-shell.test.ts > "buildWebuiComposerHandlers passes every
 * field through unchanged"` walks each field and asserts identity,
 * which would die if a future change confused `setStream` with
 * `setSending`.
 *
 * Note that this covers the helper itself, not the component's call
 * into it. The component's `submit = async (event) => { ... await
 * submitWebuiComposerTurn(args, buildWebuiComposerHandlers({...})) }`
 * line is verified by inspection only — no DOM environment exists,
 * and source-text assertions are not allowed in this project.
 */
export function buildWebuiComposerHandlers(args: {
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: WebuiComposerSubmitHandlers["setSending"];
  readonly onDraftChange: WebuiComposerSubmitHandlers["onDraftChange"];
  readonly onNeedsSession?: WebuiComposerSubmitHandlers["onNeedsSession"];
  readonly onQueued?: WebuiComposerSubmitHandlers["onQueued"];
}): WebuiComposerSubmitHandlers {
  return {
    setStream: args.setStream,
    setSending: args.setSending,
    onDraftChange: args.onDraftChange,
    onNeedsSession: args.onNeedsSession,
    onQueued: args.onQueued,
  };
}

export async function submitWebuiComposerTurn(
  args: WebuiComposerSubmitArgs,
  handlers: WebuiComposerSubmitHandlers,
): Promise<void> {
  const message = args.draft.trim();
  if (!message || (!args.deps.sendMessage && !args.enqueueMessage)) return;
  if (!args.sessionId) {
    handlers.onNeedsSession?.(args.draft);
    return;
  }
  if (args.sending) {
    if (!args.enqueueMessage) return;
    try {
      await args.enqueueMessage({ id: args.sessionId, content: message });
      handlers.onDraftChange("");
      handlers.onQueued?.();
    } catch (error) {
      handlers.setStream((current) => ({
        ...current,
        refusal: error instanceof Error ? error.message : String(error),
      }));
    }
    return;
  }
  if (!args.deps.sendMessage) return;
  handlers.setSending(true);
  handlers.onDraftChange("");
  // Initialise the reducer state via the live `setStream`. The
  // production binding goes through `buildWebuiStreamLoopSink`
  // unconditionally — there is no test-only override; the seam
  // coverage comes from the helper test and the production-path
  // test that drives this function end-to-end.
  handlers.setStream((current) => ({
    ...initialWebuiStreamState,
    phase: "streaming",
  }));
  try {
    await runWebuiStreamLoop(
      args.deps,
      { sessionId: args.sessionId, message },
      buildWebuiStreamLoopSink(handlers.setStream),
    );
  } finally {
    handlers.setSending(false);
  }
}

function eventSessionId(event: WebuiRuntimeEvent): string | undefined {
  const value = event.payload.sessionId ?? event.payload.session_id;
  return typeof value === "string" ? value : undefined;
}

function pendingPermissionFromEvent(
  event: WebuiRuntimeEvent,
): WebuiPendingPermission | undefined {
  const payload = event.payload;
  if (
    typeof payload.requestId !== "string" ||
    typeof payload.sessionId !== "string" ||
    typeof payload.agentName !== "string" ||
    typeof payload.toolName !== "string" ||
    !Array.isArray(payload.ruleContents) ||
    !payload.ruleContents.every((item) => typeof item === "string") ||
    typeof payload.reason !== "string" ||
    typeof payload.allowAlwaysSupported !== "boolean" ||
    typeof payload.createdAt !== "number"
  )
    return undefined;
  return {
    requestId: payload.requestId,
    sessionId: payload.sessionId,
    agentName: payload.agentName,
    toolName: payload.toolName,
    ruleContents: payload.ruleContents,
    ...(typeof payload.toolInput === "string"
      ? { toolInput: payload.toolInput }
      : {}),
    ...(typeof payload.toolDescription === "string"
      ? { toolDescription: payload.toolDescription }
      : {}),
    reason: payload.reason,
    allowAlwaysSupported: payload.allowAlwaysSupported,
    createdAt: payload.createdAt,
  };
}

function questionnaireFromEvent(
  event: WebuiRuntimeEvent,
): WebuiQuestionnaireRequest | undefined {
  const value = event.payload.request;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const request = value as Partial<WebuiQuestionnaireRequest>;
  if (
    typeof request.id !== "string" ||
    typeof request.schemaVersion !== "number" ||
    !Array.isArray(request.steps)
  )
    return undefined;
  return request as WebuiQuestionnaireRequest;
}

function replacePermission(
  current: readonly WebuiPendingPermission[],
  next: WebuiPendingPermission,
): readonly WebuiPendingPermission[] {
  return [
    ...current.filter((permission) => permission.requestId !== next.requestId),
    next,
  ];
}

function optionIdsForStep(
  selections: Readonly<Record<string, readonly string[]>>,
  stepId: string,
): readonly string[] {
  return selections[stepId] ?? [];
}

function WebuiInteractionPanel({
  sessionId,
  permissions,
  questionnaire,
  onPermission,
  onQuestionnaire,
  onDismiss,
  interactionError,
}: {
  readonly sessionId: string;
  readonly permissions: readonly WebuiPendingPermission[];
  readonly questionnaire?: WebuiQuestionnaireRequest;
  readonly onPermission: (
    request: WebuiPendingPermission,
    decision: "allowOnce" | "allowAlways" | "deny",
  ) => Promise<void>;
  readonly onQuestionnaire: (
    request: WebuiQuestionnaireRequest,
    answers: readonly WebuiQuestionnaireAnswer[],
  ) => Promise<void>;
  readonly onDismiss: (request: WebuiQuestionnaireRequest) => Promise<void>;
  readonly interactionError?: string;
}): ReactElement {
  const [selections, setSelections] = useState<
    Readonly<Record<string, readonly string[]>>
  >({});
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => setSelections({}), [questionnaire?.id]);
  const visiblePermissions = permissions.filter(
    (permission) => permission.sessionId === sessionId,
  );
  return (
    <div
      className="mt-3 flex w-full flex-col gap-3"
      data-webui-interactions={sessionId}
    >
      {visiblePermissions.map((permission) => (
        <article
          key={permission.requestId}
          className="webui-card flex flex-col gap-2 p-spacing_16"
          data-webui-permission-request={permission.requestId}
          aria-label="Permission request"
        >
          <strong>Permission required</strong>
          <span className="text-text_default_secondary text-size_14">
            {permission.toolName}: {permission.reason}
          </span>
          {permission.toolDescription ? (
            <span className="text-text_default_secondary text-size_12">
              {permission.toolDescription}
            </span>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="webui-button-primary text-size_14"
              onClick={() => void onPermission(permission, "allowOnce")}
            >
              Allow once
            </button>
            {permission.allowAlwaysSupported ? (
              <button
                type="button"
                className="webui-button-secondary text-size_14"
                onClick={() => void onPermission(permission, "allowAlways")}
              >
                Always allow
              </button>
            ) : null}
            <button
              type="button"
              className="webui-button-secondary text-size_14"
              onClick={() => void onPermission(permission, "deny")}
            >
              Deny
            </button>
          </div>
        </article>
      ))}
      {questionnaire ? (
        <article
          className="webui-card flex flex-col gap-3 p-spacing_16"
          data-webui-questionnaire-request={questionnaire.id}
          aria-label={questionnaire.title ?? "Questionnaire"}
        >
          <div>
            <strong>{questionnaire.title ?? "Questionnaire"}</strong>
            <p className="text-text_default_secondary text-size_12">
              The turn is waiting for your answer.
            </p>
          </div>
          {questionnaire.steps.map((step) => {
            const selected = optionIdsForStep(selections, step.id);
            const multiple =
              step.selectionMode === 1 ||
              (step.selectionMode as unknown) === "multiple";
            return (
              <fieldset key={step.id} className="flex flex-col gap-1">
                <legend className="text-size_14 font-weight_medium">
                  {step.question}
                </legend>
                {step.description ? (
                  <span className="text-text_default_secondary text-size_12">
                    {step.description}
                  </span>
                ) : null}
                {(step.options ?? []).map((option) => {
                  const checked = selected.includes(option.id);
                  return (
                    <label
                      key={option.id}
                      className="flex items-start gap-2 text-size_14"
                    >
                      <input
                        type={multiple ? "checkbox" : "radio"}
                        name={`${questionnaire.id}-${step.id}`}
                        checked={checked}
                        onChange={() =>
                          setSelections((current) => ({
                            ...current,
                            [step.id]: multiple
                              ? checked
                                ? selected.filter((id) => id !== option.id)
                                : [...selected, option.id]
                              : [option.id],
                          }))
                        }
                      />
                      <span>
                        {option.label}
                        {option.description ? (
                          <small className="ml-1 text-text_default_secondary">
                            {option.description}
                          </small>
                        ) : null}
                      </span>
                    </label>
                  );
                })}
              </fieldset>
            );
          })}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="webui-button-primary text-size_14"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void onQuestionnaire(
                  questionnaire,
                  questionnaire.steps.map((step) => ({
                    stepId: step.id,
                    selectedOptionIds: optionIdsForStep(selections, step.id),
                  })),
                ).finally(() => setSubmitting(false));
              }}
            >
              Submit answer
            </button>
            <button
              type="button"
              className="webui-button-secondary text-size_14"
              disabled={submitting}
              onClick={() => {
                setSubmitting(true);
                void onDismiss(questionnaire).finally(() =>
                  setSubmitting(false),
                );
              }}
            >
              Dismiss
            </button>
          </div>
        </article>
      ) : null}
      {interactionError ? (
        <p role="alert" className="text-text_default_secondary text-size_12">
          Unable to answer interaction: {interactionError}
        </p>
      ) : null}
    </div>
  );
}

function WebuiComposer({
  sessionId,
  agentName,
  sendMessage,
  resumeSession,
  loadMessages,
  watchEvents,
  listPendingPermissions,
  getPendingQuestionnaire,
  replyPermission,
  replyQuestionnaire,
  dismissQuestionnaire,
  abortSession,
  listQueueMessages,
  deleteQueueItem,
  listModels,
  selectModel,
  getSessionUsage,
  getAccountStatus,
  draft,
  onDraftChange,
  onNeedsSession,
  enqueueMessage,
}: {
  readonly sessionId?: string;
  readonly agentName: string;
  readonly sendMessage?: WebuiClientMessageSender;
  readonly enqueueMessage?: WebuiClientMessageEnqueuer;
  readonly resumeSession?: WebuiClientSessionResumer;
  readonly loadMessages?: WebuiClientMessageLoader;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly listPendingPermissions?: WebuiClientFoundationAppProps["listPendingPermissions"];
  readonly getPendingQuestionnaire?: WebuiClientFoundationAppProps["getPendingQuestionnaire"];
  readonly replyPermission?: WebuiClientFoundationAppProps["replyPermission"];
  readonly replyQuestionnaire?: WebuiClientFoundationAppProps["replyQuestionnaire"];
  readonly dismissQuestionnaire?: WebuiClientFoundationAppProps["dismissQuestionnaire"];
  readonly abortSession?: WebuiClientFoundationAppProps["abortSession"];
  readonly listQueueMessages?: WebuiClientFoundationAppProps["listQueueMessages"];
  readonly deleteQueueItem?: WebuiClientFoundationAppProps["deleteQueueItem"];
  readonly listModels?: WebuiClientFoundationAppProps["listModels"];
  readonly selectModel?: WebuiClientFoundationAppProps["selectModel"];
  readonly getSessionUsage?: WebuiClientFoundationAppProps["getSessionUsage"];
  readonly getAccountStatus?: WebuiClientFoundationAppProps["getAccountStatus"];
  /** The draft lives on the shell so it survives the session-creation detour. */
  readonly draft: string;
  readonly onDraftChange: (next: string) => void;
  readonly onNeedsSession?: (draft: string) => void;
}): ReactElement {
  const {
    state: runtimeState,
    setStream,
    setSending,
  } = useSessionRuntimeState(sessionId);
  const { stream, sending } = runtimeState;
  const [permissions, setPermissions] = useState<
    readonly WebuiPendingPermission[]
  >([]);
  const [questionnaire, setQuestionnaire] =
    useState<WebuiQuestionnaireRequest>();
  const [interactionError, setInteractionError] = useState<string>();
  const [queueItems, setQueueItems] = useState<readonly WebuiQueueItem[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const [models, setModels] = useState<readonly WebuiModelEntry[]>([]);
  const [usage, setUsage] = useState<Record<string, unknown>>();
  const [accountStatus, setAccountStatus] = useState<Record<string, unknown>>();
  const fieldId = useId();

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    const refreshPending = async () => {
      const [permissionResult, questionnaireResult] = await Promise.all([
        listPendingPermissions?.(),
        getPendingQuestionnaire?.({ name: agentName, sessionId }),
      ]);
      if (cancelled) return;
      const sessionPermissions = (permissionResult?.requests ?? []).filter(
        (permission) => permission.sessionId === sessionId,
      );
      setPermissions(sessionPermissions);
      setQuestionnaire(questionnaireResult?.request);
      if (sessionPermissions.length > 0 || questionnaireResult?.request)
        setStream((current) => ({ ...current, phase: "waiting" }));
      if (listQueueMessages) {
        const queue = await listQueueMessages({ id: sessionId });
        if (cancelled) return;
        setQueueItems(queue.items ?? []);
        setQueuePaused(queue.paused === true);
      }
    };
    void refreshPending().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    const unsubscribe = watchEvents?.(
      (event) => {
        if (eventSessionId(event) !== sessionId) return;
        if (event.type === "session.start") {
          setSending(true);
          setStream((current) => ({ ...current, phase: "streaming" }));
          return;
        }
        if (
          event.type === "session.finish" ||
          event.type === "session.abort" ||
          event.type === "session.error"
        ) {
          setSending(false);
          setStream((current) => ({
            ...current,
            phase: "done",
            status:
              event.type === "session.finish"
                ? "finished"
                : event.type === "session.abort"
                  ? "aborted"
                  : "error",
            ...(typeof event.payload.error === "string"
              ? { refusal: event.payload.error }
              : {}),
          }));
          return;
        }
        if (event.type === "session.queue.updated") {
          void refreshPending().catch(() => undefined);
          return;
        }
        if (event.type === "permission.ask") {
          const permission = pendingPermissionFromEvent(event);
          if (permission) {
            setPermissions((current) => replacePermission(current, permission));
            setStream((current) => ({ ...current, phase: "waiting" }));
          }
          return;
        }
        if (event.type === "permission.resolved") {
          const requestId = event.payload.requestId;
          if (typeof requestId === "string")
            setPermissions((current) =>
              current.filter(
                (permission) => permission.requestId !== requestId,
              ),
            );
          setStream((current) => ({ ...current, phase: "streaming" }));
          return;
        }
        if (event.type === "questionnaire.ask") {
          const request = questionnaireFromEvent(event);
          if (request) {
            setQuestionnaire(request);
            setStream((current) => ({ ...current, phase: "waiting" }));
          }
          return;
        }
        if (
          event.type === "questionnaire.dismiss" ||
          event.type === "questionnaire.superseded"
        ) {
          const requestId = event.payload.requestId;
          if (typeof requestId === "string")
            setQuestionnaire((current) =>
              current?.id === requestId ? undefined : current,
            );
          setStream((current) => ({ ...current, phase: "streaming" }));
        }
      },
      () => void refreshPending().catch(() => undefined),
    );
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [
    agentName,
    getPendingQuestionnaire,
    listPendingPermissions,
    listQueueMessages,
    sessionId,
    watchEvents,
  ]);

  useEffect(() => {
    if (!sessionId) return undefined;
    let cancelled = false;
    const refreshInspection = async () => {
      const [nextModels, nextUsage, nextAccount] = await Promise.all([
        listModels?.({ sessionId }),
        getSessionUsage?.({ id: sessionId }),
        getAccountStatus?.({ sessionId }),
      ]);
      if (cancelled) return;
      if (nextModels) setModels(nextModels);
      if (nextUsage) setUsage(nextUsage);
      if (nextAccount) setAccountStatus(nextAccount);
    };
    void refreshInspection().catch((error: unknown) => {
      if (!cancelled)
        setInteractionError(
          error instanceof Error ? error.message : String(error),
        );
    });
    const timer = setInterval(() => {
      void refreshInspection().catch(() => undefined);
    }, 2_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [getAccountStatus, getSessionUsage, listModels, sessionId]);

  const handlePermission = async (
    permission: WebuiPendingPermission,
    decision: "allowOnce" | "allowAlways" | "deny",
  ) => {
    if (!replyPermission) return;
    setInteractionError(undefined);
    try {
      const result = await replyPermission({
        name: permission.agentName,
        requestId: permission.requestId,
        reply: decision,
      });
      if (result.success !== true)
        throw new Error("The permission request was no longer pending");
      setPermissions((current) =>
        current.filter((item) => item.requestId !== permission.requestId),
      );
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleQuestionnaire = async (
    request: WebuiQuestionnaireRequest,
    answers: readonly WebuiQuestionnaireAnswer[],
  ) => {
    if (!replyQuestionnaire) return;
    setInteractionError(undefined);
    try {
      const result = await replyQuestionnaire({
        name: request.requester?.agentName ?? agentName,
        requestId: request.id,
        schemaVersion: request.schemaVersion,
        answers,
      });
      if (result.ok !== true)
        throw new Error("The questionnaire was not accepted");
      setQuestionnaire(undefined);
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDismiss = async (request: WebuiQuestionnaireRequest) => {
    if (!dismissQuestionnaire) return;
    setInteractionError(undefined);
    try {
      const result = await dismissQuestionnaire({
        name: request.requester?.agentName ?? agentName,
        requestId: request.id,
      });
      if (result.ok !== true)
        throw new Error("The questionnaire could not be dismissed");
      setQuestionnaire(undefined);
      setStream((current) => ({ ...current, phase: "streaming" }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleStop = async () => {
    if (!sessionId || !abortSession) return;
    setInteractionError(undefined);
    try {
      const result = await abortSession({ id: sessionId });
      if (result.success === false)
        throw new Error("The running turn could not be stopped");
      setSending(false);
      setStream((current) => ({
        ...current,
        phase: "done",
        status: "aborted",
      }));
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleDeleteQueueItem = async (item: WebuiQueueItem) => {
    if (!deleteQueueItem || !sessionId) return;
    setInteractionError(undefined);
    try {
      await deleteQueueItem({ id: sessionId, itemId: item.itemId });
      setQueueItems((current) =>
        current.filter((candidate) => candidate.itemId !== item.itemId),
      );
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const handleSelectModel = async (value: string) => {
    if (!sessionId || !selectModel) return;
    const model = models.find(
      (candidate) => webuiModelOptionValue(candidate) === value,
    );
    if (!model) return;
    setInteractionError(undefined);
    try {
      const result = await selectModel({
        providerId: model.providerId,
        modelId: model.modelId,
        ...(model.variant ? { variant: model.variant } : {}),
        sessionId,
      });
      if (result.success === false)
        throw new Error("The model could not be selected");
      const refreshed = await listModels?.({ sessionId });
      if (refreshed) setModels(refreshed);
    } catch (error) {
      setInteractionError(
        error instanceof Error ? error.message : String(error),
      );
    }
  };

  const selectedModel = models.find((model) => model.selected);
  const summary =
    usage?.summary &&
    typeof usage.summary === "object" &&
    !Array.isArray(usage.summary)
      ? (usage.summary as Record<string, unknown>)
      : undefined;
  const credentialMessage =
    typeof selectedModel?.status?.lastErrorMessage === "string"
      ? selectedModel.status.lastErrorMessage
      : accountStatus && accountStatus.available === false
        ? "No usable credentials are available for the selected model."
        : undefined;
  // Typing is always available: composing a message does not need a target yet.
  // Only the send path does, and it asks for the one missing thing instead of
  // leaving the field disabled with no explanation.
  const canCompose = Boolean(sendMessage);
  const canQueue = Boolean(enqueueMessage && sessionId);
  const sendable = (canCompose || canQueue) && Boolean(draft.trim());
  // The submit handler is a single call into
  // `submitWebuiComposerTurn` with the assembled handler bundle. The
  // assembly itself is `buildWebuiComposerHandlers` — a named unit
  // the shell test drives — so a regression that drops, swaps, or
  // ignores a field inside the assembly is caught by a failing
  // assertion. The component's call site here is verified by
  // inspection: with no DOM environment, the React render path
  // cannot be exercised, and source-text assertions are not part
  // of this project's policy.
  const handlers = buildWebuiComposerHandlers({
    setStream,
    setSending,
    onDraftChange,
    onNeedsSession,
    onQueued: () => {
      if (!sessionId || !listQueueMessages) return;
      void listQueueMessages({ id: sessionId })
        .then((queue) => {
          setQueueItems(queue.items ?? []);
          setQueuePaused(queue.paused === true);
        })
        .catch((error: unknown) => {
          setInteractionError(
            error instanceof Error ? error.message : String(error),
          );
        });
    },
  });
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await submitWebuiComposerTurn(
      {
        sessionId,
        draft,
        sending,
        deps: { sendMessage, resumeSession, loadMessages },
        enqueueMessage,
      },
      handlers,
    );
  };
  return (
    <section aria-label="Compose message" className="w-full">
      {sessionId ? (
        <WebuiInteractionPanel
          sessionId={sessionId}
          permissions={permissions}
          questionnaire={questionnaire}
          onPermission={handlePermission}
          onQuestionnaire={handleQuestionnaire}
          onDismiss={handleDismiss}
          interactionError={interactionError}
        />
      ) : null}
      {stream.phase === "waiting" ? (
        <p
          role="status"
          data-webui-turn-waiting="true"
          className="mt-3 text-text_default_secondary text-size_14 leading-line_height_20"
        >
          Waiting for your answer…
        </p>
      ) : null}
      {sessionId &&
      (sending ||
        stream.phase === "streaming" ||
        stream.phase === "waiting") ? (
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            className="webui-button-secondary text-size_14"
            onClick={() => void handleStop()}
            data-webui-stop-turn="true"
          >
            Stop turn
          </button>
          {queuePaused ? (
            <span
              role="status"
              className="text-text_default_secondary text-size_12"
            >
              Queue paused
            </span>
          ) : null}
        </div>
      ) : null}
      {queueItems.length > 0 ? (
        <section
          className="mt-3 flex w-full flex-col gap-2"
          data-webui-queue="true"
        >
          <strong className="text-size_14">
            Waiting messages ({queueItems.length})
          </strong>
          {queueItems.map((item) => (
            <article
              key={item.itemId}
              className="webui-card flex items-center gap-2 p-spacing_12"
            >
              <span className="min-w-0 flex-1 truncate text-size_14">
                {item.content || item.itemId}
              </span>
              {item.status === "queued" ? (
                <button
                  type="button"
                  className="webui-button-secondary text-size_12"
                  onClick={() => void handleDeleteQueueItem(item)}
                  data-webui-remove-queue-item={item.itemId}
                >
                  Remove
                </button>
              ) : null}
            </article>
          ))}
        </section>
      ) : null}
      {stream.phase === "reconnecting" ? (
        <p
          role="status"
          data-webui-reconnecting="true"
          className="text-text_default_secondary text-size_14 leading-line_height_20"
        >
          Reconnecting…
        </p>
      ) : null}
      {stream.messages.map((message) => (
        <article
          key={message.id}
          data-webui-stream-message={message.id}
          className="webui-card w-full p-spacing_16 text-text_default_primary text-size_14 leading-line_height_20"
        >
          {message.thinking ? (
            <details open>
              <summary>Thinking</summary>
              <WebuiMarkdown source={message.thinking} />
            </details>
          ) : null}
          {message.answer ? <WebuiMarkdown source={message.answer} /> : null}
        </article>
      ))}
      {stream.refusal ? (
        <p
          role="alert"
          className="text-text_default_secondary text-size_14 leading-line_height_20"
        >
          Unable to send message: {stream.refusal}
        </p>
      ) : null}
      {stream.transcriptIncomplete ? (
        <p
          data-webui-transcript-incomplete="true"
          className="text-text_default_secondary text-size_14 leading-line_height_20"
        >
          The displayed transcript may be incomplete; the last update failed
          before all frames could be applied.
        </p>
      ) : null}

      <div className="relative mt-8 w-full" data-webui-composer-region="true">
        <form onSubmit={submit} data-webui-composer="true" className="w-full">
          <div className="message-input-home-container flex flex-col items-center gap-1.5 rounded-[20px] bg-bg_default_scrim pb-2">
            <div className="w-full rounded-[20px] border border-border_default bg-bg_grouped_secondary_elevated p-3 webui-composer-card">
              <div className="message-input-container relative transition-colors">
                <label className="sr-only" htmlFor={`${fieldId}-content`}>
                  Message
                </label>
                <textarea
                  id={`${fieldId}-content`}
                  name="content"
                  rows={2}
                  value={draft}
                  onChange={(event) => onDraftChange(event.target.value)}
                  disabled={!canCompose && !canQueue}
                  placeholder="输入消息…（输入 / 唤起命令）"
                  className="webui-textarea webui-composer-input text-text_default_primary"
                  data-webui-composer-input="true"
                />
              </div>
              <div
                className="flex w-full items-center gap-3 px-3 pt-1"
                data-webui-composer-toolbar="true"
              >
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  tabIndex={-1}
                  aria-label="添加附件"
                  data-webui-placeholder-chrome="attach"
                  className="webui-icon-button text-icon_default_tertiary"
                >
                  <WebuiIconAttach />
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <label
                    className="webui-pill text-sm text-text_default_primary"
                    data-webui-model-selector="true"
                  >
                    <span className="sr-only">Model</span>
                    <select
                      value={
                        selectedModel
                          ? webuiModelOptionValue(selectedModel)
                          : ""
                      }
                      onChange={(event) =>
                        void handleSelectModel(event.target.value)
                      }
                      disabled={
                        !sessionId || models.length === 0 || !selectModel
                      }
                      aria-label="Model"
                    >
                      <option value="">
                        {selectedModel?.displayName ?? "选择模型"}
                      </option>
                      {models
                        .filter((model) => model.enabled !== false)
                        .map((model) => (
                          <option
                            key={webuiModelOptionValue(model)}
                            value={webuiModelOptionValue(model)}
                          >
                            {model.displayName ??
                              `${model.providerId}/${model.modelId}`}
                          </option>
                        ))}
                    </select>
                    <WebuiIconChevronDown className="flex-shrink-0 text-icon_default_tertiary" />
                  </label>
                  <button
                    type="submit"
                    disabled={!sendable}
                    aria-label="发送"
                    data-webui-composer-submit="true"
                    className="webui-send-button"
                  >
                    <WebuiIconSend />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </form>

        {/* The workspace pills sit outside the card, as they do on the desktop. */}
        <div
          className="flex w-full items-center gap-3 px-3"
          data-webui-workspace-toolbar="true"
        >
          <button
            type="button"
            disabled
            aria-disabled="true"
            tabIndex={-1}
            data-webui-placeholder-chrome="workspace-pill"
            className="webui-pill max-w-[220px] min-w-0 text-text_default_primary"
          >
            <span className="flex size-5 shrink-0 items-center justify-center text-icon_default_primary">
              <WebuiIconFolder />
            </span>
            <span className="min-w-0 flex-1 truncate whitespace-nowrap leading-5">
              选择文件夹
            </span>
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            tabIndex={-1}
            data-webui-placeholder-chrome="run-location-pill"
            className="webui-pill text-sm text-text_default_primary"
          >
            <WebuiIconRunLocation className="flex-shrink-0 text-icon_default_primary" />
            <span className="whitespace-nowrap">本地</span>
          </button>
        </div>
        {summary ? (
          <p
            className="mt-2 text-text_default_secondary text-size_12"
            data-webui-session-usage="true"
          >
            Usage:{" "}
            {String(summary.totalTokens ?? summary.total_tokens ?? "unknown")}{" "}
            tokens
          </p>
        ) : null}
        {credentialMessage ? (
          <p
            role="alert"
            data-webui-credential-warning="true"
            className="mt-2 text-text_default_secondary text-size_12"
          >
            Model credentials unavailable: {credentialMessage}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/** The desktop's quick-action row. Inert here: the WebUI ships no canned suggestions. */
function WebuiRecommendationChips(): ReactElement {
  const chips = [
    "视频生成",
    "编程开发",
    "Vibe Coding",
    "设计视觉",
    "问问 MCode",
  ];
  return (
    <section className="mt-3 w-full">
      <div
        className="flex w-full flex-col gap-3 rounded-2xl px-1.5 pb-1.5 pt-2 bg-transparent"
        data-webui-recommendations="true"
        data-webui-placeholder-chrome="recommendation-chips"
      >
        <div className="relative flex h-8 w-full items-center px-9">
          <div className="relative min-w-0 flex-1">
            <div className="overflow-x-auto" role="tablist">
              <div className="flex w-max min-w-full items-center justify-center gap-2">
                {chips.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    role="tab"
                    aria-selected="false"
                    disabled
                    aria-disabled="true"
                    tabIndex={-1}
                    className="webui-chip text-sm text-text_default_primary"
                  >
                    <span>{chip}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function WebuiClientFoundationApp({
  label,
  sessionPage,
  loadSessions,
  locationHash,
  loadMessages,
  createSession,
  sendMessage,
  enqueueMessage,
  resumeSession,
  watchEvents,
  listPendingPermissions,
  getPendingQuestionnaire,
  replyPermission,
  replyQuestionnaire,
  dismissQuestionnaire,
  abortSession,
  listQueueMessages,
  deleteQueueItem,
  listModels,
  selectModel,
  getSessionUsage,
  getAccountStatus,
  hostLabel,
}: WebuiClientFoundationAppProps): ReactElement {
  const [page, setPage] = useState<WebuiClientSessionPage>(
    sessionPage ?? { sessions: [], hasMore: false },
  );
  const [loading, setLoading] = useState(false);
  const [selectedSessionId, setSelectedSessionId] =
    useSelectedSessionId(locationHash);
  const selectedAgentName =
    page.sessions.find((session) => session.sessionId === selectedSessionId)
      ?.agentName ?? "main";
  const [createError, setCreateError] = useState<string | undefined>();
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [pageError, setPageError] = useState<string | undefined>();
  const createHintId = useId();
  const createFormRef = useRef<HTMLFormElement | null>(null);
  // Opening the form answers "send with nowhere to send". Bring it into view: it
  // renders below the composer, and on a short window it lands under the fold,
  // where it reads as the button having done nothing.
  useEffect(() => {
    if (!createOpen) return;
    createFormRef.current?.scrollIntoView({ block: "center" });
  }, [createOpen]);
  useEffect(() => {
    if (!loadSessions || sessionPage) return;
    let cancelled = false;
    setLoading(true);
    void loadSessions()
      .then((nextPage) => {
        if (!cancelled) {
          setPage(nextPage);
          setPageError(undefined);
        }
      })
      .catch((reason: unknown) => {
        // Without this the rail renders "No sessions yet." for a list that never
        // loaded, which reads as "you have no sessions" rather than as a failure.
        if (!cancelled)
          setPageError(
            reason instanceof Error ? reason.message : String(reason),
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadSessions, sessionPage]);
  const loadMore =
    loadSessions && page.hasMore
      ? () => {
          setLoading(true);
          void loadSessions(page.nextCursor)
            .then((nextPage) => {
              setPage((current) => ({
                sessions: [...current.sessions, ...nextPage.sessions],
                hasMore: nextPage.hasMore,
                nextCursor: nextPage.nextCursor,
              }));
            })
            .finally(() => setLoading(false));
        }
      : undefined;
  const submitCreate = createSession
    ? async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setCreating(true);
        setCreateError(undefined);
        try {
          const result = await createSession({
            name: String(form.get("name") ?? "").trim(),
            workspaceDir: String(form.get("workspaceDir") ?? "").trim(),
          });
          const id = createdSessionId(result);
          if (!id)
            throw new Error(
              "createSession response did not include a session id",
            );
          setSelectedSessionId(id);
          setCreateOpen(false);
          // The rail lists the shared history as it was at page load, so a session
          // created here would not show up until a reload.
          if (loadSessions)
            void loadSessions()
              .then((nextPage) => {
                setPage(nextPage);
                setPageError(undefined);
              })
              .catch((reason: unknown) =>
                setPageError(
                  reason instanceof Error ? reason.message : String(reason),
                ),
              );
          if (typeof window !== "undefined")
            window.location.hash = sessionHash(id);
        } catch (error) {
          setCreateError(
            error instanceof Error ? error.message : String(error),
          );
        } finally {
          setCreating(false);
        }
      }
    : undefined;

  const homeMode = !selectedSessionId;

  return (
    <div data-webui-shell="two-column" className="w-full h-screen relative">
      <div className="relative flex h-screen overflow-hidden bg-bg_grouped_secondary">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-[50] h-[46px]" />

        <div className="contents">
          {/* -------------------------------------------------------------- rail */}
          <div className="relative h-full min-h-0 flex-shrink-0">
            <aside
              aria-label="Primary navigation"
              data-webui-shell-region="rail"
              data-webui-rail-width="240"
              className="webui-rail relative z-50 flex h-full w-[240px] select-none flex-col overflow-hidden bg-bg_default_scrim"
            >
              {/* The desktop's window-control strip; the rail controls ride in it. */}
              <div className="flex w-full flex-shrink-0 flex-col pb-3">
                <div className="relative flex h-[38px] w-full items-center">
                  <div className="ml-auto flex items-center gap-1 pr-2">
                    <button
                      type="button"
                      data-webui-sidebar-toggle="true"
                      data-webui-placeholder-chrome="sidebar-toggle"
                      aria-disabled="true"
                      aria-label="切换导航栏"
                      tabIndex={-1}
                      className="flex size-8 cursor-default items-center justify-center rounded-[8px] text-text_default_tertiary"
                    >
                      <WebuiIconSidebarToggle />
                    </button>
                    <div
                      role="button"
                      data-webui-search="true"
                      data-webui-placeholder-chrome="search"
                      aria-disabled="true"
                      aria-label="搜索"
                      tabIndex={-1}
                      className="flex size-[30px] cursor-default select-none items-center justify-center rounded-lg text-text_default_tertiary"
                    >
                      <WebuiIconSearch />
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="flex-shrink-0 px-2 pb-px"
                data-webui-rail-fixed-row="true"
              >
                <RailRow
                  label="新建任务"
                  icon={<WebuiIconNewTask className="flex-shrink-0" />}
                  active={homeMode}
                  onSelect={() => setCreateOpen((open) => !open)}
                />
              </div>

              <div className="relative min-h-0 flex-1">
                <div className="h-full overflow-x-hidden overflow-y-auto px-2">
                  <div className="space-y-px pb-2">
                    <RailRow label="插件" icon={<WebuiIconPlugins />} inert />
                    <RailRow label="定时" icon={<WebuiIconSchedule />} inert />
                    <RailRow label="网站" icon={<WebuiIconSites />} inert />
                    <RailRow label="远程" icon={<WebuiIconRemote />} inert />
                  </div>

                  <div
                    className="conversation-source-segmented sticky top-0 z-20 flex justify-start bg-bg_default_scrim pb-2 pt-3"
                    data-webui-conversation-source="true"
                    data-webui-placeholder-chrome="source-segmented"
                  >
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 flex h-1 items-center"
                      aria-hidden="true"
                    >
                      <div className="h-px w-full bg-border_light" />
                    </div>
                    <div className="inline-flex">
                      <div
                        className="webui-segmented"
                        data-webui-segmented-static="true"
                      >
                        <span
                          aria-current="true"
                          className="webui-segmented-item bg-bg_default_primary"
                          data-webui-segmented-active="true"
                        >
                          本地
                        </span>
                        <span className="webui-segmented-item">云端</span>
                      </div>
                    </div>
                  </div>

                  <WebuiSessionList
                    page={page}
                    loading={loading}
                    onLoadMore={loadMore}
                    selectedSessionId={selectedSessionId}
                    error={pageError}
                  />
                </div>
                <div
                  className="webui-scroll-fade pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6"
                  aria-hidden="true"
                  data-webui-scroll-fade="true"
                />
              </div>

              {/* The desktop puts the signed-in account here; the WebUI reports the
                  scope it actually runs in instead. */}
              <div className="relative flex-shrink-0 border-t-[0.5px] border-border_default">
                <div
                  className="m-1 flex h-12 w-[calc(100%-8px)] items-center overflow-hidden rounded-[10px] px-2"
                  data-webui-rail-identity="true"
                >
                  <div className="flex size-7 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-border_light">
                    <WebuiIconBrand className="h-full w-full" />
                  </div>
                  <div className="ml-2 flex min-w-0 max-w-[135px] flex-1 flex-col gap-[2px]">
                    <span className="max-w-[135px] truncate text-[14px] font-[400] leading-[20px] text-text_default_primary">
                      MiniMax Code
                    </span>
                    <span className="max-w-[135px] truncate text-[12px] font-[400] leading-[16px] text-text_default_tertiary">
                      {hostLabel ? `本地 · ${hostLabel}` : "本地"}
                    </span>
                  </div>
                  <span
                    aria-hidden="true"
                    data-webui-placeholder-chrome="identity-bell"
                    className="ml-auto flex size-8 flex-shrink-0 items-center justify-center rounded-[8px] text-icon_default_primary opacity-40"
                  >
                    <WebuiIconBell />
                  </span>
                </div>
              </div>
            </aside>
          </div>

          <div
            className="group absolute top-0 bottom-0 z-[60] cursor-col-resize"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize navigation"
          >
            <div className="webui-rail-grip absolute left-1/2 top-1/2 h-12 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text_default_tertiary opacity-0 transition-opacity duration-150 group-hover:opacity-50" />
          </div>

          {/* -------------------------------------------------------------- main */}
          <main
            data-webui-shell-region="surface"
            className="relative flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <div className="relative flex h-full min-w-0 flex-1 flex-col">
              <div
                className="pointer-events-none absolute inset-x-0 top-6 z-[60] flex justify-center"
                data-webui-busy-banner-slot="true"
              />
              <div
                className={
                  homeMode
                    ? "flex h-full w-full flex-col items-center relative overflow-y-auto pt-[240px] pb-spacing_40"
                    : "flex h-full w-full flex-col items-center relative overflow-y-auto pt-spacing_24 pb-spacing_40"
                }
                data-webui-home-content={homeMode ? "true" : "false"}
              >
                <div
                  className={`flex w-full ${homeMode ? "max-w-[743px]" : "max-w-[768px]"} flex-col items-center gap-2 px-4`}
                >
                  {homeMode ? (
                    <div className="flex flex-col items-center gap-2 text-center">
                      <div className="group/avatar relative size-16 flex-shrink-0">
                        <div className="webui-hero-avatar relative h-full w-full overflow-visible rounded-full bg-bg_grouped_tertiary">
                          <span className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-full">
                            <WebuiIconBrand className="h-full w-full" />
                          </span>
                        </div>
                      </div>
                      <h1 className="text-[28px] font-medium leading-tight text-text_default_primary">
                        MiniMax Code，让工作更简单。
                      </h1>
                    </div>
                  ) : (
                    <div className="flex w-full items-center gap-2">
                      <span className="text-text_default_secondary text-size_12 leading-line_height_16">
                        {label}
                      </span>
                    </div>
                  )}

                  <WebuiComposer
                    sessionId={selectedSessionId}
                    agentName={selectedAgentName}
                    sendMessage={sendMessage}
                    enqueueMessage={enqueueMessage}
                    resumeSession={resumeSession}
                    loadMessages={loadMessages}
                    watchEvents={watchEvents}
                    listPendingPermissions={listPendingPermissions}
                    getPendingQuestionnaire={getPendingQuestionnaire}
                    replyPermission={replyPermission}
                    replyQuestionnaire={replyQuestionnaire}
                    dismissQuestionnaire={dismissQuestionnaire}
                    abortSession={abortSession}
                    listQueueMessages={listQueueMessages}
                    deleteQueueItem={deleteQueueItem}
                    listModels={listModels}
                    selectModel={selectModel}
                    getSessionUsage={getSessionUsage}
                    getAccountStatus={getAccountStatus}
                    draft={draft}
                    onDraftChange={setDraft}
                    onNeedsSession={() => setCreateOpen(true)}
                  />

                  {createOpen && submitCreate ? (
                    <form
                      ref={createFormRef}
                      aria-label="Create session"
                      onSubmit={submitCreate}
                      className="webui-card mt-spacing_16 flex w-full flex-col gap-spacing_8 p-spacing_16"
                      data-webui-create-form="true"
                    >
                      <label className="flex flex-col gap-spacing_4 text-text_default_primary text-size_14 leading-line_height_20 font-weight_medium">
                        Agent name
                        <input
                          name="name"
                          defaultValue="main"
                          required
                          className="webui-input"
                          data-webui-create-name="true"
                        />
                      </label>
                      <label className="flex flex-col gap-spacing_4 text-text_default_primary text-size_14 leading-line_height_20 font-weight_medium">
                        Working directory
                        <input
                          name="workspaceDir"
                          required
                          aria-describedby={createHintId}
                          className="webui-input"
                          data-webui-create-workspace="true"
                        />
                      </label>
                      <p
                        id={createHintId}
                        className="text-text_default_secondary text-size_12 leading-line_height_16"
                      >
                        A session's working directory is chosen at creation and
                        cannot be changed afterwards.
                      </p>
                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={creating}
                          className="webui-button-primary text-size_14"
                          data-webui-create-submit="true"
                        >
                          {creating ? "Creating…" : "Create session"}
                        </button>
                      </div>
                      {createError ? (
                        <p
                          role="alert"
                          className="text-text_default_secondary text-size_12 leading-line_height_16"
                        >
                          Unable to create session: {createError}
                        </p>
                      ) : null}
                    </form>
                  ) : null}

                  {homeMode ? <WebuiRecommendationChips /> : null}

                  {selectedSessionId && loadMessages ? (
                    <WebuiSessionTranscript
                      sessionId={selectedSessionId}
                      loadMessages={loadMessages}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default WebuiClientFoundationApp;
