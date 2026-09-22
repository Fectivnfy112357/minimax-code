import { useEffect, useRef, useState, type ReactElement } from "react";
import { WebuiIconBell, WebuiIconBrand, WebuiIconCommandUsage } from "../icons.js";
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
  readonly selectModel?: (request: { readonly providerId: string; readonly modelId: string; readonly variant?: string; readonly contextLimit?: number; readonly sessionId?: string }) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: UsageLoader;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<AccountStatus>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
}

interface UsageState {
  readonly status: "idle" | "loading" | "ready" | "error";
  readonly data?: Record<string, unknown>;
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

function formatCount(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString("en-US") : "—";
}

function usageSummary(data: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  return objectValue(data?.summary) ?? data;
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
          : "M5.1 4.4h1.6v7.9h6.1l-1.9-1.9 1.1-1.1 3.8 3.8-3.8 3.8-1.1-1.1 1.9-1.9H5.1V4.4Z";
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={path} fill="currentColor" fillRule="evenodd" clipRule="evenodd" /></svg>;
}

function Chevron(): ReactElement {
  return <svg className="webui-user-menu-chevron" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m7.5 4.75 5.25 5.25-5.25 5.25" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function MenuDivider(): ReactElement {
  return <div className="webui-user-menu-divider" role="separator" />;
}

function UsagePanel({ state }: { readonly state: UsageState }): ReactElement {
  const summary = usageSummary(state.data);
  const rows = Array.isArray(state.data?.rows) ? state.data.rows.map(objectValue).filter((row): row is Record<string, unknown> => Boolean(row)) : [];
  const models = [...new Set(rows.map((row) => typeof row.model === "string" ? row.model : undefined).filter((model): model is string => Boolean(model)))];
  const total = summary?.totalTokens ?? summary?.total_tokens;
  const turns = summary?.turns;
  return <div className="webui-user-menu-usage-panel" data-testid="usage-popover-content" role="dialog" aria-label="用量">
    <div className="webui-user-menu-usage-row"><span>5 小时限额</span><strong>—</strong></div>
    <div className="webui-user-menu-usage-row"><span>周限额</span><strong>—</strong></div>
    <div className="webui-user-menu-usage-row"><span>视频限额</span><strong>—</strong></div>
    <div className="webui-user-menu-usage-hairline" />
    {state.status === "loading" ? <p className="webui-user-menu-usage-message">加载中…</p> : null}
    {state.status === "error" ? <p className="webui-user-menu-usage-message">用量暂不可用</p> : null}
    {state.status === "idle" ? <p className="webui-user-menu-usage-message">暂无活动会话</p> : null}
    {state.status === "ready" ? <>
      <div className="webui-user-menu-usage-row"><span>会话 Token</span><strong>{formatCount(total)}</strong></div>
      <div className="webui-user-menu-usage-row"><span>轮次</span><strong>{formatCount(turns)}</strong></div>
      <div className="webui-user-menu-usage-row"><span>模型</span><strong>{models.length ? models.join(", ") : "—"}</strong></div>
    </> : null}
  </div>;
}

export function UserMenu({
  collapsed,
  hostLabel,
  dataDir,
  sessionId,
  listModels,
  selectModel,
  getSessionUsage,
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

  const loadUsage = () => {
    setUsageOpen(true);
    if (!sessionId || !getSessionUsage) {
      setUsage({ status: "idle" });
      return;
    }
    setUsage({ status: "loading" });
    void getSessionUsage({ id: sessionId }).then((data) => {
      setUsage({ status: "ready", data });
    }).catch(() => {
      setUsage({ status: "error" });
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
          <div className="webui-user-menu-usage-anchor" onMouseEnter={loadUsage} onFocus={loadUsage}>
            <button type="button" className="webui-user-menu-item" role="menuitem" aria-haspopup="dialog" aria-expanded={usageOpen} data-testid="user-menu-usage" onClick={loadUsage}><WebuiIconCommandUsage /><span>用量</span><Chevron /></button>
            {usageOpen ? <UsagePanel state={usage} /> : null}
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
