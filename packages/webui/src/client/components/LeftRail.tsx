import type { WebuiClientSession } from "../app.js";

export const WEBUI_SESSION_OVERLAY_KEYS = {
  stars: "mavis-webui-session-stars:v1",
  pins: "mavis-webui-session-pins:v1",
  archives: "mavis-webui-session-archives:v1",
} as const;

export type WebuiSessionOverlay = "stars" | "pins" | "archives";

export function readSessionOverlay(kind: WebuiSessionOverlay): Record<string, boolean> {
  try {
    const value = JSON.parse(localStorage.getItem(WEBUI_SESSION_OVERLAY_KEYS[kind]) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

export function toggleSessionOverlay(kind: WebuiSessionOverlay, sessionId: string): Record<string, boolean> {
  const next = readSessionOverlay(kind);
  if (next[sessionId]) delete next[sessionId]; else next[sessionId] = true;
  localStorage.setItem(WEBUI_SESSION_OVERLAY_KEYS[kind], JSON.stringify(next));
  return next;
}

const DESKTOP_ONLY_ENTRIES = ["Schedules", "Plugins / Skill marketplace", "Websites", "Remote control", "Maxclaw", "Maxhermes"];

export function LeftRail({ sessions, activeSessionId, onSelect, onNew, onSettings }: {
  readonly sessions: readonly WebuiClientSession[];
  readonly activeSessionId?: string;
  readonly onSelect?: (id: string) => void;
  readonly onNew?: () => void;
  readonly onSettings?: () => void;
}) {
  return <div className="flex min-h-0 flex-1 flex-col gap-spacing_16">
    <button className="webui-button-primary" onClick={onNew}>New session</button>
    <nav className="grid gap-1" aria-label="Desktop navigation">
      {DESKTOP_ONLY_ENTRIES.map((entry) => <button key={entry} type="button" disabled title="Desktop only" className="webui-nav-item cursor-not-allowed text-left text-text_default_tertiary opacity-60">{entry}<span className="sr-only">Desktop only</span></button>)}
      <button type="button" className="webui-nav-item text-left">Local workspaces</button>
    </nav>
    <div className="min-h-0 flex-1 overflow-auto">
      {sessions.map((session) => <button key={session.sessionId} className="webui-session-card" data-webui-session-active={session.sessionId === activeSessionId} onClick={() => onSelect?.(session.sessionId)}>{session.title ?? session.agentName}</button>)}
    </div>
    <button className="webui-button-secondary" onClick={onSettings}>Settings</button>
  </div>;
}
