// WebuiAssistantBody — the assistant message body, deferred from W3 tier 1
// because it directly renders <WebuiDiffCard>.
//
// W3 tier 2 lift: this component was moved verbatim out of `app.tsx`. The
// body is byte-identical to what used to live there; the lift is move-only.
// `app.tsx` keeps a thin re-export block so existing consumers (the shell
// and tests) keep their current import path during the W3 wave.

import { useState, type ReactElement } from "react";
import { WebuiMarkdown } from "../markdown.js";
import { MessageAttachments, type MessageAttachment } from "./MessageAttachments.js";
import type { WebuiTurnDiffView } from "../../server/port.js";
import type {
  WebuiTranscriptProcessSegment,
  WebuiTranscriptActivityPart,
  WebuiTransport,
} from "../contracts.js";

/** Capability subset the assistant body passes through to its diff card.
 *  Single source of truth lives in `WebuiTransport`; this alias keeps the
 *  prop block free of per-key `WebuiTransport["x"]` redeclarations. */
type WebuiAssistantBodyCapabilities = Pick<
  WebuiTransport,
  "getTurnDiff" | "revertTurnDiff" | "reapplyTurnDiff"
>;
import { WebuiDiffCard } from "./DiffCard.js";
import {
  WebuiActivityGroup,
  type WebuiActivityGroupItem,
  WebuiThinkingBlock,
  WebuiTurnProcess,
} from "./TranscriptPrimitives.js";

function renderActivityParts(
  messageId: string,
  parts: readonly WebuiTranscriptActivityPart[],
  streaming: boolean,
  authoritativeDiffAvailable: boolean,
  processExpanded: boolean,
  processingStartedAtMs?: number,
): ReactElement[] {
  const rows: ReactElement[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (!part) continue;
    if (!processExpanded && part.type !== "text") continue;
    if (part.type === "tool" || part.type === "thinking") {
      const activityItems: WebuiActivityGroupItem[] = [];
      let cursor = index;
      while (cursor < parts.length) {
        const next = parts[cursor];
        if (next?.type === "thinking") {
          const thoughtTexts = [next.text];
          let durationMs = next.durationMs;
          cursor += 1;
          while (parts[cursor]?.type === "thinking") {
            const thought = parts[cursor];
            if (thought?.type === "thinking") {
              thoughtTexts.push(thought.text);
              durationMs ??= thought.durationMs;
            }
            cursor += 1;
          }
          activityItems.push({ type: "thinking", text: thoughtTexts.join("\n\n"), ...(durationMs !== undefined ? { durationMs } : {}), ...(streaming ? { streaming: true } : {}) });
          continue;
        }
        if (next?.type === "tool") {
          activityItems.push({ type: "tool", tool: next.tool });
          cursor += 1;
          continue;
        }
        break;
      }
      const tools = activityItems.flatMap((item) => item.type === "tool" ? [item.tool] : []);
      const thoughts = activityItems.filter((item): item is Extract<WebuiActivityGroupItem, { type: "thinking" }> => item.type === "thinking");
      if (tools.length > 0 && thoughts.length > 0) {
        rows.push(<WebuiActivityGroup key={`${messageId}-activity-${index}`} tools={tools} activityItems={activityItems} authoritativeDiffAvailable={authoritativeDiffAvailable} />);
      } else if (tools.length > 0) {
        rows.push(<WebuiActivityGroup key={`${messageId}-tools-${index}`} tools={tools} authoritativeDiffAvailable={authoritativeDiffAvailable} />);
      } else {
        thoughts.forEach((thought, thoughtIndex) => rows.push(<WebuiThinkingBlock key={`${messageId}-thinking-${index}-${thoughtIndex}`} text={thought.text} streaming={streaming} processingStartedAtMs={processingStartedAtMs} summaryLabel={streaming ? "推理中..." : "思考 1 次"} />));
      }
      index = cursor - 1;
    } else if (part.type === "text") {
      rows.push(<div className="webui-assistant-answer" key={`${messageId}-ordered-text-${index}`} data-webui-message-kind="assistant"><WebuiMarkdown source={part.text} /></div>);
    } else if (part.type === "cognitive" || part.type === "compaction") {
      rows.push(<WebuiThinkingBlock key={`${messageId}-${part.type}-${index}`} text={part.text} streaming={streaming} processingStartedAtMs={processingStartedAtMs} summaryLabel={part.type === "compaction" ? "上下文整理" : "思考过程"} />);
    } else if (part.type === "delegation") {
      rows.push(<div className="webui-agent-delegation" key={`${messageId}-delegation-${index}`} data-webui-agent-activity="delegation" data-active={streaming && index === parts.length - 1 ? "true" : undefined}><span className="webui-agent-delegation-summary"><span className="webui-agent-delegation-avatar" aria-hidden="true">{String(part.message.fromAgent ?? "Agent").slice(0, 1).toUpperCase()}</span><span className="webui-agent-activity-title">{`${String(part.message.fromAgent ?? "Agent")} 发给 ${String(part.message.toAgent ?? "Agent")}`}</span></span>{typeof part.message.content === "string" ? <WebuiMarkdown source={part.message.content} /> : null}</div>);
    } else {
      const agents: Record<string, unknown>[] = [];
      while (parts[index]?.type === "agent_joined") {
        const joined = parts[index];
        if (joined?.type === "agent_joined") agents.push(joined.agent);
        index += 1;
      }
      index -= 1;
      rows.push(<WebuiAgentJoinedGroup key={`${messageId}-joined-${index}`} agents={agents} />);
    }
  }
  return rows;
}

function WebuiAgentJoinedGroup({
  agents,
}: {
  readonly agents: readonly Record<string, unknown>[];
}): ReactElement | null {
  const [expanded, setExpanded] = useState(true);
  if (agents.length === 0) return null;
  return (
    <section className="webui-agent-joined-group" data-webui-agent-activity="agent-joined-group">
      <button
        type="button"
        className="webui-agent-joined-toggle"
        aria-expanded={expanded}
        aria-label="分配任务"
        onClick={() => setExpanded((value) => !value)}
      >
        <span>分配任务</span>
        <span className={`webui-agent-joined-chevron${expanded ? "" : " is-collapsed"}`} aria-hidden="true">⌄</span>
      </button>
      {expanded ? (
        <div className="webui-agent-joined-list" data-testid="agent-task-list">
          {agents.map((agent, index) => {
            const name = String(agent.agentName ?? agent.name ?? "Agent");
            const title = String(agent.title ?? name);
            return (
              <div
                className="webui-agent-joined-row"
                key={String(agent.sessionId ?? `${name}-${index}`)}
                data-testid="agent-task-row"
                data-webui-agent-task-session={typeof agent.sessionId === "string" ? agent.sessionId : undefined}
              >
                <span className="webui-agent-joined-avatar" aria-hidden="true">{name.slice(0, 1).toUpperCase()}</span>
                <span className="webui-agent-joined-name">@{name}</span>
                <span className="webui-agent-joined-title">{title}</span>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

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
  processInitiallyExpanded,
}: {
  readonly messageId: string;
  readonly sessionId?: string;
  readonly assistantMessageId?: string;
  readonly turnId?: string;
  readonly changeSetId?: string;
  readonly initialDiff?: WebuiTurnDiffView;

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
  readonly processInitiallyExpanded?: boolean;
} & WebuiAssistantBodyCapabilities): ReactElement {
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
      {thinking || tools?.length || processSegments?.some((segment) => segment.activityParts?.length) ? (
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
          initiallyExpanded={processInitiallyExpanded}
        >
          {(processExpanded) => <div className="activity-group-content webui-turn-process-segments">
            {segments.map((segment) => {
              const toolCount = segment.tools?.length ?? 0;
              const summaryLabel = segment.thinking
                ? `思考 1 次${toolCount > 0 ? `, 使用 ${toolCount} 个工具` : ""}`
                : undefined;
              const rows = segment.activityParts?.length
                ? renderActivityParts(segment.messageId, segment.activityParts, streaming, Boolean(getTurnDiff), processExpanded, processingStartedAtMs)
                : null;
              return (
                <div className="webui-turn-process-segment" key={segment.messageId}>
                  {rows ?? (segment.thinking && processExpanded ? (
                    <WebuiThinkingBlock
                      text={segment.thinking}
                      durationMs={segment.thinkingDurationMs}
                      streaming={streaming}
                      processingStartedAtMs={processingStartedAtMs}
                      summaryLabel={summaryLabel}
                    />
                  ) : null)}
                  {!rows && processExpanded && segment.tools?.length ? (
                    <WebuiActivityGroup
                      tools={segment.tools}
                      authoritativeDiffAvailable={Boolean(getTurnDiff)}
                    />
                  ) : null}
                </div>
              );
            })}
          </div>}
        </WebuiTurnProcess>
      ) : null}
      {processSegments?.some((segment) => segment.activityParts?.some((part) => part.type === "text")) ? null : answers.map((answer, index) => (
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
