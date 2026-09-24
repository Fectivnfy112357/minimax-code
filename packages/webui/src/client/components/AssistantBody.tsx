// WebuiAssistantBody — the assistant message body, deferred from W3 tier 1
// because it directly renders <WebuiDiffCard>.
//
// W3 tier 2 lift: this component was moved verbatim out of `app.tsx`. The
// body is byte-identical to what used to live there; the lift is move-only.
// `app.tsx` keeps a thin re-export block so existing consumers (the shell
// and tests) keep their current import path during the W3 wave.

import type { ReactElement } from "react";
import { WebuiMarkdown } from "../markdown.js";
import { MessageAttachments, type MessageAttachment } from "./MessageAttachments.js";
import type { WebuiTurnDiffView } from "../../server/port.js";
import type {
  WebuiTranscriptProcessSegment,
  WebuiTransport,
} from "../contracts.js";
import { WebuiDiffCard } from "./DiffCard.js";
import {
  WebuiActivityGroup,
  WebuiThinkingBlock,
  WebuiTurnProcess,
} from "./TranscriptPrimitives.js";

export function WebuiAssistantBody({
  messageId,
  sessionId,
  assistantMessageId,
  turnId,
  changeSetId,
  initialDiff,
  getTurnDiff,
  revertTurnDiff,
  reapplyTurnDiff,
  thinking,
  thinkingDurationMs,
  processingStartedAtMs,
  totalRequestDurationMs,
  totalOutputTokens,
  wallClockDurationMs,
  tools,
  answers,
  attachments,
  streaming = false,
  processSegments,
}: {
  readonly messageId: string;
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;
  readonly getTurnDiff?: WebuiTransport["getTurnDiff"];
  readonly revertTurnDiff?: WebuiTransport["revertTurnDiff"];
  readonly reapplyTurnDiff?: WebuiTransport["reapplyTurnDiff"];
  readonly thinking?: string;
  readonly thinkingDurationMs?: number;
  readonly processingStartedAtMs?: number;
  /** Sum of `usage.requestDurationMs` across the turn's assistant messages
   *  when the runtime reports it. Falls back to `wallClockDurationMs`. */
  readonly totalRequestDurationMs?: number;
  /** Sum of `usage.outputTokens` across the turn's assistant messages. */
  readonly totalOutputTokens?: number;
  /** Wall-clock duration computed from message timestamps inside the turn
   *  (oldest user → newest assistant). Used when the runtime doesn't emit
   *  a per-request duration. */
  readonly wallClockDurationMs?: number;
  readonly tools?: readonly Record<string, unknown>[];
  readonly answers: readonly string[];
  readonly attachments?: readonly MessageAttachment[];
  readonly streaming?: boolean;
  readonly processSegments?: readonly WebuiTranscriptProcessSegment[];
}): ReactElement {
  const segments = processSegments?.length
    ? processSegments
    : [
        {
          messageId,
          ...(thinking ? { thinking } : {}),
          ...(thinkingDurationMs !== undefined ? { thinkingDurationMs } : {}),
          ...(tools?.length ? { tools } : {}),
        } satisfies WebuiTranscriptProcessSegment,
      ];
  return (
    <div
      className="webui-assistant-body text-sm space-y-4"
      data-webui-assistant-body={messageId}
    >
      {thinking || tools?.length ? (
        <WebuiTurnProcess
          active={streaming}
          startedAtMs={processingStartedAtMs}
          {...(!streaming && totalRequestDurationMs !== undefined
            ? { endedAtMs: (processingStartedAtMs ?? 0) + totalRequestDurationMs }
            : {})}
          tokenCount={
            !streaming && typeof totalOutputTokens === "number"
              ? totalOutputTokens
              : answers.reduce((sum, answer) => sum + answer.length, 0)
          }
          requestDurationMs={totalRequestDurationMs}
          wallClockDurationMs={wallClockDurationMs}
        >
          <div className="activity-group-content webui-turn-process-segments">
            {segments.map((segment) => {
              const toolCount = segment.tools?.length ?? 0;
              const summaryLabel = segment.thinking
                ? `思考 1 次${toolCount > 0 ? `, 使用 ${toolCount} 个工具` : ""}`
                : undefined;
              return (
                <div className="webui-turn-process-segment" key={segment.messageId}>
                  {segment.thinking ? (
                    <WebuiThinkingBlock
                      text={segment.thinking}
                      durationMs={segment.thinkingDurationMs}
                      streaming={streaming}
                      processingStartedAtMs={processingStartedAtMs}
                      summaryLabel={summaryLabel}
                    />
                  ) : null}
                  {segment.tools?.length ? (
                    <WebuiActivityGroup
                      tools={segment.tools}
                      authoritativeDiffAvailable={Boolean(getTurnDiff)}
                      streaming={streaming}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>
        </WebuiTurnProcess>
      ) : null}
      {answers.map((answer, index) => (
        <div
          key={`${messageId}-answer-${index}`}
          className="webui-assistant-answer"
          data-webui-message-kind="assistant"
        >
          <WebuiMarkdown source={answer} />
        </div>
      ))}
      {/* Desktop places the diff card after the assistant body so the
       * edited-files summary sits at the end of the message. */}
      <WebuiDiffCard
        sessionId={sessionId}
        assistantMessageId={assistantMessageId ?? messageId}
        turnId={turnId}
        changeSetId={changeSetId}
        initialView={initialDiff}
        getTurnDiff={getTurnDiff}
        revertTurnDiff={revertTurnDiff}
        reapplyTurnDiff={reapplyTurnDiff}
      />
      {attachments?.length ? (
        <MessageAttachments attachments={attachments} />
      ) : null}
    </div>
  );
}
