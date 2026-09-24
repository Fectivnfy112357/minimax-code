// SessionTranscript — the per-session message log: groups, projectWebuiMessage
// flattening, history paging, streaming loader, and the embedded
// WebuiQuestionnaireResponse renderer for historical questionnaire answers.
//
// W3 tier 4 lift: this cluster (2 components) was moved verbatim out of
// `app.tsx`. The bodies are byte-identical to what used to live there;
// the lift is move-only. `app.tsx` keeps a thin re-export block so
// existing consumers (`webui-shell.test.ts`, importers via `app.tsx`)
// keep their current import path during the W3 wave.

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ChatSkeleton } from "./TranscriptSkeletons.js";
import { MessageViewportStreamingLoader } from "./ActivityIndicator.js";
import { TurnNavigator, type TurnSummary } from "./TurnNavigator.js";
import { MessageItem } from "./MessageItem.js";
import { formatWebuiMessageTimestamp, type WebuiMessageActionCapabilities } from "./MessageActions.js";
import { useSessionRuntimeState } from "../session-runtime-store.js";
import { isTurnLive } from "../projection/composer-state.js";
import type {
  WebuiClientMessageLoader,
  WebuiClientMessagePage,
  WebuiTransport,
  WebuiTranscriptItem,
} from "../contracts.js";

/** Capability subset the transcript passes through to each message item.
 *  Single source of truth lives in `WebuiTransport`; this alias keeps the
 *  prop block free of per-key `WebuiTransport["x"]` redeclarations. */
type WebuiSessionTranscriptCapabilities = Pick<
  WebuiTransport,
  | "getTurnDiff"
  | "revertTurnDiff"
  | "reapplyTurnDiff"
  | "getSessionForkOptions"
  | "forkSession"
  | "getSessionRewindPreview"
  | "rewindSession"
  | "editSessionMessage"
>;
import type { WebuiTurnDiffView } from "../../server/port.js";
import type { WebuiQuestionnaireResponseSummary } from "../projection/message-parts.js";
import {
  groupWebuiTranscriptItems,
  projectWebuiQueryDurations,
  projectWebuiProcessSegments,
} from "../projection/transcript-projection.js";
import { projectWebuiMessage } from "../projection/message-projection.js";
import {
  projectHistoricalTurnView,
  type WebuiTurnView,
} from "../projection/transcript-shape.js";

function mergeQueryCollapseViews(
  current: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
  older: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
) {
  const byQueryKey = new Map(current.map((view) => [view.queryKey, view]));
  for (const view of older) byQueryKey.set(view.queryKey, view);
  return [...byQueryKey.values()];
}

/**
 * Historical questionnaire-response projection. Once the user submits a
 * questionnaire we render the question and the recorded answers inside the
 * conversation so a rewinded session still remembers what the user picked.
 */
export function WebuiQuestionnaireResponse({
  messageId,
  summary,
  timestamp,
}: {
  readonly messageId: string;
  readonly summary: WebuiQuestionnaireResponseSummary;
  readonly timestamp?: number;
}): ReactElement {
  const { requestId, answers } = summary;
  return (
    <article
      className="webui-questionnaire-history flex w-full max-w-[80%] flex-col gap-2 rounded-[16px] border border-border_default bg-bg_grouped_secondary_elevated p-3"
      data-webui-questionnaire-history="true"
      data-message-id={messageId}
      data-webui-questionnaire-request={requestId}
      data-testid={`questionnaire-history-${requestId}`}
    >
      <header className="flex flex-col gap-1">
        <span
          className="text-text_default_secondary text-size_12"
          data-testid="questionnaire-history-label"
        >
          问卷回答
        </span>
        <dl
          className="webui-questionnaire-history-meta flex flex-wrap gap-x-3 gap-y-1 text-text_default_tertiary text-size_12"
          data-testid="questionnaire-history-meta"
        >
          <div data-testid="questionnaire-history-meta-requestId">
            <dt className="inline">requestId: </dt>
            <dd className="inline font-mono">{requestId || "(未提供)"}</dd>
          </div>
          {summary.schemaVersion ? (
            <div data-testid="questionnaire-history-meta-schema">
              <dt className="inline">schemaVersion: </dt>
              <dd className="inline font-mono">{summary.schemaVersion}</dd>
            </div>
          ) : null}
          {summary.submittedAt ? (
            <div data-testid="questionnaire-history-meta-submitted">
              <dt className="inline">submittedAt: </dt>
              <dd className="inline font-mono">{summary.submittedAt}</dd>
            </div>
          ) : null}
          {summary.mode ? (
            <div data-testid="questionnaire-history-meta-mode">
              <dt className="inline">mode: </dt>
              <dd className="inline font-mono">{summary.mode}</dd>
            </div>
          ) : null}
          {summary.source ? (
            <div data-testid="questionnaire-history-meta-source">
              <dt className="inline">source: </dt>
              <dd className="inline font-mono">{summary.source}</dd>
            </div>
          ) : null}
          {summary.featureKey ? (
            <div data-testid="questionnaire-history-meta-feature-key">
              <dt className="inline">featureKey: </dt>
              <dd className="inline font-mono">{summary.featureKey}</dd>
            </div>
          ) : null}
        </dl>
      </header>
      <ul
        className="webui-questionnaire-history-answers flex flex-col gap-2"
        data-testid="questionnaire-history-answers"
      >
        {answers.map((answer, index) => (
          <li
            key={`${requestId}-${index}`}
            className="webui-questionnaire-history-answer flex flex-col gap-1 text-size_14"
            data-testid={`questionnaire-history-answer-${index}`}
          >
            <strong
              className="text-text_default_primary"
              data-testid={`questionnaire-history-answer-${index}-question`}
            >
              {answer.question}
            </strong>
            <ul className="flex flex-col gap-1 pl-4">
              {answer.labels.map((label, labelIndex) => (
                <li
                  key={`${requestId}-${index}-${labelIndex}`}
                  className="webui-questionnaire-history-label flex items-start gap-2 list-disc text-text_default_secondary"
                  data-testid={`questionnaire-history-answer-${index}-label-${labelIndex}`}
                >
                  <span>{label}</span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
      {typeof timestamp === "number" ? (
        <span
          className="text-text_default_tertiary text-size_12"
          data-testid="questionnaire-history-timestamp"
        >
          {formatWebuiMessageTimestamp(timestamp)}
        </span>
      ) : null}
    </article>
  );
}

export function WebuiSessionTranscript({
  sessionId,
  loadMessages,
  initialMessages,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
}: {
  readonly sessionId: string;
  readonly loadMessages: WebuiClientMessageLoader;
  readonly initialMessages?: WebuiClientMessagePage;
} & WebuiSessionTranscriptCapabilities): ReactElement {
  const [page, setPage] = useState<WebuiClientMessagePage>(
    () => initialMessages ?? {},
  );
  const [loading, setLoading] = useState(initialMessages === undefined);
  const [error, setError] = useState<string | undefined>();
  const transcriptRef = useRef<HTMLElement | null>(null);
  const { stream } = useSessionRuntimeState(sessionId).state;
  const streamPhase = stream.phase;
  // One live column per turn: while the turn runs the composer renders it
  // (including the in-flight user bubble), so skip loads; reload when the
  // turn lands so the transcript takes over with the full history.
  const turnLive = isTurnLive(streamPhase);
  useEffect(() => {
    if (turnLive) return undefined;
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
  }, [loadMessages, sessionId, streamPhase, turnLive]);
  // During a live turn the server snapshot may already contain this turn's
  // user line (first-load race) — hide it here so the composer's pending
  // bubble is the only renderer while the turn runs.
  const items = useMemo(
    () => (page.messages ?? []).flatMap(projectWebuiMessage),
    [page.messages],
  );
  // Per-message leaf-renderer input view. Both adapters in
  // `projection/transcript-shape.ts` produce this shape; the historical
  // adapter owns the persisted fields (`actions`, `initialDiff`,
  // `attachments`), the live adapter owns the in-flight markers
  // (`streaming`, `streamMessageId`, `messageRootId`). `MessageItem` reads
  // the view through its `view` prop and falls back to legacy per-field
  // props when the view is absent.
  const turnViewsByMessageId = useMemo(
    () =>
      new Map<string, WebuiTurnView>(
        (page.messages ?? []).map((message) => [
          message.msgId,
          projectHistoricalTurnView(message, sessionId),
        ]),
      ),
    [page.messages, sessionId],
  );
  // Group by message so one turn renders as one block, the way the desktop
  // does: a process disclosure carrying the thinking and the tool steps, then
  // the assistant's markdown. A user turn is its own block.
  const queryDurationByMessageId = useMemo(
    () => projectWebuiQueryDurations(page.messages ?? [], page.queryCollapseViews ?? []),
    [page.messages, page.queryCollapseViews],
  );
  const groups = useMemo(
    () => groupWebuiTranscriptItems(items, queryDurationByMessageId),
    [items, queryDurationByMessageId],
  );
  const showEmptyState = !turnLive && !error && !loading && items.length === 0;
  // The right-rail navigator's tick list mirrors the assistant turns visible
  // on the page. A user turn isn't a tick — only the assistant block that
  // follows it counts. The first assistant group is `active` while we have
  // nothing settled; the last is `running` while streaming is live.
  const turns = useMemo<readonly TurnSummary[]>(() => {
    const assistantGroups = groups.filter((group) =>
      group.items.some((item) => item.kind === "assistant"),
    );
    if (assistantGroups.length === 0) return [];
    const lastIndex = assistantGroups.length - 1;
    return assistantGroups.map((group, index) => ({
      id: group.messageId,
      state:
        index === lastIndex && streamPhase === "streaming"
          ? "running"
          : index === 0
            ? "active"
            : "default",
    }));
  }, [groups, streamPhase]);
  const loadOlder =
    page.hasMore && page.nextCursor
      ? () => {
          if (loading) return;
          const viewport = transcriptRef.current?.closest<HTMLElement>(
            '[data-webui-session-scroll="true"]',
          );
          const previousScrollTop = viewport?.scrollTop;
          setLoading(true);
          setError(undefined);
          void loadMessages({ id: sessionId, before: page.nextCursor })
            .then((olderPage) => {
              if (
                (olderPage.messages?.length ?? 0) === 0 ||
                (olderPage.hasMore && olderPage.nextCursor === page.nextCursor)
              ) {
                setError("没有找到更早的消息，请刷新会话后重试。");
                setPage((current) => ({
                  ...current,
                  hasMore: false,
                  nextCursor: undefined,
                }));
                return;
              }
              setPage((current) => ({
                messages: [
                  ...(olderPage.messages ?? []),
                  ...(current.messages ?? []),
                ],
                queryCollapseViews: mergeQueryCollapseViews(
                  current.queryCollapseViews ?? [],
                  olderPage.queryCollapseViews ?? [],
                ),
                nextCursor: olderPage.nextCursor,
                hasMore: olderPage.hasMore,
              }));
              requestAnimationFrame(() => {
                if (viewport?.isConnected && previousScrollTop !== undefined)
                  viewport.scrollTop = previousScrollTop;
              });
            })
            .catch((reason: unknown) => {
              setError(reason instanceof Error ? reason.message : String(reason));
            })
            .finally(() => setLoading(false));
        }
      : undefined;
  return (
    <section
      ref={transcriptRef}
      aria-label="Transcript"
      data-webui-transcript={sessionId}
      data-webui-transcript-empty-live={
        turnLive && groups.length === 0 ? "true" : undefined
      }
      data-webui-transcript-empty={showEmptyState ? "true" : undefined}
      className="message-container-viewport scrollbar-hide webui-session-transcript-scroll relative flex w-full flex-col"
      data-webui-session-transcript-scroll="true"
    >
      <div
        className="message-list flex w-full flex-col gap-spacing_8"
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
        {!turnLive && loading && items.length === 0 ? <ChatSkeleton /> : null}
        {showEmptyState ? (
          <p
            className="webui-transcript-empty-state text-text_default_secondary text-size_14 leading-line_height_20"
            data-testid="transcript-empty-state"
          >
            当前会话暂无消息
          </p>
        ) : null}
        {loadOlder ? (
          <div className="flex w-full justify-center py-1">
            <button
              type="button"
              onClick={loadOlder}
              disabled={loading}
              className="webui-button-secondary text-size_14 leading-line_height_20"
              aria-label={loading ? "正在加载更早消息" : "加载更早消息"}
            >
              <svg
                viewBox="0 0 16 16"
                aria-hidden="true"
                className="size-4 flex-none"
              >
                <path
                  d="m4 10 4-4 4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>{loading ? "正在加载…" : "加载更早消息"}</span>
            </button>
          </div>
        ) : null}
        {groups.flatMap((group) => {
          const userItem = group.items.find(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "user",
          );
          const questionnaireResponseItem = group.items.find(
            (
              item,
            ): item is Extract<
              WebuiTranscriptItem,
              { kind: "questionnaire_response" }
            > => item.kind === "questionnaire_response",
          );
          const result: ReactElement[] = [];
          if (questionnaireResponseItem) {
            result.push(
              <WebuiQuestionnaireResponse
                key={`${group.messageId}-questionnaire`}
                messageId={group.messageId}
                summary={questionnaireResponseItem.summary}
                timestamp={questionnaireResponseItem.timestamp}
              />,
            );
          }
          if (userItem) {
            const projectedUserView = turnViewsByMessageId.get(
              userItem.messageId,
            );
            const historicalUserView =
              projectedUserView?.source === "historical"
                ? projectedUserView
                : undefined;
            result.push(
              <MessageItem
                key={group.messageId}
                view={
                  {
                    ...(historicalUserView ?? {
                      source: "historical",
                      messageId: userItem.messageId,
                      role: "user",
                      sessionId,
                    }),
                    source: "historical",
                    messageId: userItem.messageId,
                    role: "user",
                    sessionId,
                    userText: userItem.text,
                    actions: userItem.actions,
                    timestamp: userItem.timestamp,
                    isGoal: userItem.isGoal,
                  }
                }
                getSessionForkOptions={getSessionForkOptions}
                forkSession={forkSession}
                getSessionRewindPreview={getSessionRewindPreview}
                rewindSession={rewindSession}
                editSessionMessage={editSessionMessage}
              />,
            );
          }
          if (result.length > 0) return result;
          // Fall through to the assistant-group renderer below.
          // `wallClockDurationMs` and `processSegments` are group-level
          // facts: the first is the group's span and the second preserves
          // per-message activity rows across the assistant group. The
          // historical per-message adapter leaves processSegments out;
          // this group projection supplies it before rendering.
          const thinkingItems = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "thinking",
          );
          const tools = group.items
            .filter(
              (
                item,
              ): item is Extract<WebuiTranscriptItem, { kind: "tool" }> =>
                item.kind === "tool",
            )
            .flatMap((item) => item.tools);
          const answers = group.items.filter(
            (item): item is Extract<WebuiTranscriptItem, { text: string }> =>
              item.kind === "assistant",
          );
          const actions = group.items.find(
            (
              item,
            ): item is Extract<
              WebuiTranscriptItem,
              { actions?: WebuiMessageActionCapabilities }
            > => "actions" in item,
          )?.actions;
          const initialDiff = [...group.items]
            .reverse()
            .find(
              (
                item,
              ): item is Extract<
                WebuiTranscriptItem,
                { diff?: WebuiTurnDiffView }
              > => "diff" in item,
            )?.diff;
          const projectedAssistantView = turnViewsByMessageId.get(
            group.messageId,
          );
          const historicalAssistantView =
            projectedAssistantView?.source === "historical"
              ? projectedAssistantView
              : undefined;
          return (
            <MessageItem
              key={group.messageId}
              view={
                {
                  ...(historicalAssistantView ?? {
                    source: "historical",
                    messageId: group.messageId,
                    role: "assistant",
                    sessionId,
                  }),
                  source: "historical",
                  messageId: group.messageId,
                  role: "assistant",
                  sessionId,
                  ...(group.turnId ? { turnId: group.turnId } : {}),
                  userText: undefined,
                  thinking: thinkingItems.length > 0
                    ? thinkingItems.map((item) => item.text).join("\n\n")
                    : undefined,
                  thinkingDurationMs: thinkingItems[0]?.durationMs,
                  tools: tools.length > 0 ? tools : undefined,
                  answers: answers.map((item) => item.text),
                  timestamp: undefined,
                  isGoal: undefined,
                  totalRequestDurationMs: group.totalRequestDurationMs,
                  totalOutputTokens: group.totalOutputTokens,
                  actions,
                  initialDiff,
                  attachments: answers[0]?.attachments,
                  processSegments: projectWebuiProcessSegments(group.items),
                }
              }
              wallClockDurationMs={group.wallClockDurationMs}
              getTurnDiff={getTurnDiff}
              revertTurnDiff={revertTurnDiff}
              reapplyTurnDiff={reapplyTurnDiff}
              getSessionForkOptions={getSessionForkOptions}
              forkSession={forkSession}
              getSessionRewindPreview={getSessionRewindPreview}
              rewindSession={rewindSession}
              editSessionMessage={editSessionMessage}
            />
          );
        })}
        {streamPhase === "streaming" ? (
          <MessageViewportStreamingLoader testId="webui-transcript-viewport-loader" />
        ) : null}
      </div>
      <TurnNavigator turns={turns} />
    </section>
  );
}
