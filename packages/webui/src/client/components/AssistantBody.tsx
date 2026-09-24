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
    if (part.type === "text" && !processExpanded) continue;
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
  processForceExpanded,
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
  readonly processForceExpanded?: boolean;
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
  const processTextParts = segments.flatMap((segment) =>
    (segment.activityParts ?? []).filter(
      (part): part is Extract<WebuiTranscriptActivityPart, { type: "text" }> => part.type === "text",
    ),
  );
  const primaryAnswerPart = processTextParts[processTextParts.length - 1];
  // Desktop builds one activity disclosure for each run of activity between
  // assistant replies. Historical messages can split that run across several
  // messageIds, so flatten the per-message projection before grouping; text
  // parts remain in sequence and still end the current activity group.
  const orderedProcessParts: WebuiTranscriptActivityPart[] = segments.flatMap((segment) => {
    if (segment.activityParts?.length) return [...segment.activityParts];
    return [
      ...(segment.thinking?.trim()
        ? [{ type: "thinking", text: segment.thinking, ...(segment.thinkingDurationMs !== undefined ? { durationMs: segment.thinkingDurationMs } : {}) } satisfies WebuiTranscriptActivityPart]
        : []),
      ...(segment.tools ?? []).map((tool) => ({ type: "tool", tool }) satisfies WebuiTranscriptActivityPart),
    ];
  });
  const hasExpandableProcessContent = Boolean(
    thinking?.trim() ||
    tools?.length ||
    processSegments?.some((segment) => segment.activityParts?.length),
  );
  const hasProcessDuration =
    typeof processingStartedAtMs === "number" ||
    typeof totalRequestDurationMs === "number" ||
    typeof wallClockDurationMs === "number";
  const renderProcessContent = (processExpanded: boolean) => (
    <div className="activity-group-content webui-turn-process-segments">
      {processExpanded ? renderActivityParts(
        messageId,
        orderedProcessParts,
        streaming,
        Boolean(getTurnDiff),
        true,
        processingStartedAtMs,
      ) : null}
    </div>
  );
  return (
    <div
      className="webui-assistant-body text-sm space-y-4"
      data-webui-assistant-body={messageId}
    >
      {hasExpandableProcessContent || hasProcessDuration ? (
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
          hasExpandableContent={hasExpandableProcessContent}
          forceExpanded={processForceExpanded}
          initiallyExpanded={processInitiallyExpanded}
          children={renderProcessContent}
          collapsedContent={(expanded) => !expanded && primaryAnswerPart
            ? <div className="mt-2 webui-assistant-answer" data-webui-message-kind="assistant"><WebuiMarkdown source={primaryAnswerPart.text} /></div>
            : null}
        />
      ) : null}
      {primaryAnswerPart && !hasExpandableProcessContent ? (
        <div className="webui-assistant-answer" data-webui-message-kind="assistant">
          <WebuiMarkdown source={primaryAnswerPart.text} />
        </div>
      ) : processTextParts.length > 0 ? null : answers.map((answer, index) => (
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
