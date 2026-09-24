// WebuiGoalBanner — the thread-level goal banner (status, edit, clear).
//
// W3 tier 3 lift: this component owns the session-scoped goal card. Its
// transport calls stay on the existing WebUI goal contract while the visual
// surface follows Desktop's compact status/actions layout.

import { useEffect, useState, type ReactElement } from "react";
import {
  buildWebuiGoalEditPatch,
  formatWebuiGoalDuration,
  WEBUI_GOAL_STATUS_COPY,
  WEBUI_GOAL_WAIT_COPY,
} from "../projection/goal-state.js";
import type { WebuiGoal, WebuiGoalStatus } from "../../server/port.js";
import type { WebuiTransport } from "../contracts.js";

/** Capability subset the goal banner consumes. Single source of truth lives
 *  in `WebuiTransport`; this alias keeps the prop block free of per-key
 *  `WebuiTransport["x"]` redeclarations. */
type WebuiGoalBannerCapabilities = Pick<WebuiTransport, "patchGoal" | "clearGoal">;
import {
  WebuiIconCommandGoal,
  WebuiIconContextRename,
  WebuiIconContextTrash,
} from "../icons.js";

function GoalPauseIcon(): ReactElement {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="M6 4.5v11M14 4.5v11" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>;
}

function GoalResumeIcon(): ReactElement {
  return <svg viewBox="0 0 20 20" width="18" height="18" fill="none" aria-hidden="true"><path d="m7 4.5 8 5.5-8 5.5v-11Z" fill="currentColor" /></svg>;
}

export function WebuiGoalBanner({
  goal,
  patchGoal,
  clearGoal,
  onCleared,
  isGenerating = false,
  interactionBlocked = false,
}: {
  readonly goal?: WebuiGoal;

  readonly onCleared?: () => void;
  readonly isGenerating?: boolean;
  readonly interactionBlocked?: boolean;
} & WebuiGoalBannerCapabilities): ReactElement | null {
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
      .then(() => {
        setConfirmClear(false);
        onCleared?.();
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return (
    <section className="webui-goal-banner" data-testid="thread-goal-banner" data-goal-status={status} role="status" aria-live="polite">
      <div className="webui-goal-banner-content-row" data-testid="thread-goal-banner-content-row">
        <div className="webui-goal-banner-objective-group" data-testid="thread-goal-banner-objective-group">
          <span className="webui-goal-banner-icon" aria-hidden="true"><WebuiIconCommandGoal /></span>
          <span className="webui-goal-status" data-testid="thread-goal-banner-status">{WEBUI_GOAL_STATUS_COPY[status]}</span>
          <button type="button" className="webui-goal-objective" data-testid="thread-goal-banner-objective" aria-expanded={editing} title={goal.objective} onClick={() => setEditing(true)}>{goal.objective}</button>
          <div className="webui-goal-usage" data-testid="thread-goal-usage"><span data-testid="thread-goal-tokens-used">{goal.tokensUsed} tokens</span><span data-testid="thread-goal-turns-used">{goal.turnsUsed} 轮</span><span data-testid="thread-goal-timer">{formatWebuiGoalDuration(goal.timeUsedSeconds + elapsedSeconds)}</span></div>
        </div>
        <div className="webui-goal-banner-actions-slot" data-testid="thread-goal-banner-actions-slot">
          {goal.status === "blocked" || goal.status === "paused" || goal.status === "usage_limited" ? <button type="button" className="webui-goal-action" data-testid="thread-goal-banner-resume" aria-label="继续目标" title="继续目标" onClick={() => submitPatch({ status: "active" })} disabled={busy || interactionBlocked}><GoalResumeIcon /></button> : null}
          {goal.status === "active" && !goal.executionWait ? <button type="button" className="webui-goal-action" data-testid="thread-goal-banner-pause" aria-label="暂停目标" title="暂停目标" onClick={() => submitPatch({ status: "paused" })} disabled={busy || interactionBlocked}><GoalPauseIcon /></button> : null}
          <button type="button" className="webui-goal-action" data-testid="thread-goal-banner-edit-button" aria-label="编辑目标" title="编辑目标" onClick={() => setEditing((value) => !value)} disabled={busy || interactionBlocked || (goal.status === "complete")}><WebuiIconContextRename /></button>
          {goal.status !== "complete" ? <button type="button" className="webui-goal-action" data-testid="thread-goal-banner-clear" aria-label="清除目标" title="清除目标" onClick={() => setConfirmClear(true)} disabled={busy || interactionBlocked}><WebuiIconContextTrash /></button> : <button type="button" className="webui-goal-action" data-testid="thread-goal-banner-close" aria-label="关闭目标" title="关闭目标" onClick={() => setConfirmClear(true)} disabled={busy}><WebuiIconContextTrash /></button>}
        </div>
      </div>
      {goal.executionWait ? <div className="webui-goal-wait" data-testid="thread-goal-wait">{WEBUI_GOAL_WAIT_COPY[goal.executionWait.reason] ?? WEBUI_GOAL_WAIT_COPY.unknown}</div> : null}
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
