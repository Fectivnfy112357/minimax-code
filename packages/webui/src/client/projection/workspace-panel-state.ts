import type { WebuiTurnDiffView } from "../../server/port.js";

export type WorkspacePanelTab =
  { readonly id: string; readonly kind: "files"; readonly sessionId?: string; readonly workspaceDir?: string }
  | { readonly id: string; readonly kind: "file-preview"; readonly sessionId: string; readonly workspaceDir: string; readonly path: string; readonly lineStart?: number; readonly lineEnd?: number }
  | { readonly id: string; readonly kind: "review"; readonly sessionId: string; readonly workspaceDir: string; readonly source: "workspace"; readonly selectedPath?: string; readonly reviewSnapshotId?: string }
  | { readonly id: string; readonly kind: "review"; readonly sessionId: string; readonly workspaceDir: string; readonly source: "turn"; readonly messageId: string; readonly assistantMessageId?: string; readonly turnId?: string; readonly changeSetId?: string; readonly files: WebuiTurnDiffView["fileChanges"]; readonly selectedPath?: string }
  | { readonly id: string; readonly kind: "canvas"; readonly sessionId?: string }
  | { readonly id: string; readonly kind: "terminal"; readonly workspaceDir?: string };

export interface WorkspacePanelState {
  readonly open: boolean;
  readonly expanded: boolean;
  readonly tabs: readonly WorkspacePanelTab[];
  readonly activeTabId?: string;
  readonly addMenuOpen: boolean;
}

export type WorkspacePanelCommand =
  | { readonly type: "open-file"; readonly sessionId: string; readonly workspaceDir: string; readonly path: string; readonly lineStart?: number; readonly lineEnd?: number }
  | { readonly type: "open-workspace-review"; readonly sessionId: string; readonly workspaceDir: string; readonly selectedPath?: string }
  | { readonly type: "open-turn-review"; readonly sessionId: string; readonly workspaceDir: string; readonly messageId: string; readonly assistantMessageId?: string; readonly turnId?: string; readonly changeSetId?: string; readonly files: WebuiTurnDiffView["fileChanges"]; readonly selectedPath?: string }
  | { readonly type: "open-primary-view"; readonly kind: "files"; readonly sessionId?: string; readonly workspaceDir?: string }
  | { readonly type: "open-tab"; readonly kind: "files" | "canvas" | "terminal"; readonly sessionId?: string; readonly workspaceDir?: string }
  | { readonly type: "select-tab"; readonly tabId: string }
  | { readonly type: "select-review-file"; readonly tabId: string; readonly path: string }
  | { readonly type: "set-review-snapshot"; readonly tabId: string; readonly reviewSnapshotId: string }
  | { readonly type: "close-tab"; readonly tabId: string }
  | { readonly type: "close-panel" }
  | { readonly type: "toggle-expanded" }
  | { readonly type: "toggle-add-menu" };

export const initialWorkspacePanelState: WorkspacePanelState = {
  open: false,
  expanded: false,
  tabs: [],
  addMenuOpen: false,
};

function tabId(kind: string, ...parts: string[]): string {
  return `${kind}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function activate(state: WorkspacePanelState, tab: WorkspacePanelTab): WorkspacePanelState {
  const existing = state.tabs.find((candidate) => candidate.id === tab.id);
  return {
    ...state,
    open: true,
    addMenuOpen: false,
    tabs: existing ? state.tabs.map((candidate) => candidate.id === tab.id ? tab : candidate) : [...state.tabs, tab],
    activeTabId: tab.id,
  };
}

export function reduceWorkspacePanelState(state: WorkspacePanelState, command: WorkspacePanelCommand): WorkspacePanelState {
  switch (command.type) {
    case "open-file": {
      const path = command.path.replace(/\\/gu, "/").replace(/^\.\//u, "");
      if (!path || path.startsWith("/") || path.split("/").some((part) => part === ".." || part === "")) return state;
      return activate(state, { id: tabId("file", command.sessionId, command.workspaceDir, path), kind: "file-preview", sessionId: command.sessionId, workspaceDir: command.workspaceDir, path, ...(command.lineStart !== undefined ? { lineStart: command.lineStart } : {}), ...(command.lineEnd !== undefined ? { lineEnd: command.lineEnd } : {}) });
    }
    case "open-workspace-review": {
      const id = tabId("review", command.sessionId, command.workspaceDir);
      return activate(state, { id, kind: "review", source: "workspace", sessionId: command.sessionId, workspaceDir: command.workspaceDir, ...(command.selectedPath ? { selectedPath: command.selectedPath } : {}) });
    }
    case "open-turn-review": {
      const id = tabId("review", command.sessionId, command.workspaceDir);
      return activate(state, { id, kind: "review", source: "turn", sessionId: command.sessionId, workspaceDir: command.workspaceDir, messageId: command.messageId, assistantMessageId: command.assistantMessageId, turnId: command.turnId, changeSetId: command.changeSetId, files: command.files ?? [], ...(command.selectedPath ? { selectedPath: command.selectedPath } : {}) });
    }
    case "open-primary-view": {
      const id = tabId(command.kind, command.sessionId ?? "", command.workspaceDir ?? "");
      const tab: WorkspacePanelTab = { id, kind: command.kind, ...(command.sessionId ? { sessionId: command.sessionId } : {}), ...(command.workspaceDir ? { workspaceDir: command.workspaceDir } : {}) };
      const tabs = state.tabs.filter((candidate) => candidate.kind !== "files");
      return { ...state, open: true, addMenuOpen: false, tabs: [...tabs, tab], activeTabId: id };
    }
    case "open-tab": {
      const id = tabId(command.kind, command.sessionId ?? "", command.workspaceDir ?? "");
      return activate(state, { id, kind: command.kind, ...(command.sessionId ? { sessionId: command.sessionId } : {}), ...(command.workspaceDir ? { workspaceDir: command.workspaceDir } : {}) });
    }
    case "select-tab":
      return state.tabs.some((tab) => tab.id === command.tabId) ? { ...state, open: true, activeTabId: command.tabId, addMenuOpen: false } : state;
    case "select-review-file":
      return updateWorkspacePanelTab(state, command.tabId, (tab) => tab.kind === "review" ? { ...tab, selectedPath: command.path } : tab);
    case "set-review-snapshot":
      return updateWorkspacePanelTab(state, command.tabId, (tab) => tab.kind === "review" ? { ...tab, reviewSnapshotId: command.reviewSnapshotId } : tab);
    case "close-tab": {
      const index = state.tabs.findIndex((tab) => tab.id === command.tabId);
      if (index < 0) return state;
      const tabs = state.tabs.filter((tab) => tab.id !== command.tabId);
      const activeTabId = state.activeTabId === command.tabId ? tabs[Math.min(index, tabs.length - 1)]?.id : state.activeTabId;
      return { ...state, tabs, activeTabId, open: tabs.length > 0, addMenuOpen: false };
    }
    case "close-panel":
      return { ...state, open: false, addMenuOpen: false };
    case "toggle-expanded":
      return { ...state, expanded: !state.expanded };
    case "toggle-add-menu":
      return { ...state, open: true, addMenuOpen: !state.addMenuOpen };
  }
}

export function updateWorkspacePanelTab(state: WorkspacePanelState, tabIdValue: string, update: (tab: WorkspacePanelTab) => WorkspacePanelTab): WorkspacePanelState {
  return { ...state, tabs: state.tabs.map((tab) => tab.id === tabIdValue ? update(tab) : tab) };
}
