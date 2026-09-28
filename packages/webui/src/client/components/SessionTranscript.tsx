// SessionTranscript — the per-session message log: groups, projectWebuiMessage
// flattening, history paging, streaming loader, and the embedded
// WebuiQuestionnaireResponse renderer for historical questionnaire answers.
//
// W3 tier 4 lift: this cluster (2 components) was moved verbatim out of
// `app.tsx`. The bodies are byte-identical to what used to live there;
// the lift is move-only. `app.tsx` keeps a thin re-export block so
// existing consumers (`webui-shell.test.ts`, importers via `app.tsx`)
// keep their current import path during the W3 wave.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { ChatSkeleton } from "./TranscriptSkeletons.js";
import { ActivityIndicator, MessageAfterQueryStreamingPlaceholder, MessagePassiveLoadingPlaceholder } from "./ActivityIndicator.js";
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
import type { WebuiMessageFileReference } from "../projection/message-file-reference.js";
import type { WorkspacePanelCommand } from "../projection/workspace-panel-state.js";
import {
  groupWebuiTranscriptItems,
  projectWebuiTranscriptMessages,
  projectWebuiQueryDurations,
  projectWebuiProcessSegments,
} from "../projection/transcript-projection.js";
import { projectWebuiMessage } from "../projection/message-projection.js";
import {
  projectHistoricalTurnView,
  projectLiveTurnView,
  type WebuiTurnView,
} from "../projection/transcript-shape.js";

const EMPTY_TRANSCRIPT_PAGE: WebuiClientMessagePage = {};

function mergeQueryCollapseViews(
  current: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
  older: NonNullable<WebuiClientMessagePage["queryCollapseViews"]>,
) {
  const byQueryKey = new Map(current.map((view) => [view.queryKey, view]));
  for (const view of older) byQueryKey.set(view.queryKey, view);
  return [...byQueryKey.values()];
}

export interface WebuiOwnedTranscriptState {
  readonly ownerSessionId: string;
  readonly generation: number;
  readonly page: WebuiClientMessagePage;
  readonly loading: boolean;
  readonly error?: string;
}

export interface WebuiTranscriptRequestToken {
  readonly ownerSessionId: string;
  readonly generation: number;
  readonly requestId: number;
}

export function createWebuiTranscriptRequestCoordinator(initialOwner: string) {
  let owner = { ownerSessionId: initialOwner, generation: 0 };
  let latestRequestId = 0;

  return {
    commitOwner(ownerSessionId: string): void {
      if (owner.ownerSessionId === ownerSessionId) return;
      owner = { ownerSessionId, generation: owner.generation + 1 };
      latestRequestId = 0;
    },
    getCommittedOwner() {
      return owner;
    },
    beginRequest(ownerSessionId: string): WebuiTranscriptRequestToken | undefined {
      if (owner.ownerSessionId !== ownerSessionId) return undefined;
      latestRequestId += 1;
      return { ...owner, requestId: latestRequestId };
    },
    isCurrent(token: WebuiTranscriptRequestToken): boolean {
      return owner.ownerSessionId === token.ownerSessionId &&
        owner.generation === token.generation &&
        latestRequestId === token.requestId;
    },
  };
}

export async function runWebuiTranscriptPageRequest<TPage>(
  coordinator: ReturnType<typeof createWebuiTranscriptRequestCoordinator>,
  token: WebuiTranscriptRequestToken,
  load: () => Promise<TPage>,
  stateCommit: (update: (state: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState) => void,
  onSuccess: (
    page: TPage,
    commit: (update: (state: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState) => boolean,
  ) => void,
  onError: (
    reason: unknown,
    commit: (update: (state: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState) => boolean,
  ) => void,
  onFinally: (
    commit: (update: (state: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState) => boolean,
  ) => void,
): Promise<void> {
  const commit = (
    update: (state: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState,
  ): boolean => {
    if (!coordinator.isCurrent(token)) return false;
    stateCommit((state) => updateOwnedTranscriptState(
      state,
      token.ownerSessionId,
      token.generation,
      update,
    ));
    return true;
  };
  try {
    const page = await load();
    if (coordinator.isCurrent(token)) onSuccess(page, commit);
  } catch (reason) {
    if (coordinator.isCurrent(token)) onError(reason, commit);
  } finally {
    if (coordinator.isCurrent(token)) onFinally(commit);
  }
}

export function getOwnedTranscriptPage(
  state: WebuiOwnedTranscriptState,
  sessionId: string,
): WebuiClientMessagePage | undefined {
  return state.ownerSessionId === sessionId ? state.page : undefined;
}

export function updateOwnedTranscriptState(
  current: WebuiOwnedTranscriptState,
  ownerSessionId: string,
  generation: number,
  update: (current: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState,
): WebuiOwnedTranscriptState {
  return current.ownerSessionId === ownerSessionId && current.generation === generation
    ? update(current)
    : current;
}

export function mergeOlderTranscriptPage(
  current: WebuiOwnedTranscriptState,
  olderPage: WebuiClientMessagePage,
  requestedCursor: string,
): { readonly state: WebuiOwnedTranscriptState; readonly error?: string } {
  if (
    (olderPage.messages?.length ?? 0) === 0 ||
    (olderPage.hasMore && olderPage.nextCursor === requestedCursor)
  ) {
    return {
      state: {
        ...current,
        page: { ...current.page, hasMore: false, nextCursor: undefined },
      },
      error: "没有找到更早的消息，请刷新会话后重试。",
    };
  }

  return {
    state: {
      ...current,
      page: {
        messages: [
          ...(olderPage.messages ?? []),
          ...(current.page.messages ?? []),
        ],
        queryCollapseViews: mergeQueryCollapseViews(
          current.page.queryCollapseViews ?? [],
          olderPage.queryCollapseViews ?? [],
        ),
        nextCursor: olderPage.nextCursor,
        hasMore: olderPage.hasMore,
      },
    },
  };
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
  workspaceDir,
  onOpenFile,
  onOpenTurnReview,
}: {
  readonly sessionId: string;
  readonly loadMessages: WebuiClientMessageLoader;
  readonly initialMessages?: WebuiClientMessagePage;
  readonly workspaceDir?: string;
  readonly onOpenFile?: (input: { readonly sessionId: string; readonly workspaceDir: string; readonly reference: WebuiMessageFileReference }) => void;
  readonly onOpenTurnReview?: (command: Extract<WorkspacePanelCommand, { type: "open-turn-review" }>) => void;
} & WebuiSessionTranscriptCapabilities): ReactElement {
  const coordinatorRef = useRef(createWebuiTranscriptRequestCoordinator(sessionId));
  const coordinator = coordinatorRef.current;
  useLayoutEffect(() => {
    coordinator.commitOwner(sessionId);
  }, [coordinator, sessionId]);
  const committedOwner = coordinator.getCommittedOwner();
  const [transcriptState, setTranscriptState] = useState<WebuiOwnedTranscriptState>(
    () => ({
      ownerSessionId: sessionId,
      generation: 0,
      page: initialMessages ?? {},
      loading: initialMessages === undefined,
    }),
  );
  const commitTranscriptRequest = (
    token: WebuiTranscriptRequestToken,
    update: (current: WebuiOwnedTranscriptState) => WebuiOwnedTranscriptState,
  ) => {
    setTranscriptState((current) => coordinator.isCurrent(token)
      ? updateOwnedTranscriptState(current, token.ownerSessionId, token.generation, update)
      : current);
  };
  const visibleState = transcriptState.ownerSessionId === sessionId &&
      transcriptState.generation === committedOwner.generation
    ? transcriptState
    : undefined;
  const visiblePage = visibleState
    ? getOwnedTranscriptPage(visibleState, sessionId) ?? EMPTY_TRANSCRIPT_PAGE
    : EMPTY_TRANSCRIPT_PAGE;
  const loading = visibleState?.loading ?? true;
  const error = visibleState?.error;
  const transcriptRef = useRef<HTMLElement | null>(null);
  const { stream } = useSessionRuntimeState(sessionId).state;
  const streamPhase = stream.phase;
  const autoFollowRef = useRef(true);
  const manualScrollIntentRef = useRef(false);
  // History and stream frames feed one transcript projection. The live
  // records update the same message identities in this list while history
  // supplies the persisted fields and older messages.
  const turnLive = isTurnLive(streamPhase);
  const previousTurnLiveRef = useRef(turnLive);
  useEffect(() => {
    const token = coordinator.beginRequest(sessionId);
    if (!token) return;
    setTranscriptState((current) => {
      if (!coordinator.isCurrent(token)) return current;
      if (current.ownerSessionId !== token.ownerSessionId || current.generation !== token.generation) {
        return {
          ownerSessionId: token.ownerSessionId,
          generation: token.generation,
          page: initialMessages ?? EMPTY_TRANSCRIPT_PAGE,
          loading: initialMessages === undefined,
        };
      }
      return {
        ...current,
        loading: initialMessages === undefined ? true : current.loading,
        error: undefined,
      };
    });
    void runWebuiTranscriptPageRequest(
      coordinator,
      token,
      () => loadMessages({ id: sessionId }),
      (update) => commitTranscriptRequest(token, update),
      (nextPage, commit) => {
        commit((owned) => ({
          ...owned,
          page: nextPage,
        }));
      },
      (reason, commit) => {
        commit((owned) => ({
          ...owned,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      },
      (commit) => {
        commit((owned) => ({
          ...owned,
          loading: false,
        }));
      },
    );
  }, [coordinator, loadMessages, sessionId]);
  useEffect(() => {
    const wasLive = previousTurnLiveRef.current;
    previousTurnLiveRef.current = turnLive;
    if (!wasLive || turnLive) return undefined;
    const token = coordinator.beginRequest(sessionId);
    if (!token) return undefined;
    void runWebuiTranscriptPageRequest(
      coordinator,
      token,
      () => loadMessages({ id: sessionId }),
      (update) => commitTranscriptRequest(token, update),
      (nextPage, commit) => {
        commit((owned) => ({
          ...owned,
          page: nextPage,
        }));
      },
      (reason, commit) => {
        commit((owned) => ({
          ...owned,
          error: reason instanceof Error ? reason.message : String(reason),
        }));
      },
      () => undefined,
    );
    return undefined;
  }, [coordinator, loadMessages, sessionId, turnLive]);
  const messages = useMemo(
    () => projectWebuiTranscriptMessages(visiblePage, stream.messages, streamPhase !== "done"),
    [visiblePage, stream.messages, streamPhase],
  );
  const items = useMemo(
    () => messages.flatMap(projectWebuiMessage),
    [messages],
  );
  // 每条消息使用统一视图；历史适配器提供持久化字段，实时适配器提供流式标记。
  // MessageItem 只通过 view 属性读取这些值。
  const turnViewsByMessageId = useMemo(
    () =>
      new Map<string, WebuiTurnView>(
        messages.map((message) => [
          message.msgId,
          projectHistoricalTurnView(message, sessionId),
        ]),
      ),
    [messages, sessionId],
  );
  // Group by message so one turn renders as one block, the way the desktop
  // does: a process disclosure carrying the thinking and the tool steps, then
  // the assistant's markdown. A user turn is its own block.
  const queryDurationByMessageId = useMemo(
    () => projectWebuiQueryDurations(
      visiblePage.messages ?? [],
      visiblePage.queryCollapseViews ?? [],
    ),
    [visiblePage.messages, visiblePage.queryCollapseViews],
  );
  const groups = useMemo(
    () => groupWebuiTranscriptItems(items, queryDurationByMessageId),
    [items, queryDurationByMessageId],
  );
  const liveMessageIds = useMemo(
    () => new Set(stream.messages.map((message) => message.id)),
    [stream.messages],
  );
  const liveAssistantMessages = useMemo(
    () => stream.messages.filter((message) => message.role !== "user"),
    [stream.messages],
  );
  const liveAssistantView = useMemo(
    () => projectLiveTurnView(stream.messages, {
      sessionId,
      streaming: streamPhase === "streaming",
      processingStartedAtMs: stream.processingStartedAtMs,
    }),
    [sessionId, stream.messages, stream.processingStartedAtMs, streamPhase],
  );
  useLayoutEffect(() => {
    if (!turnLive) return undefined;
    const transcript = transcriptRef.current;
    const viewport = transcript?.closest<HTMLElement>(
      '[data-webui-session-scroll="true"]',
    );
    if (!transcript || !viewport) return undefined;
    if (!previousTurnLiveRef.current) {
      autoFollowRef.current = true;
      manualScrollIntentRef.current = false;
    }
    const followBottom = () => {
      if (autoFollowRef.current)
        viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
    };
    const onScroll = () => {
      const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
      if (distance <= 150) {
        autoFollowRef.current = true;
        manualScrollIntentRef.current = false;
      } else if (manualScrollIntentRef.current) {
        autoFollowRef.current = false;
      }
    };
    const onWheel = () => { manualScrollIntentRef.current = true; };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    viewport.addEventListener("wheel", onWheel, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(followBottom);
    observer?.observe(transcript);
    followBottom();
    return () => {
      observer?.disconnect();
      viewport.removeEventListener("scroll", onScroll);
      viewport.removeEventListener("wheel", onWheel);
    };
  }, [sessionId, turnLive]);
  useLayoutEffect(() => {
    if (!turnLive) return;
    const viewport = transcriptRef.current?.closest<HTMLElement>(
      '[data-webui-session-scroll="true"]',
    );
    if (viewport && autoFollowRef.current)
      viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  }, [items, turnLive]);
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
  const loadOlder = visibleState?.page.hasMore && visibleState.page.nextCursor
    ? () => {
        if (loading) return;
        const requestedCursor = visibleState.page.nextCursor;
        if (!requestedCursor) return;
        const token = coordinator.beginRequest(sessionId);
        if (!token) return;
        const viewport = transcriptRef.current?.closest<HTMLElement>(
          '[data-webui-session-scroll="true"]',
        );
        const previousScrollTop = viewport?.scrollTop;
        commitTranscriptRequest(token, (owned) => ({
          ...owned,
          loading: true,
          error: undefined,
        }));
        void runWebuiTranscriptPageRequest(
          coordinator,
          token,
          () => loadMessages({ id: token.ownerSessionId, before: requestedCursor }),
          (update) => commitTranscriptRequest(token, update),
          (olderPage, commit) => {
            const applied = commit((owned) => {
              const result = mergeOlderTranscriptPage(owned, olderPage, requestedCursor);
              return { ...result.state, error: result.error };
            });
            if (!applied) return;
            requestAnimationFrame(() => {
              if (
                coordinator.isCurrent(token) &&
                viewport?.isConnected &&
                previousScrollTop !== undefined
              ) viewport.scrollTop = previousScrollTop;
            });
          },
          (reason, commit) => {
            commit((owned) => ({
              ...owned,
              error: reason instanceof Error ? reason.message : String(reason),
            }));
          },
          (commit) => {
            commit((owned) => ({
              ...owned,
              loading: false,
            }));
          },
        );
      }
    : undefined;
  return (
    <section
      ref={transcriptRef}
      aria-label="Transcript"
      data-webui-transcript={sessionId}
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
                workspaceDir={workspaceDir}
                onOpenFile={onOpenFile}
                onOpenTurnReview={onOpenTurnReview}
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
          const liveAssistantGroup = turnLive && group.items.some(
            (item) => liveMessageIds.has(item.messageId),
          );
          const assistantView = liveAssistantGroup && liveAssistantView
            ? {
                ...liveAssistantView,
                messageId: group.messageId,
                ...(group.turnId ? { turnId: group.turnId } : {}),
              }
            : {
                ...(historicalAssistantView ?? {
                  source: "historical" as const,
                  messageId: group.messageId,
                  role: "assistant" as const,
                  sessionId,
                }),
                source: "historical" as const,
                messageId: group.messageId,
                role: "assistant" as const,
                sessionId,
                ...(group.turnId ? { turnId: group.turnId } : {}),
                ...(group.forceExpanded ? { processForceExpanded: true } : {}),
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
              };
          return (
            <MessageItem
              key={group.messageId}
              view={assistantView}
              wallClockDurationMs={group.wallClockDurationMs}
              getTurnDiff={getTurnDiff}
              revertTurnDiff={revertTurnDiff}
              reapplyTurnDiff={reapplyTurnDiff}
              getSessionForkOptions={getSessionForkOptions}
              forkSession={forkSession}
              getSessionRewindPreview={getSessionRewindPreview}
              rewindSession={rewindSession}
              editSessionMessage={editSessionMessage}
              workspaceDir={workspaceDir}
              onOpenFile={onOpenFile}
              onOpenTurnReview={onOpenTurnReview}
            />
          );
        })}
        {streamPhase === "reconnecting" ? (
          <MessagePassiveLoadingPlaceholder label="重连中…" />
        ) : null}
        {turnLive && !liveAssistantMessages.length &&
        (streamPhase === "streaming" || streamPhase === "waiting") ? (
          stream.messages.some((message) => message.role === "user") && streamPhase === "waiting" ? (
            <>
              <MessageAfterQueryStreamingPlaceholder />
              <div className="webui-session-stream-status" data-webui-live-thinking="true">
                <ActivityIndicator showLabel labelOverride="思考中…" />
              </div>
            </>
          ) : (
            <div className="webui-session-stream-status" data-webui-live-thinking="true">
              <ActivityIndicator showLabel labelOverride="思考中…" />
            </div>
          )
        ) : null}
        {turnLive && liveAssistantView &&
        (streamPhase === "streaming" || streamPhase === "waiting") &&
        !liveAssistantView.thinking?.trim() ? (
          <div className="webui-session-stream-status" data-webui-live-thinking="true">
            <ActivityIndicator showLabel labelOverride="思考中…" />
          </div>
        ) : null}
      </div>
      <TurnNavigator turns={turns} />
    </section>
  );
}
