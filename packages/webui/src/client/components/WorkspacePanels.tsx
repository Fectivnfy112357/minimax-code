import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  WebuiCanvasDocument,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
} from "../../server/port.js";
import { WebuiIconCheck, WebuiIconChevronLeft, WebuiIconClose, WebuiIconFile } from "../icons.js";

export type WebuiTodo = { readonly content: string; readonly status: "completed" | "in_progress" | "pending" };
const DESKTOP_COPY = { progressEmpty: "跟踪较长任务的进度", newTerminal: "新建终端", terminalLimit: "最多可以打开 5 个终端", terminalLabel: "终端", terminalExited: "已退出", terminalEmptyTitle: "还没有终端", terminalEmptyDescription: "可直接在右侧面板中启动当前工作区的 Shell。", canvasEmptyTitle: "把文件放到画布上", canvasEmptyDescription: "将文件添加到画布后，可以在这里查看和整理工作区素材。", fileClose: "关闭" } as const;

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

export function WebuiProgressPanel({ todos, collapsed = false, onToggle }: { readonly todos: readonly WebuiTodo[]; readonly collapsed?: boolean; readonly onToggle?: () => void }): ReactElement {
  return <section className="webui-progress-panel" data-webui-progress-panel="true" data-workspace-section="progress">
    <button type="button" className="webui-workspace-section-title h-7 justify-between text-sm text-text_default_secondary" data-workspace-section-title="progress" onClick={onToggle} aria-expanded={!collapsed}>
      <span>进度</span><WebuiIconChevronLeft className={collapsed ? "size-4" : "size-4 -rotate-90 transition-transform duration-[180ms] ease-out"} />
    </button>
    <div className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
      <div className="min-h-0 overflow-hidden">
        {todos.length === 0 ? <p className="webui-progress-empty">{DESKTOP_COPY.progressEmpty}</p> : todos.map((todo, index) => <div className={`webui-progress-row webui-progress-row--${todo.status}`} key={`${todo.content}-${index}`}>
          <span className="webui-progress-marker">{todo.status === "completed" ? <WebuiIconCheck className="size-3" /> : index + 1}</span>
          <span className={todo.status === "completed" ? "line-through text-text_default_tertiary" : ""}>{todo.content}</span>
        </div>)}
      </div>
    </div>
  </section>;
}

function FileTree({ files, onOpen }: { readonly files: readonly WebuiWorkspaceFile[]; readonly onOpen: (file: WebuiWorkspaceFile) => void }): ReactElement {
  return <div className="webui-file-tree">{files.map((file) => <div key={file.path}>
    <button type="button" className="webui-file-tree-row" onClick={() => onOpen(file)}>{file.type === "directory" ? <WebuiIconChevronLeft className="inline size-3" /> : <WebuiIconFile className="inline size-3" />} {file.name}</button>
    {file.children?.length ? <div className="pl-3"><FileTree files={file.children} onOpen={onOpen} /></div> : null}
  </div>)}</div>;
}

export function WebuiWorkspacePanel({ sessionId, workspaceDir, listWorkspaceFileTree, readWorkspaceFile, readCanvas, applyCanvas, createTerminal, listTerminals, writeTerminal, disposeTerminal, watchTerminal, todos = [] }: {
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
}): ReactElement {
  const [tab, setTab] = useState<"files" | "canvas" | "terminal">("files");
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
  const [progressCollapsed, setProgressCollapsed] = useState(false);
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
    <WebuiProgressPanel todos={todos} collapsed={progressCollapsed} onToggle={() => setProgressCollapsed((value) => !value)} />
    <div className="webui-workspace-tabs" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "files" ? <div className="webui-workspace-content">
      <FileTree files={files} onOpen={(entry) => { if (workspaceDir && readWorkspaceFile && entry.type !== "directory") void readWorkspaceFile({ workspaceDir, path: entry.path }).then((content) => setFile({ path: entry.path, content })); }} />
      {file ? <div className="webui-file-viewer"><div className="file-tab group/tab-close h-8 w-40 min-w-20 rounded-lg bg-bg_interaction_tertiary_selected"><WebuiIconFile className="size-[14px]" />{file.path}<button type="button" aria-label="关闭" className="file-tab-close opacity-0 transition-opacity group-hover/tab-close:opacity-100" onClick={() => setFile(undefined)}><WebuiIconClose className="size-[14px]" /></button></div><pre>{file.content.error ?? file.content.content}</pre></div> : null}
    </div> : null}
    {tab === "canvas" ? <div className="webui-canvas-content" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.4, Math.min(2, value + (event.deltaY > 0 ? -.1 : .1)))); }}>
      {!canvas?.nodes.length ? <><strong>{DESKTOP_COPY.canvasEmptyTitle}</strong><p>{DESKTOP_COPY.canvasEmptyDescription}</p></> : <div className="webui-canvas-stage" style={{ transform: `scale(${zoom})` }}>{canvas.nodes.map((node) => <div className="webui-canvas-node" key={String(node.id)}>{String((node.file as Record<string, unknown> | undefined)?.fileName ?? node.id)}</div>)}</div>}
      <span className="webui-canvas-zoom">{Math.round(zoom * 100)}%</span>
    </div> : null}
    {tab === "terminal" ? <div className="webui-terminal-empty">{terminals.length === 0 ? <><strong>{DESKTOP_COPY.terminalEmptyTitle}</strong><p>{DESKTOP_COPY.terminalEmptyDescription}</p></> : <><div className="webui-terminal-tabs">{terminals.map((terminal, index) => <button type="button" key={String(terminal.terminalId)} className={`file-tab group/tab-close h-8 w-40 min-w-20 ${String(terminal.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId)) ? "bg-bg_interaction_tertiary_selected" : ""}`} onClick={() => setActiveTerminalId(String(terminal.terminalId))}><span>#{index + 1}</span>{terminal.status === "exited" ? DESKTOP_COPY.terminalExited : "终端"}<span className="file-tab-close opacity-0 group-hover/tab-close:opacity-100"><WebuiIconClose className="size-[14px]" /></span></button>)}</div><div ref={terminalHost} className="webui-xterm-host" />{terminalError ? <p role="alert">{terminalError}</p> : null}<div className="webui-terminal-actions"><button type="button" onClick={() => { if (!workspaceDir || !createTerminal) return; void createTerminal({ workspaceDir }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button><button type="button" onClick={() => { const active = terminals.find((candidate) => String(candidate.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId))); if (active && disposeTerminal) void disposeTerminal({ terminalId: String(active.terminalId) }).then(() => listTerminals?.().then(setTerminals)); }}>{DESKTOP_COPY.fileClose}</button></div></> }{terminals.length === 0 ? <button type="button" onClick={() => { if (!workspaceDir || !createTerminal) return; void createTerminal({ workspaceDir }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button> : null}</div> : null}
  </aside>;
}
