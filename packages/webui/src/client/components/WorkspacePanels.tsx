import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  WebuiCanvasDocument,
  WebuiWorkspaceEnvironment,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceGitMutationRequest,
} from "../../server/port.js";
import { WebuiIconCheck, WebuiIconChevronDown, WebuiIconChevronLeft, WebuiIconClose, WebuiIconFile, WebuiIconFolder, WebuiIconGlobe, WebuiIconRunLocation, WebuiIconSidebarToggle } from "../icons.js";

export type WebuiTodo = { readonly content: string; readonly status: "completed" | "in_progress" | "pending" };
const DESKTOP_COPY = { environment: "环境信息", progress: "进度", progressEmpty: "跟踪较长任务的进度", newTerminal: "新建终端", terminalLimit: "最多可以打开 5 个终端", terminalLabel: "终端", terminalExited: "已退出", terminalEmptyTitle: "还没有终端", terminalEmptyDescription: "可直接在右侧面板中启动当前工作区的 Shell。", canvasEmptyTitle: "把文件放到画布上", canvasEmptyDescription: "添加图片或其他工作区文件，然后自由排列和调整大小。", fileClose: "关闭", changes: "变更", commit: "提交或推送", openTerminal: "打开终端", unsupported: "WebUI 尚未接入此操作" } as const;

export function projectWebuiTodos(messages: readonly Record<string, unknown>[]): WebuiTodo[] {
  for (const message of [...messages].reverse()) {
    const calls = Array.isArray(message.toolCalls) ? message.toolCalls : [];
    for (const call of [...calls].reverse()) {
      const name = String((call as Record<string, unknown>).name ?? (call as Record<string, unknown>).toolName ?? "").toLowerCase();
      if (name !== "todowrite" && name !== "todo_write") continue;
      const input = ((call as Record<string, unknown>).input ?? (call as Record<string, unknown>).arguments) as Record<string, unknown> | undefined;
      const todos = input?.todos;
      if (!Array.isArray(todos)) continue;
      return todos.flatMap((todo) => {
        if (!todo || typeof todo !== "object") return [];
        const value = todo as Record<string, unknown>;
        const status = value.status;
        return typeof value.content === "string" && (status === "completed" || status === "in_progress" || status === "pending")
          ? [{ content: value.content, status }]
          : [];
      });
    }
  }
  return [];
}

export function WebuiProgressPanel({ todos, showProgress = true, showEmptyProgress = true, collapsed = false, onToggle }: { readonly todos: readonly WebuiTodo[]; readonly showProgress?: boolean; readonly showEmptyProgress?: boolean; readonly collapsed?: boolean; readonly onToggle?: () => void }): ReactElement | null {
  if (!showProgress || (!showEmptyProgress && todos.length === 0)) return null;
  return <div className="flex shrink-0 flex-col" data-webui-progress-panel="true" data-workspace-section="true">
    <div className="group/card flex shrink-0 flex-col overflow-hidden">
      <div className="flex flex-col">
        <button type="button" className="webui-workspace-section-title flex h-7 w-full cursor-pointer items-center justify-between border-none bg-transparent pl-1.5 pr-1.5 text-sm text-text_default_secondary" onClick={onToggle} aria-expanded={!collapsed}>
          <span className="min-w-0 flex-1 truncate text-left font-normal leading-5" data-workspace-section-title="true">{DESKTOP_COPY.progress}</span><WebuiIconChevronDown className={collapsed ? "size-4 -rotate-90 text-icon_default_tertiary transition-transform duration-[180ms] ease-out" : "size-4 text-icon_default_tertiary transition-transform duration-[180ms] ease-out"} />
        </button>
      </div>
      <div className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`} aria-hidden={collapsed}>
        <div className="min-h-0 overflow-hidden">
          {todos.length === 0 ? <p className="webui-progress-empty">{DESKTOP_COPY.progressEmpty}</p> : todos.map((todo, index) => <div className={`webui-progress-row webui-progress-row--${todo.status}`} key={`${todo.content}-${index}`}>
            <span className="webui-progress-marker">{todo.status === "completed" ? <WebuiIconCheck className="size-3" /> : index + 1}</span>
            <span className={todo.status === "completed" ? "line-through text-text_default_tertiary" : ""}>{todo.content}</span>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}

function WorkspaceCommitDialog({ environment, workspaceDir, mutateWorkspaceGit, onClose, onCommitted }: {
  readonly environment: WebuiWorkspaceEnvironment;
  readonly workspaceDir: string;
  readonly mutateWorkspaceGit: (request: WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>;
  readonly onClose: () => void;
  readonly onCommitted: () => void;
}): ReactElement {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const hasChanges = environment.changedFiles > 0;
  const submit = (action: "commit" | "commitAndPush" | "push") => {
    if (action !== "push" && !message.trim()) return;
    setBusy(true);
    setError(undefined);
    void mutateWorkspaceGit({ workspaceDir, action, ...(message.trim() ? { message: message.trim() } : {}) })
      .then(() => { onCommitted(); onClose(); })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setBusy(false));
  };
  return <div className="webui-commit-dialog" role="dialog" aria-modal="true" aria-label={DESKTOP_COPY.commit}>
    <div className="webui-commit-dialog-header"><strong>{DESKTOP_COPY.commit}</strong><button type="button" aria-label={DESKTOP_COPY.fileClose} onClick={onClose}><WebuiIconClose className="size-4" /></button></div>
    {hasChanges ? <label className="webui-commit-dialog-label"><span>提交说明</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="输入提交说明" autoFocus /></label> : <p className="webui-commit-dialog-hint">当前没有未提交变更，将推送当前分支。</p>}
    {error ? <p className="webui-commit-dialog-error" role="alert">{error}</p> : null}
    <div className="webui-commit-dialog-actions">
      <button type="button" onClick={onClose} disabled={busy}>取消</button>
      {hasChanges ? <button type="button" onClick={() => submit("commit")} disabled={busy || !message.trim()}>提交</button> : null}
      <button type="button" onClick={() => submit(hasChanges ? "commitAndPush" : "push")} disabled={busy || (hasChanges && !message.trim())}>{hasChanges ? "提交并推送" : "推送"}</button>
    </div>
  </div>;
}

export function WebuiEnvironmentPanel({ workspaceDir, isDefaultWorkspace = false, workspaceEnvironment, getWorkspaceEnvironment, mutateWorkspaceGit, collapsed = false, onToggle, onOpenChanges, onOpenTerminal }: {
  readonly workspaceDir?: string;
  readonly isDefaultWorkspace?: boolean;
  readonly workspaceEnvironment?: WebuiWorkspaceEnvironment;
  readonly getWorkspaceEnvironment?: (request: { readonly workspaceDir: string }) => Promise<WebuiWorkspaceEnvironment>;
  readonly mutateWorkspaceGit?: (request: WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>;
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
  readonly onOpenChanges?: () => void;
  readonly onOpenTerminal?: () => void;
}): ReactElement | null {
  const [environment, setEnvironment] = useState<WebuiWorkspaceEnvironment | undefined>(workspaceEnvironment);
  const [commitOpen, setCommitOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  useEffect(() => {
    let cancelled = false;
    if (workspaceEnvironment) {
      setEnvironment(workspaceEnvironment);
      return () => { cancelled = true; };
    }
    setEnvironment(undefined);
    if (!workspaceDir || isDefaultWorkspace || !getWorkspaceEnvironment) return () => { cancelled = true; };
    void getWorkspaceEnvironment({ workspaceDir }).then((next) => { if (!cancelled) setEnvironment(next); }).catch(() => { if (!cancelled) setEnvironment(undefined); });
    return () => { cancelled = true; };
  }, [getWorkspaceEnvironment, isDefaultWorkspace, reloadToken, workspaceDir, workspaceEnvironment]);
  if (!workspaceDir || isDefaultWorkspace || (!getWorkspaceEnvironment && !workspaceEnvironment) || !environment?.isGitRepo) return null;
  const hasChanges = environment.changedFiles > 0;
  const canMutate = Boolean(mutateWorkspaceGit && !environment.changesError && !environment.metadataError && (hasChanges || environment.canPush));
  const statsReady = environment.lineStatsStatus === "ready";
  return <>
    <div className="webui-environment-panel" data-webui-environment-panel="true" data-workspace-section="true">
      <button type="button" className="webui-workspace-section-title" onClick={onToggle} aria-expanded={!collapsed}>
        <span data-workspace-section-title="true">{DESKTOP_COPY.environment}</span>
        <WebuiIconChevronDown className={collapsed ? "size-4 -rotate-90 text-icon_default_tertiary transition-transform duration-[180ms] ease-out" : "size-4 text-icon_default_tertiary transition-transform duration-[180ms] ease-out"} />
      </button>
      <div className={`webui-environment-body transition-[max-height,opacity] duration-[180ms] ease-out ${collapsed ? "max-h-0 overflow-hidden opacity-0" : "max-h-64 opacity-100"}`} aria-hidden={collapsed}>
        <div className="webui-environment-workspace" title={workspaceDir}>{environment.branch || " "}</div>
        <div className="webui-environment-actions">
          <button type="button" className="webui-environment-action" onClick={onOpenChanges} disabled={!onOpenChanges} title={environment.changesError ?? undefined}>
            <WebuiIconRunLocation className="size-5" /><span>{DESKTOP_COPY.changes}</span>{hasChanges && statsReady ? <small>+{environment.insertions} -{environment.deletions}</small> : null}
          </button>
          <button type="button" className="webui-environment-action" onClick={() => setCommitOpen(true)} disabled={!canMutate} title={!mutateWorkspaceGit ? DESKTOP_COPY.unsupported : environment.metadataError ?? environment.changesError}>
            <WebuiIconFile className="size-5" /><span>{DESKTOP_COPY.commit}</span>
          </button>
          <button type="button" className="webui-environment-action" onClick={onOpenTerminal} disabled={!onOpenTerminal}>
            <WebuiIconRunLocation className="size-5" /><span>{DESKTOP_COPY.openTerminal}</span>
          </button>
        </div>
      </div>
    </div>
    {commitOpen && mutateWorkspaceGit ? <WorkspaceCommitDialog environment={environment} workspaceDir={workspaceDir} mutateWorkspaceGit={mutateWorkspaceGit} onClose={() => setCommitOpen(false)} onCommitted={() => setReloadToken((value) => value + 1)} /> : null}
  </>;
}

export function WebuiWorkspacePanelControls({ filePanelOpen, workspaceOpen, onOpenFiles, onToggleWorkspace }: { readonly filePanelOpen: boolean; readonly workspaceOpen: boolean; readonly onOpenFiles: () => void; readonly onToggleWorkspace: () => void }): ReactElement {
  return <div className="webui-workspace-panel-controls" data-testid="workspace-panel-controls">
    <button type="button" className="webui-workspace-icon-button" data-webui-placeholder-chrome="browser-entry" aria-label="浏览器" aria-disabled="true" disabled><WebuiIconGlobe className="size-5" /></button>
    <button type="button" className={`webui-workspace-icon-button ${filePanelOpen ? "is-active" : ""}`} aria-label="打开文件" aria-pressed={filePanelOpen} onClick={onOpenFiles}><WebuiIconFolder className="size-5" /></button>
    <button type="button" className={`webui-workspace-icon-button ${workspaceOpen ? "is-active" : ""}`} aria-label="工作区" aria-pressed={workspaceOpen} onClick={onToggleWorkspace}><WebuiIconSidebarToggle className="size-5" /></button>
  </div>;
}

export function WebuiWorkspaceOverview({ workspaceDir, isDefaultWorkspace = false, workspaceEnvironment, todos, showProgress = true, showEmptyProgress = true, getWorkspaceEnvironment, mutateWorkspaceGit, environmentCollapsed = false, progressCollapsed = false, onToggleEnvironment, onToggleProgress, onOpenChanges, onOpenTerminal }: { readonly workspaceDir?: string; readonly isDefaultWorkspace?: boolean; readonly workspaceEnvironment?: WebuiWorkspaceEnvironment; readonly todos: readonly WebuiTodo[]; readonly showProgress?: boolean; readonly showEmptyProgress?: boolean; readonly getWorkspaceEnvironment?: (request: { readonly workspaceDir: string }) => Promise<WebuiWorkspaceEnvironment>; readonly mutateWorkspaceGit?: (request: WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>; readonly environmentCollapsed?: boolean; readonly progressCollapsed?: boolean; readonly onToggleEnvironment?: () => void; readonly onToggleProgress?: () => void; readonly onOpenChanges?: () => void; readonly onOpenTerminal?: () => void }): ReactElement {
  return <div className="webui-workspace-section-group" data-testid="workspace-section-group">
    <WebuiEnvironmentPanel workspaceDir={workspaceDir} isDefaultWorkspace={isDefaultWorkspace} workspaceEnvironment={workspaceEnvironment} getWorkspaceEnvironment={getWorkspaceEnvironment} mutateWorkspaceGit={mutateWorkspaceGit} collapsed={environmentCollapsed} onToggle={onToggleEnvironment} onOpenChanges={onOpenChanges} onOpenTerminal={onOpenTerminal} />
    <WebuiProgressPanel todos={todos} showProgress={showProgress} showEmptyProgress={showEmptyProgress} collapsed={progressCollapsed} onToggle={onToggleProgress} />
  </div>;
}

function FileTree({ files, onOpen }: { readonly files: readonly WebuiWorkspaceFile[]; readonly onOpen: (file: WebuiWorkspaceFile) => void }): ReactElement {
  return <div className="webui-file-tree">{files.map((file) => <div key={file.path}>
    <button type="button" className="webui-file-tree-row" onClick={() => onOpen(file)}>{file.type === "directory" ? <WebuiIconChevronLeft className="inline size-3" /> : <WebuiIconFile className="inline size-3" />} {file.name}</button>
    {file.children?.length ? <div className="pl-3"><FileTree files={file.children} onOpen={onOpen} /></div> : null}
  </div>)}</div>;
}

export function WebuiWorkspacePanel({ sessionId, workspaceDir, listWorkspaceFileTree, readWorkspaceFile, readCanvas, applyCanvas, createTerminal, listTerminals, writeTerminal, disposeTerminal, watchTerminal, todos = [], defaultTab = "files", onClose }: {
  readonly sessionId?: string; readonly workspaceDir?: string;
  readonly listWorkspaceFileTree?: (request: { workspaceDir: string; path?: string }) => Promise<readonly WebuiWorkspaceFile[]>;
  readonly readWorkspaceFile?: (request: { workspaceDir: string; path: string }) => Promise<WebuiWorkspaceFileContent>;
  readonly readCanvas?: (request: { sessionId: string }) => Promise<WebuiCanvasDocument>;
  readonly applyCanvas?: (request: { sessionId: string; operation: Record<string, unknown> }) => Promise<unknown>;
  readonly createTerminal?: (request: { workspaceDir: string }) => Promise<{ terminalId: string; status: string }>;
  readonly listTerminals?: () => Promise<readonly Record<string, unknown>[]>;
  readonly writeTerminal?: (request: { terminalId: string; data: string }) => Promise<unknown>;
  readonly disposeTerminal?: (request: { terminalId: string }) => Promise<unknown>;
  readonly watchTerminal?: (request: { terminalId: string }, onFrame: (frame: { terminalId: string; data: string; exited: boolean }) => void) => () => void;
  readonly todos?: readonly WebuiTodo[];
  readonly defaultTab?: "files" | "canvas" | "terminal";
  readonly onClose?: () => void;
}): ReactElement {
  const [tab, setTab] = useState<"files" | "canvas" | "terminal">(defaultTab);
  const [files, setFiles] = useState<readonly WebuiWorkspaceFile[]>([]);
  const [file, setFile] = useState<{ path: string; content: WebuiWorkspaceFileContent }>();
  const [canvas, setCanvas] = useState<WebuiCanvasDocument>();
  const [zoom, setZoom] = useState(1);
  const [terminals, setTerminals] = useState<readonly Record<string, unknown>[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [terminalError, setTerminalError] = useState<string>();
  const terminalHost = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal>();
  const terminalStop = useRef<(() => void) | undefined>();
  useEffect(() => { if (workspaceDir && listWorkspaceFileTree) void listWorkspaceFileTree({ workspaceDir }).then(setFiles).catch(() => setFiles([])); }, [workspaceDir, listWorkspaceFileTree]);
  useEffect(() => { if (sessionId && readCanvas) void readCanvas({ sessionId }).then(setCanvas).catch(() => setCanvas(undefined)); }, [sessionId, readCanvas]);
  useEffect(() => { if (listTerminals) void listTerminals().then(setTerminals).catch(() => setTerminals([])); }, [listTerminals]);
  useEffect(() => () => { terminalStop.current?.(); terminalInstance.current?.dispose(); }, []);
  useEffect(() => {
    const active = terminals.find((candidate) => String(candidate.terminalId) === activeTerminalId) ?? terminals[0];
    if (!active || !terminalHost.current) return;
    const styles = getComputedStyle(terminalHost.current);
    const terminal = new Terminal({ cols: 80, rows: 24, convertEol: true, theme: { background: styles.getPropertyValue("--bg_default_secondary").trim(), foreground: styles.getPropertyValue("--terminal_foreground").trim(), cursor: styles.getPropertyValue("--terminal_cursor").trim() } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(terminalHost.current);
    fit.fit();
    terminalInstance.current = terminal;
    terminalStop.current = watchTerminal?.({ terminalId: String(active.terminalId) }, (frame) => { terminal.write(frame.data); if (frame.exited) terminal.options.disableStdin = true; });
    const onResize = () => { fit.fit(); };
    const observer = new ResizeObserver(onResize);
    observer.observe(terminalHost.current);
    const input = terminal.onData((data) => { if (writeTerminal) void writeTerminal({ terminalId: String(active.terminalId), data }); });
    return () => { input.dispose(); observer.disconnect(); terminalStop.current?.(); terminalStop.current = undefined; terminal.dispose(); terminalInstance.current = undefined; };
  }, [activeTerminalId, terminals, watchTerminal, writeTerminal]);
  const tabs = useMemo(() => [{ id: "files" as const, label: "查看文件" }, { id: "canvas" as const, label: "画布" }, { id: "terminal" as const, label: "终端" }], []);
  return <aside className="webui-workspace-panel" data-testid="workspace-panel">
    <div className="webui-workspace-panel-header"><div className="webui-workspace-tabs" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div><button type="button" className="webui-workspace-panel-close" aria-label="关闭" onClick={onClose}><WebuiIconClose className="size-4" /></button></div>
    {tab === "files" ? <div className="webui-workspace-content">
      <FileTree files={files} onOpen={(entry) => { if (workspaceDir && readWorkspaceFile && entry.type !== "directory") void readWorkspaceFile({ workspaceDir, path: entry.path }).then((content) => setFile({ path: entry.path, content })); }} />
      {file ? <div className="webui-file-viewer"><div className="file-tab group/tab-close h-8 w-40 min-w-20 rounded-lg bg-bg_interaction_tertiary_selected"><WebuiIconFile className="size-[14px]" />{file.path}<button type="button" aria-label={DESKTOP_COPY.fileClose} className="file-tab-close opacity-0 transition-opacity group-hover/tab-close:opacity-100" onClick={() => setFile(undefined)}><WebuiIconClose className="size-[14px]" /></button></div><pre>{file.content.error ?? file.content.content}</pre></div> : null}
    </div> : null}
    {tab === "canvas" ? <div className="webui-canvas-content" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.4, Math.min(2, value + (event.deltaY > 0 ? -.1 : .1)))); }}>
      {!canvas?.nodes.length ? <><strong>{DESKTOP_COPY.canvasEmptyTitle}</strong><p>{DESKTOP_COPY.canvasEmptyDescription}</p></> : <div className="webui-canvas-stage" style={{ transform: `scale(${zoom})` }}>{canvas.nodes.map((node) => <div className="webui-canvas-node" key={String(node.id)}>{String((node.file as Record<string, unknown> | undefined)?.fileName ?? node.id)}</div>)}</div>}
      <span className="webui-canvas-zoom">{Math.round(zoom * 100)}%</span>
    </div> : null}
    {tab === "terminal" ? <div className="webui-terminal-empty">{terminals.length === 0 ? <><strong>{DESKTOP_COPY.terminalEmptyTitle}</strong><p>{DESKTOP_COPY.terminalEmptyDescription}</p></> : <><div className="webui-terminal-tabs">{terminals.map((terminal, index) => <button type="button" key={String(terminal.terminalId)} className={`file-tab group/tab-close h-8 w-40 min-w-20 ${String(terminal.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId)) ? "bg-bg_interaction_tertiary_selected" : ""}`} onClick={() => setActiveTerminalId(String(terminal.terminalId))}><span>#{index + 1}</span>{terminal.status === "exited" ? DESKTOP_COPY.terminalExited : DESKTOP_COPY.terminalLabel}<span className="file-tab-close opacity-0 group-hover/tab-close:opacity-100"><WebuiIconClose className="size-[14px]" /></span></button>)}</div><div ref={terminalHost} className="webui-xterm-host" />{terminalError ? <p role="alert">{terminalError}</p> : null}<div className="webui-terminal-actions"><button type="button" onClick={() => { if (!workspaceDir || !createTerminal) return; void createTerminal({ workspaceDir }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button><button type="button" onClick={() => { const active = terminals.find((candidate) => String(candidate.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId))); if (active && disposeTerminal) void disposeTerminal({ terminalId: String(active.terminalId) }).then(() => listTerminals?.().then(setTerminals)); }}>{DESKTOP_COPY.fileClose}</button></div></> }{terminals.length === 0 ? <button type="button" onClick={() => { if (!workspaceDir || !createTerminal) return; void createTerminal({ workspaceDir }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button> : null}</div> : null}
  </aside>;
}
