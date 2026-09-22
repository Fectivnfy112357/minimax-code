import { useEffect, useRef, useState, type ReactElement } from "react";
import { WebuiIconBell, WebuiIconBrand, WebuiIconCommandUsage } from "../icons.js";
import type {
  WebuiUsageQuotaResult,
  WebuiUsageQuotaVideoView,
  WebuiUsageQuotaWindowView,
} from "../../server/port.js";
import { SettingsModal } from "./SettingsModal.js";

type AccountStatus = Record<string, unknown>;
type UsageLoader = (request: { readonly id: string }) => Promise<Record<string, unknown>>;

interface UserMenuProps {
  readonly collapsed: boolean;
  readonly hostLabel?: string;
  readonly dataDir?: string;
  readonly sessionId?: string;
  readonly listModels?: (request?: { readonly sessionId?: string }) => Promise<readonly {
    readonly providerId: string;
    readonly modelId: string;
    readonly variant?: string;
    readonly displayName?: string;
    readonly selected?: boolean;
  }[]>;
  readonly selectModel?: (request: { readonly providerId: string; readonly modelId: string; readonly variant?: string; readonly sessionId?: string }) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: UsageLoader;
  readonly getUsageQuota?: (request?: {
    readonly forceRefresh?: boolean;
  }) => Promise<WebuiUsageQuotaResult>;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<AccountStatus>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
}

interface UsageState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly result?: WebuiUsageQuotaResult;
  readonly errorMessage?: string;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function accountString(account: AccountStatus | undefined, key: string): string | undefined {
  const candidates = [
    account?.[key],
    objectValue(account?.account)?.[key],
    objectValue(account?.user)?.[key],
    objectValue(account?.profile)?.[key],
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

/** Mirrors the desktop's credit formatting: thousands separators, integer
 * rounding (the API reports `7726.2119999999995`, desktop shows `7,726`),
 * `—` when absent. */
function formatCredits(value: string | undefined): string {
  if (value === undefined) return "—";
  const numeric = Number(value.replace(/,/gu, ""));
  if (!Number.isFinite(numeric) || value.trim() === "") return value;
  return numeric.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

/**
 * Formats a quota reset timestamp the way the desktop popover does:
 * `3小时13分后重置` below a day, `5天7小时后重置` once days are involved,
 * `13分后重置` below an hour. A past or invalid timestamp renders nothing.
 */
export function formatUsageResetLabel(
  resetAtMs: number | undefined,
  nowMs: number = Date.now(),
): string | undefined {
  if (resetAtMs === undefined) return undefined;
  const delta = resetAtMs - nowMs;
  if (!Number.isFinite(delta) || delta <= 0) return undefined;
  const days = Math.floor(delta / 86_400_000);
  const hours = Math.floor((delta % 86_400_000) / 3_600_000);
  const minutes = Math.floor((delta % 3_600_000) / 60_000);
  const time =
    days > 0
      ? `${days}天${hours}小时`
      : hours > 0
        ? `${hours}小时${minutes}分`
        : `${minutes}分`;
  return `${time}后重置`;
}

function UsageGlyph({ kind }: { readonly kind: "settings" | "upgrade" | "signin" | "feedback" | "logout" }): ReactElement {
  const path = kind === "settings"
    ? "M10 2.5 11.2 4.1 13.1 3.8 13.8 5.6 15.6 6.3 15.3 8.2 16.9 9.4 15.8 11 16.2 12.9 14.4 13.6 13.7 15.4 11.8 15.1 10.6 16.7 9 15.6 7.1 16 6.4 14.2 4.6 13.5 4.9 11.6 3.3 10.4 4.4 8.8 4 6.9 5.8 6.2 6.5 4.4 8.4 4.7 9.6 3.1Z M10.1 8.1A1.9 1.9 0 1 0 10.1 11.9A1.9 1.9 0 0 0 10.1 8.1Z"
    : kind === "upgrade"
      ? "M10 2.6 15.3 8h-3.2v5.1H7.9V8H4.7L10 2.6ZM4.6 14.2h10.8v1.2H4.6v-1.2Z"
      : kind === "signin"
        ? "M10 2.8 11.1 5.6 14 6.7 11.1 7.8 10 10.6 8.9 7.8 6 6.7 8.9 5.6 10 2.8ZM15.1 10.7 15.8 12.4 17.5 13.1 15.8 13.8 15.1 15.5 14.4 13.8 12.7 13.1 14.4 12.4 15.1 10.7ZM5 11.2 5.7 12.9 7.4 13.6 5.7 14.3 5 16 4.3 14.3 2.6 13.6 4.3 12.9 5 11.2Z"
        : kind === "feedback"
          ? "M3.3 4.2h13.4v8.5H9.4l-3.2 3v-3H3.3V4.2ZM5 5.8v5.3h2.8v1.1l1.2-1.1H15V5.8H5Z"
          : "M5.1 4.4h1.6v7.9h6.1l-1.9-1.9 1.1-1.1 3.8 3.8-3.8 3.8-1.1-1.1 1.9-1.9H6.7v-7.9Z";
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={path} fill="currentColor" fillRule="evenodd" clipRule="evenodd" /></svg>;
}

function Chevron(): ReactElement {
  return <svg className="webui-user-menu-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MenuDivider(): ReactElement {
  return <div className="webui-user-menu-divider" role="separator" />;
}

function UsageSkeleton({ animated }: { readonly animated?: boolean }): ReactElement {
  const bars = () => (
    <>
      <div className="webui-user-menu-usage-skeleton-line">
        <span className="webui-user-menu-usage-skeleton-bar webui-user-menu-usage-skeleton-bar--a" />
        <span className="webui-user-menu-usage-skeleton-bar webui-user-menu-usage-skeleton-bar--b" />
      </div>
      <div className="webui-user-menu-usage-skeleton-line">
        <span className="webui-user-menu-usage-skeleton-bar webui-user-menu-usage-skeleton-bar--c" />
        <span className="webui-user-menu-usage-skeleton-bar webui-user-menu-usage-skeleton-bar--d" />
      </div>
    </>
  );
  return (
    <div
      className={`webui-user-menu-usage-skeleton${animated ? " is-animated" : ""}`}
      data-testid={animated ? "usage-popover-loading" : "usage-popover-pending"}
    >
      <div className="webui-user-menu-usage-skeleton-row">{bars()}</div>
      <div className="webui-user-menu-usage-skeleton-row">{bars()}</div>
    </div>
  );
}

interface QuotaRowProps {
  readonly label: string;
  readonly valueLabel: string;
  readonly resetLabel?: string;
  readonly totalLabel?: string;
  readonly position: "first" | "middle" | "last" | "solo";
}

function QuotaRow(props: QuotaRowProps): ReactElement {
  return (
    <div className={`webui-user-menu-quota-row webui-user-menu-quota-row--${props.position}`}>
      <div className="webui-user-menu-quota-line">
        <span className="webui-user-menu-quota-label">{props.label}</span>
        <span className="webui-user-menu-quota-value">{props.valueLabel}</span>
      </div>
      {props.resetLabel || props.totalLabel ? (
        <div className="webui-user-menu-quota-line webui-user-menu-quota-meta">
          <span>{props.resetLabel ?? ""}</span>
          <span>{props.totalLabel ?? ""}</span>
        </div>
      ) : null}
    </div>
  );
}

function windowValueLabel(window: WebuiUsageQuotaWindowView): string {
  if (window.unlimited) return "无限制";
  return window.usedPercent === undefined ? "—" : `已用 ${window.usedPercent}%`;
}

function windowTotalLabel(window: WebuiUsageQuotaWindowView): string | undefined {
  if (window.unlimited || window.totalPercent === undefined) return undefined;
  return `总额 ${window.totalPercent}%`;
}

function videoValueLabel(video: WebuiUsageQuotaVideoView): string {
  if (video.unlimited) return "无限制";
  if (video.usedCount === undefined || video.totalCount === undefined) return "—";
  return `${video.usedCount}/${video.totalCount}`;
}

const AUTH_ERROR_PATTERN = /cookie|unauthori[sz]ed|token|login/iu;

function UsageReady({ result }: { readonly result?: WebuiUsageQuotaResult }): ReactElement {
  if (!result || result.signedIn === false) {
    return (
      <div
        className="webui-user-menu-usage-signed-out"
        data-testid="usage-popover-no-workspace"
      >
        登录后查看用量
      </div>
    );
  }
  const quota = result.quota;
  const rows: { label: string; valueLabel: string; resetAtMs?: number; totalLabel?: string }[] = [];
  if (quota) {
    rows.push({
      label: "5 小时限额",
      valueLabel: windowValueLabel(quota.fiveHour),
      resetAtMs: quota.fiveHour.resetAtMs,
      totalLabel: windowTotalLabel(quota.fiveHour),
    });
    rows.push({
      label: "周限额",
      valueLabel: windowValueLabel(quota.weekly),
      resetAtMs: quota.weekly.resetAtMs,
      totalLabel: windowTotalLabel(quota.weekly),
    });
    if (quota.video) {
      rows.push({
        label: "视频限额",
        valueLabel: videoValueLabel(quota.video),
        resetAtMs: quota.video.resetAtMs,
      });
    }
  }
  const position = (index: number): QuotaRowProps["position"] =>
    rows.length === 1
      ? "solo"
      : index === 0
        ? "first"
        : index === rows.length - 1
          ? "last"
          : "middle";
  const showPlanRow = result.hasTokenPlan === false;
  return (
    <div className="webui-user-menu-usage-content" data-testid="usage-popover-content">
      {showPlanRow ? (
        <div className="webui-user-menu-quota-rows">
          <div className="webui-user-menu-quota-line">
            <span className="webui-user-menu-quota-label">Token Plan</span>
            <span className="webui-user-menu-quota-value webui-user-menu-quota-value--tertiary">未订阅</span>
          </div>
        </div>
      ) : rows.length > 0 ? (
        <div className="webui-user-menu-quota-rows">
          {rows.map((row, index) => (
            <QuotaRow
              key={row.label}
              label={row.label}
              valueLabel={row.valueLabel}
              resetLabel={formatUsageResetLabel(row.resetAtMs)}
              totalLabel={row.totalLabel}
              position={position(index)}
            />
          ))}
        </div>
      ) : null}
      {showPlanRow || rows.length > 0 ? <div className="webui-user-menu-usage-hairline" /> : null}
      <div className="webui-user-menu-credits-row">
        <span>积分</span>
        <span>{formatCredits(result.creditBalance)}</span>
      </div>
    </div>
  );
}

/** The usage sub-panel: desktop states (skeleton / error+retry / signed-out / content). */
export function UsagePanel({
  state,
  onRetry,
}: {
  readonly state: UsageState;
  readonly onRetry: () => void;
}): ReactElement {
  return (
    <div className="webui-user-menu-usage-panel" role="dialog" aria-label="用量">
      {state.status === "loading" ? <UsageSkeleton animated /> : null}
      {state.status === "idle" ? <UsageSkeleton /> : null}
      {state.status === "error" ? (
        <div className="webui-user-menu-usage-error" data-testid="usage-popover-error">
          <span className="webui-user-menu-usage-error-title">
            {state.errorMessage && AUTH_ERROR_PATTERN.test(state.errorMessage)
              ? "请重新登录"
              : "加载失败"}
          </span>
          <button type="button" className="webui-user-menu-usage-retry" onClick={onRetry}>
            重试
          </button>
        </div>
      ) : null}
      {state.status === "ready" ? <UsageReady result={state.result} /> : null}
    </div>
  );
}

export function UserMenu({
  collapsed,
  hostLabel,
  dataDir,
  sessionId,
  listModels,
  selectModel,
  getUsageQuota,
  getAccountStatus,
  signOut,
}: UserMenuProps): ReactElement {
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [usageOpen, setUsageOpen] = useState(false);
  const [usage, setUsage] = useState<UsageState>({ status: "idle" });
  const [account, setAccount] = useState<AccountStatus>();

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !anchorRef.current?.contains(event.target)) {
        setOpen(false);
        setUsageOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setUsageOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !getAccountStatus) return;
    let cancelled = false;
    void getAccountStatus({ sessionId }).then((next) => {
      if (!cancelled) setAccount(next);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [getAccountStatus, open, sessionId]);

  const loadUsage = (forceRefresh = false) => {
    setUsageOpen(true);
    if (!getUsageQuota) {
      setUsage({ status: "idle" });
      return;
    }
    setUsage({ status: "loading" });
    void getUsageQuota(forceRefresh ? { forceRefresh: true } : undefined)
      .then((result) => {
        setUsage({ status: "ready", result });
      })
      .catch((error: unknown) => {
        setUsage({
          status: "error",
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
  };
  const nickname = accountString(account, "nickname") ?? accountString(account, "name") ?? "MiniMax Code";
  const plan = accountString(account, "plan") ?? accountString(account, "planName") ?? (hostLabel ? `本地 · ${hostLabel}` : "本地");
  const uid = accountString(account, "uid") ?? accountString(account, "userId") ?? accountString(account, "id");

  return <>
    <div ref={anchorRef} className={`webui-user-menu-anchor ${collapsed ? "webui-user-menu-anchor-collapsed" : ""}`} data-webui-rail-identity="true">
      {collapsed ? <button type="button" className="webui-user-menu-trigger-rail" data-testid="sidebar-user-menu-trigger-rail" aria-label="打开用户菜单" aria-expanded={open} onClick={() => { setOpen((value) => !value); setUsageOpen(false); }}><WebuiIconBrand /></button> : <button type="button" className="webui-user-menu-trigger" data-testid="sidebar-user-menu-trigger" aria-label="打开用户菜单" aria-expanded={open} onClick={() => { setOpen((value) => !value); setUsageOpen(false); }}>
        <span className="webui-user-menu-avatar"><WebuiIconBrand /></span>
        <span className="webui-user-menu-identity"><span>{nickname}</span><small>{plan}</small></span>
        <span className="webui-user-menu-bell" aria-hidden="true"><WebuiIconBell /></span>
      </button>}
      {open ? <div className="webui-user-menu-popover" role="menu">
        <div className="webui-user-menu-uid" aria-label="用户 ID">UID : {uid ?? "—"}</div>
        <div className="webui-user-menu-list">
          <button type="button" className="webui-user-menu-item" role="menuitem" data-testid="user-menu-settings" onClick={() => { setOpen(false); setSettingsOpen(true); }}><UsageGlyph kind="settings" /><span>设置</span><span className="webui-user-menu-shortcut">Ctrl+,</span></button>
          <button type="button" className="webui-user-menu-item" role="menuitem" aria-disabled="true" tabIndex={-1}><UsageGlyph kind="upgrade" /><span>升级</span></button>
          <MenuDivider />
          <button type="button" className="webui-user-menu-item" role="menuitem" aria-disabled="true" tabIndex={-1}><UsageGlyph kind="signin" /><span>每日签到</span></button>
          <div className="webui-user-menu-usage-anchor" onMouseEnter={() => loadUsage()} onFocus={() => loadUsage()}>
            <button type="button" className="webui-user-menu-item" role="menuitem" aria-haspopup="dialog" aria-expanded={usageOpen} data-testid="user-menu-usage" onClick={() => loadUsage()}><WebuiIconCommandUsage /><span>用量</span><Chevron /></button>
            {usageOpen ? <UsagePanel state={usage} onRetry={() => loadUsage(true)} /> : null}
          </div>
          <MenuDivider />
          <button type="button" className="webui-user-menu-item" role="menuitem" aria-disabled="true" tabIndex={-1}><UsageGlyph kind="feedback" /><span>反馈与帮助</span><Chevron /></button>
          <button type="button" className="webui-user-menu-item" role="menuitem" aria-disabled="true" tabIndex={-1}><UsageGlyph kind="logout" /><span>退出登录</span></button>
        </div>
      </div> : null}
    </div>
    <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} dataDir={dataDir} sessionId={sessionId} listModels={listModels} selectModel={selectModel} getAccountStatus={getAccountStatus} signOut={signOut} />
  </>;
}
