// WebuiGoalBanner — the thread-level goal banner (status, edit, clear).
//
// W3 tier 3 lift: this component was moved verbatim out of `app.tsx`. The
// body is byte-identical to what used to live there; the lift is move-only.
// `app.tsx` keeps a thin re-export block so existing consumers
// (`webui-round3-acceptance.test.tsx`, importers via `app.tsx`) keep
// their current import path during the W3 wave.

import { useEffect, useState, type ReactElement } from "react";
import {
  buildWebuiGoalEditPatch,
  formatWebuiGoalDuration,
  WEBUI_GOAL_STATUS_COPY,
  WEBUI_GOAL_WAIT_COPY,
} from "../projection/goal-state.js";
import type { WebuiGoal, WebuiGoalStatus } from "../../server/port.js";
import type { WebuiTransport } from "../contracts.js";

export function WebuiGoalBanner({
  goal,
  patchGoal,
  clearGoal,
  onReplace,
  isGenerating = false,
  interactionBlocked = false,
}: {
  readonly goal?: WebuiGoal;
  readonly patchGoal?: WebuiTransport["patchGoal"];
  readonly clearGoal?: WebuiTransport["clearGoal"];
  readonly onReplace?: () => void;
  readonly isGenerating?: boolean;
  readonly interactionBlocked?: boolean;
}): ReactElement | null {
  const [editing, setEditing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [objective, setObjective] = useState(goal?.objective ?? "");
  const [budget, setBudget] = useState(goal?.tokenBudget ? String(goal.tokenBudget) : "");
  const [updated, setUpdated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  useEffect(() => {
    setObjective(goal?.objective ?? "");
    setBudget(goal?.tokenBudget ? String(goal.tokenBudget) : "");
    if (!goal) setEditing(false);
  }, [goal?.goalId, goal?.objective, goal?.tokenBudget]);
  useEffect(() => {
    if (!goal || goal.status !== "active" || goal.executionWait) {
      setElapsedSeconds(0);
      return undefined;
    }
    const update = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - goal.updatedAt) / 1000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [goal]);
  if (!goal) return null;
  const status = updated ? "updated" : goal.status;
  const submitPatch = (patch: { status?: WebuiGoalStatus; objective?: string; tokenBudget?: number | null }) => {
    if (!patchGoal) return;
    setBusy(true);
    setError(undefined);
    void patchGoal({ sessionId: goal.sessionId, ...patch })
      .then(() => { setUpdated(true); setEditing(false); window.setTimeout(() => setUpdated(false), 2_400); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  const saveEdit = () => {
    const result = buildWebuiGoalEditPatch(objective, budget);
    if (!result.ok) { setError(result.error); return; }
    submitPatch(result.patch);
  };
  const clear = () => {
    if (!clearGoal) return;
    setBusy(true);
    void clearGoal({ sessionId: goal.sessionId })
      .then(() => setConfirmClear(false))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="webui-goal-banner" data-testid="thread-goal-banner" data-goal-status={status} role="status" aria-live="polite">
      <div className="webui-goal-banner-content-row" data-testid="thread-goal-banner-content-row">
        <div className="webui-goal-banner-objective-group" data-testid="thread-goal-banner-objective-group">
          <span aria-hidden="true">🎯</span>
          <button type="button" className="webui-goal-objective" data-testid="thread-goal-banner-objective" aria-expanded={false} title={goal.objective}>{goal.objective}</button>
          <span className="webui-goal-status" data-testid="thread-goal-banner-status">{WEBUI_GOAL_STATUS_COPY[status]}</span>
        </div>
        <div className="webui-goal-banner-actions-slot" data-testid="thread-goal-banner-actions-slot">
          {goal.status === "blocked" ? <button type="button" data-testid="thread-goal-banner-resume" onClick={() => submitPatch({ status: "active" })} disabled={busy || interactionBlocked}>继续</button> : null}
          {goal.status === "paused" || goal.status === "usage_limited" ? <button type="button" data-testid="thread-goal-banner-resume" onClick={() => submitPatch({ status: "active" })} disabled={busy || interactionBlocked}>继续</button> : null}
          {goal.status === "active" && !goal.executionWait ? <button type="button" data-testid="thread-goal-banner-pause" onClick={() => submitPatch({ status: "paused" })} disabled={busy || interactionBlocked}>暂停</button> : null}
          <button type="button" data-testid="thread-goal-banner-edit-button" onClick={() => setEditing((value) => !value)} disabled={busy || interactionBlocked || (goal.status === "complete")}>编辑</button>
          {onReplace ? <button type="button" data-testid="thread-goal-banner-replace-button" onClick={onReplace} disabled={busy || interactionBlocked}>替换目标</button> : null}
          {goal.status !== "complete" ? <button type="button" data-testid="thread-goal-banner-clear" onClick={() => setConfirmClear(true)} disabled={busy || interactionBlocked}>清除目标</button> : <button type="button" data-testid="thread-goal-banner-close" onClick={() => setConfirmClear(true)} disabled={busy}>关闭</button>}
        </div>
      </div>
      {goal.executionWait ? <div className="webui-goal-wait" data-testid="thread-goal-wait">{WEBUI_GOAL_WAIT_COPY[goal.executionWait.reason] ?? WEBUI_GOAL_WAIT_COPY.unknown}</div> : null}
      <div className="webui-goal-usage" data-testid="thread-goal-usage"><span data-testid="thread-goal-tokens-used">{goal.tokensUsed} tokens</span><span data-testid="thread-goal-turns-used">{goal.turnsUsed} 轮</span><span data-testid="thread-goal-timer">{formatWebuiGoalDuration(goal.timeUsedSeconds + elapsedSeconds)}</span></div>
      {goal.status === "budget_limited" ? <p data-testid="thread-goal-banner-budget-guide">创建新目标后继续</p> : null}
      {goal.status === "usage_limited" ? <p data-testid="thread-goal-usage-guide">服务商额度恢复后可继续</p> : null}
      {goal.status === "complete" ? <span data-testid="thread-goal-completion-marker" className="webui-goal-completion-marker">目标已完成</span> : null}
      {editing ? <div className="webui-goal-editor" data-testid="goal-editor"><textarea data-testid="thread-goal-banner-edit-input" value={objective} onChange={(event) => setObjective(event.target.value)} placeholder="更新目标内容" /><input data-testid="thread-goal-banner-budget-input" value={budget} onChange={(event) => setBudget(event.target.value)} placeholder="Token 预算 — 例如 50K、200000；留空表示取消" /><div><button type="button" data-testid="thread-goal-banner-cancel-edit" onClick={() => setEditing(false)} disabled={busy}>取消</button><button type="button" data-testid="thread-goal-banner-save" onClick={saveEdit} disabled={busy}>保存</button></div></div> : null}
      {confirmClear ? <div className="webui-goal-confirm" data-testid="goal-clear-confirm"><strong>删除目标？</strong><p>删除目标后，目标模式会关闭，转为普通模式继续。</p><button type="button" onClick={() => setConfirmClear(false)} disabled={busy}>取消</button><button type="button" data-testid="goal-clear-confirm-confirm" onClick={clear} disabled={busy}>删除</button></div> : null}
      {error ? <p role="alert" data-testid="thread-goal-error">{error}</p> : null}
      {isGenerating ? <span data-testid="thread-goal-generating" aria-hidden="true" /> : null}
    </section>
  );
}