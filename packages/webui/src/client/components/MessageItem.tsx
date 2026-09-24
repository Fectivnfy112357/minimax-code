// MessageItem — the single message renderer shared by persisted history and
// the live turn.
//
// W3 tier 2 lift: this component was moved verbatim out of `app.tsx`. The
// body is byte-identical to what used to live there; the lift is move-only.
// `app.tsx` keeps a thin re-export block so existing consumers
// (`webui-shell.test.ts`, importers via `app.tsx`) keep their current
// import path during the W3 wave.
//
// The shell still decides which source owns the turn (history after done,
// composer while active), but the DOM for either role is produced here.

import { useState, type ReactElement } from "react";
import type {
  WebuiGetSessionForkOptionsResult,
  WebuiGetSessionRewindPreviewResult,
  WebuiTurnDiffView,
} from "../../server/port.js";
import type {
  WebuiTranscriptProcessSegment,
  WebuiTransport,
} from "../contracts.js";
import type { WebuiTurnView } from "../projection/transcript-shape.js";

/** Capability subset the message item consumes. Single source of truth
 *  lives in `WebuiTransport`; this alias keeps the prop block free of
 *  per-key `WebuiTransport["x"]` redeclarations. */
type WebuiMessageItemCapabilities = Pick<
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
import { MessageAttachments, type MessageAttachment } from "./MessageAttachments.js";
import { WebuiAssistantBody } from "./AssistantBody.js";
import { WebuiIconCommandGoal } from "../icons.js";
import {
  WebuiMessageActions,
  WebuiRewindDialog,
  type WebuiMessageActionCapabilities,
} from "./MessageActions.js";
import {
  buildWebuiEditRequest,
  buildWebuiMessageForkRequest,
  buildWebuiRewindRequest,
  webuiClientRequestId,
} from "../projection/action-requests.js";

/**
 * The single message renderer shared by persisted history and the live turn.
 * The shell still decides which source owns the turn (history after done,
 * composer while active), but the DOM for either role is produced here.
 */
export function MessageItem({
  messageId,
  role,
  sessionId,
  assistantMessageId,
  turnId,
  changeSetId,
  initialDiff,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  actions,
  timestamp,
  isGoal = false,
  getSessionForkOptions,
  forkSession,
  getSessionRewindPreview,
  rewindSession,
  editSessionMessage,
  onMutationComplete,
  totalRequestDurationMs,
  totalOutputTokens,
  wallClockDurationMs,
  userText,
  thinking,
  thinkingDurationMs,
  processingStartedAtMs,
  tools,
  answers,
  attachments,
  streaming = false,
  streamMessageId,
  messageRootId,
  processSegments,
  view,
}: {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;

  readonly actions?: WebuiMessageActionCapabilities;
  readonly timestamp?: number;
  readonly isGoal?: boolean;

  readonly onMutationComplete?: () => void;
  readonly userText?: string;
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers?: readonly string[];
  readonly attachments?: readonly MessageAttachment[];
  readonly streaming?: boolean;
  readonly streamMessageId?: string;
  readonly messageRootId?: string;
  readonly processSegments?: readonly WebuiTranscriptProcessSegment[];
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  readonly wallClockDurationMs?: number;
  /**
   * Shared leaf-renderer input. When provided, the data fields
   * (`userText`, `thinking`, `answers`, etc.) come from `view` and the
   * legacy per-field props become fallback defaults — the caller picks
   * which path it wants. The historical and live adapters in
   * `projection/transcript-shape.ts` both produce a `WebuiTurnView`.
   *
   * `messageId` / `role` stay on the prop block: they are the React key
   * and the bubble-alignment switch, not data.
   */
  readonly view?: WebuiTurnView;
} & WebuiMessageItemCapabilities): ReactElement {
  // View-resolved data fields. Legacy props remain as fallback so the
  // existing `webui-round3-acceptance.test.tsx` suite (which mounts
  // MessageItem with individual props) keeps working unchanged.
  const effectiveSessionId = view?.sessionId ?? sessionId;
  const effectiveAssistantMessageId =
    view?.assistantMessageId ?? assistantMessageId;
  const effectiveTurnId = view?.turnId ?? turnId;
  const effectiveChangeSetId = view?.changeSetId ?? changeSetId;
  const effectiveInitialDiff = view?.initialDiff ?? initialDiff;
  const effectiveActions = view?.actions ?? actions;
  const effectiveTimestamp = view?.timestamp ?? timestamp;
  const effectiveIsGoal = view?.isGoal ?? isGoal;
  const effectiveUserText = view?.userText ?? userText;
  const effectiveThinking = view?.thinking ?? thinking;
  const effectiveThinkingDurationMs =
    view?.thinkingDurationMs ?? thinkingDurationMs;
  const effectiveProcessingStartedAtMs =
    view?.processingStartedAtMs ?? processingStartedAtMs;
  const effectiveTools = view?.tools ?? tools;
  const effectiveAnswers = view?.answers ?? answers;
  const effectiveAttachments = view?.attachments ?? attachments;
  const effectiveStreaming = view?.streaming ?? streaming;
  const effectiveStreamMessageId = view?.streamMessageId ?? streamMessageId;
  const effectiveMessageRootId = view?.messageRootId ?? messageRootId;
  const effectiveProcessSegments = view?.processSegments ?? processSegments;
  const effectiveTotalRequestDurationMs =
    view?.totalRequestDurationMs ?? totalRequestDurationMs;
  const effectiveTotalOutputTokens =
    view?.totalOutputTokens ?? totalOutputTokens;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(userText ?? "");
  const [rewindOpen, setRewindOpen] = useState(false);
  const [rewindPreview, setRewindPreview] = useState<WebuiGetSessionRewindPreviewResult>();
  const [rewindLoading, setRewindLoading] = useState(false);
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState<string>();
  const [forkTitle, setForkTitle] = useState("");
  const [forkOpen, setForkOpen] = useState(false);
  const [forkOptions, setForkOptions] = useState<WebuiGetSessionForkOptionsResult>();
  const openRewind = () => {
    setRewindOpen(true);
    setRewindPreview(undefined);
    setMutationError(undefined);
    if (!effectiveSessionId || !getSessionRewindPreview) return;
    setRewindLoading(true);
    void getSessionRewindPreview({ id: effectiveSessionId, userMessageId: messageId })
      .then(setRewindPreview)
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRewindLoading(false));
  };
  const confirmRewind = (rewindTurnDiff: boolean) => {
    if (!effectiveSessionId || !rewindSession) return;
    setMutationBusy(true);
    void rewindSession(buildWebuiRewindRequest(effectiveSessionId, messageId, webuiClientRequestId("rewind"), rewindTurnDiff))
      .then(() => { setRewindOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const submitEdit = () => {
    if (!effectiveSessionId || !editSessionMessage) return;
    const request = buildWebuiEditRequest(effectiveSessionId, messageId, webuiClientRequestId("edit"), editText);
    if (!request) return;
    setMutationBusy(true);
    void editSessionMessage(request)
      .then(() => { setEditing(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const confirmFork = () => {
    if (!effectiveSessionId || !forkSession || forkOptions?.canFork === false) return;
    setMutationBusy(true);
    void forkSession(buildWebuiMessageForkRequest(effectiveSessionId, messageId, webuiClientRequestId("fork"), forkTitle))
      .then(() => { setForkOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const openFork = () => {
    setForkOpen(true);
    setForkOptions(undefined);
    if (!effectiveSessionId || !getSessionForkOptions) return;
    void getSessionForkOptions({ id: effectiveSessionId, assistantMessageId: effectiveAssistantMessageId ?? messageId })
      .then((nextOptions) => {
        setForkOptions(nextOptions);
        if (nextOptions.suggestedTitle) setForkTitle(nextOptions.suggestedTitle);
      })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)));
  };
  const actionProps = {
    role,
    messageId,
    copyText: role === "user" ? effectiveUserText ?? "" : effectiveAnswers?.join("\n\n") ?? "",
    actions: effectiveActions,
    onRewind: role === "user" ? openRewind : undefined,
    onEdit: role === "user" ? () => { setEditText(effectiveUserText ?? ""); setEditing(true); } : undefined,
    onFork: role === "assistant" ? openFork : undefined,
    timestamp: effectiveTimestamp,
  };
  if (role === "user") {
    return (
      <div
        className="webui-message message-animate-in group relative"
        data-webui-stream-message={effectiveStreamMessageId}
        data-webui-message-root={effectiveMessageRootId ?? messageId}
        data-webui-message-role="user"
        data-testid="message-item"
        data-role="user"
        data-message-id={messageId}
        data-webui-goal-message={effectiveIsGoal ? "true" : undefined}
        data-message-timestamp={effectiveTimestamp}
      >
        <div className="flex w-full justify-end">
          <div className="flex w-full flex-col items-end gap-spacing_8">
            {editing ? (
              <div className="webui-user-inline-editor" data-testid="user-message-inline-editor">
                <textarea aria-label="编辑" value={editText} onChange={(event) => setEditText(event.target.value)} autoFocus />
                <div className="webui-inline-editor-actions"><button type="button" onClick={() => setEditing(false)} disabled={mutationBusy}>取消</button><button type="button" onClick={submitEdit} disabled={mutationBusy || !editText.trim()}>发送</button></div>
              </div>
            ) : <div
              className="webui-user-bubble bg-bg_grouped_tertiary rounded-[16px] px-3 py-2 max-w-[80%]"
              data-webui-user-bubble="true"
            >
              <div className="webui-user-text-clamp">
                <p
                  className="webui-user-text"
                  data-webui-message-kind="user"
                  data-webui-user-text="true"
                >
                  {effectiveIsGoal ? (
                    <span className="webui-user-goal-label" data-webui-goal-label="true">
                      <WebuiIconCommandGoal aria-hidden="true" />
                      <span>Goal</span>
                    </span>
                  ) : null}
                  <span>{effectiveUserText ?? ""}</span>
                </p>
              </div>
            </div>}
            {!editing ? <WebuiMessageActions {...actionProps} /> : null}
            {rewindOpen ? <WebuiRewindDialog messageId={messageId} preview={rewindPreview} loading={rewindLoading} error={mutationError} busy={mutationBusy} onClose={() => setRewindOpen(false)} onConfirm={confirmRewind} /> : null}
          </div>
        </div>
      </div>
    );
  }
  return (
    <div
      className="webui-message message-animate-in group relative"
      data-webui-stream-message={effectiveStreamMessageId}
      data-webui-message-root={effectiveMessageRootId ?? messageId}
      data-webui-message-role="assistant"
      data-testid="message-item"
      data-role="assistant"
      data-message-id={messageId}
    >
      <WebuiAssistantBody
        messageId={messageId}
        sessionId={effectiveSessionId}
        assistantMessageId={effectiveAssistantMessageId}
        turnId={effectiveTurnId}
        changeSetId={effectiveChangeSetId}
        initialDiff={effectiveInitialDiff}
        getTurnDiff={getTurnDiff}
        revertTurnDiff={revertTurnDiff}
        reapplyTurnDiff={reapplyTurnDiff}
        thinking={effectiveThinking}
        thinkingDurationMs={effectiveThinkingDurationMs}
        tools={effectiveTools}
        answers={effectiveAnswers ?? []}
        attachments={effectiveAttachments}
        streaming={effectiveStreaming}
        processingStartedAtMs={effectiveProcessingStartedAtMs}
        totalRequestDurationMs={effectiveTotalRequestDurationMs}
        totalOutputTokens={effectiveTotalOutputTokens}
        wallClockDurationMs={wallClockDurationMs}
        processSegments={effectiveProcessSegments}
      />
      <WebuiMessageActions {...actionProps} />
      {forkOpen ? <div className="webui-message-dialog" role="dialog" aria-modal="true" data-testid="fork-dialog"><div className="webui-message-dialog-surface"><h3>复制为新会话</h3><p>{forkOptions?.unavailableReason ?? "保留当前上下文，在新会话中继续"}</p><input aria-label="会话名称" value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="使用简短且不同的名称，便于识别" disabled={forkOptions?.canFork === false} /><div className="webui-message-dialog-actions"><button type="button" onClick={() => setForkOpen(false)} disabled={mutationBusy}>取消</button><button type="button" onClick={confirmFork} disabled={mutationBusy || forkOptions?.canFork === false}>复制并进入</button></div></div></div> : null}
      {mutationError && !rewindOpen && !forkOpen ? <p role="alert" className="webui-message-mutation-error">{mutationError}</p> : null}
    </div>
  );
}
