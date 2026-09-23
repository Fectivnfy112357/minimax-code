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
import type { WebuiTransport } from "../contracts.js";
import { MessageAttachments, type MessageAttachment } from "./MessageAttachments.js";
import { WebuiAssistantBody } from "./AssistantBody.js";
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
}: {
  readonly messageId: string;
  readonly role: "user" | "assistant";
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly actions?: WebuiMessageActionCapabilities;
  readonly timestamp?: number;
  readonly isGoal?: boolean;
  readonly getSessionForkOptions?: WebuiTransport["getSessionForkOptions"];
  readonly forkSession?: WebuiTransport["forkSession"];
  readonly getSessionRewindPreview?: WebuiTransport["getSessionRewindPreview"];
  readonly rewindSession?: WebuiTransport["rewindSession"];
  readonly editSessionMessage?: WebuiTransport["editSessionMessage"];
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
  readonly totalRequestDurationMs?: number;
  readonly totalOutputTokens?: number;
  readonly wallClockDurationMs?: number;
}): ReactElement {
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
    if (!sessionId || !getSessionRewindPreview) return;
    setRewindLoading(true);
    void getSessionRewindPreview({ id: sessionId, userMessageId: messageId })
      .then(setRewindPreview)
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setRewindLoading(false));
  };
  const confirmRewind = (rewindTurnDiff: boolean) => {
    if (!sessionId || !rewindSession) return;
    setMutationBusy(true);
    void rewindSession(buildWebuiRewindRequest(sessionId, messageId, webuiClientRequestId("rewind"), rewindTurnDiff))
      .then(() => { setRewindOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const submitEdit = () => {
    if (!sessionId || !editSessionMessage) return;
    const request = buildWebuiEditRequest(sessionId, messageId, webuiClientRequestId("edit"), editText);
    if (!request) return;
    setMutationBusy(true);
    void editSessionMessage(request)
      .then(() => { setEditing(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const confirmFork = () => {
    if (!sessionId || !forkSession || forkOptions?.canFork === false) return;
    setMutationBusy(true);
    void forkSession(buildWebuiMessageForkRequest(sessionId, messageId, webuiClientRequestId("fork"), forkTitle))
      .then(() => { setForkOpen(false); onMutationComplete?.(); })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)))
      .finally(() => setMutationBusy(false));
  };
  const openFork = () => {
    setForkOpen(true);
    setForkOptions(undefined);
    if (!sessionId || !getSessionForkOptions) return;
    void getSessionForkOptions({ id: sessionId, assistantMessageId: messageId })
      .then((nextOptions) => {
        setForkOptions(nextOptions);
        if (nextOptions.suggestedTitle) setForkTitle(nextOptions.suggestedTitle);
      })
      .catch((error: unknown) => setMutationError(error instanceof Error ? error.message : String(error)));
  };
  const actionProps = {
    role,
    messageId,
    copyText: role === "user" ? userText ?? "" : answers?.join("\n\n") ?? "",
    actions,
    onRewind: role === "user" ? openRewind : undefined,
    onEdit: role === "user" ? () => { setEditText(userText ?? ""); setEditing(true); } : undefined,
    onFork: role === "assistant" ? openFork : undefined,
    timestamp,
  };
  if (role === "user") {
    return (
      <div
        className="webui-message message-animate-in group relative"
        data-webui-stream-message={streamMessageId}
        data-webui-message-root={messageRootId ?? messageId}
        data-webui-message-role="user"
        data-testid="message-item"
        data-role="user"
        data-message-id={messageId}
        data-webui-goal-message={isGoal ? "true" : undefined}
        data-message-timestamp={timestamp}
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
                  <span>{userText ?? ""}</span>
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
      data-webui-stream-message={streamMessageId}
      data-webui-message-root={messageRootId ?? messageId}
      data-webui-message-role="assistant"
      data-testid="message-item"
      data-role="assistant"
      data-message-id={messageId}
    >
      <WebuiAssistantBody
        messageId={messageId}
        sessionId={sessionId}
        assistantMessageId={assistantMessageId}
        turnId={turnId}
        changeSetId={changeSetId}
        initialDiff={initialDiff}
        getTurnDiff={getTurnDiff}
        revertTurnDiff={revertTurnDiff}
        reapplyTurnDiff={reapplyTurnDiff}
        thinking={thinking}
        thinkingDurationMs={thinkingDurationMs}
        tools={tools}
        answers={answers ?? []}
        attachments={attachments}
        streaming={streaming}
        processingStartedAtMs={processingStartedAtMs}
        totalRequestDurationMs={totalRequestDurationMs}
        totalOutputTokens={totalOutputTokens}
        wallClockDurationMs={wallClockDurationMs}
      />
      <WebuiMessageActions {...actionProps} />
      {forkOpen ? <div className="webui-message-dialog" role="dialog" aria-modal="true" data-testid="fork-dialog"><div className="webui-message-dialog-surface"><h3>复制为新会话</h3><p>{forkOptions?.unavailableReason ?? "保留当前上下文，在新会话中继续"}</p><input aria-label="会话名称" value={forkTitle} onChange={(event) => setForkTitle(event.target.value)} placeholder="使用简短且不同的名称，便于识别" disabled={forkOptions?.canFork === false} /><div className="webui-message-dialog-actions"><button type="button" onClick={() => setForkOpen(false)} disabled={mutationBusy}>取消</button><button type="button" onClick={confirmFork} disabled={mutationBusy || forkOptions?.canFork === false}>复制并进入</button></div></div></div> : null}
      {mutationError && !rewindOpen && !forkOpen ? <p role="alert" className="webui-message-mutation-error">{mutationError}</p> : null}
    </div>
  );
}