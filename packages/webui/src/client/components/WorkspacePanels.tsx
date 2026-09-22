import { useEffect, useMemo, useState, type ReactElement } from "react";
import type {
  WebuiCanvasDocument,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
} from "../../server/port.js";

export type WebuiTodo = { readonly content: string; readonly status: "completed" | "in_progress" | "pending" };

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
  return <section className="webui-progress-panel" data-webui-progress-panel="true">
    <button type="button" className="webui-workspace-section-title" data-workspace-section-title="progress" onClick={onToggle} aria-expanded={!collapsed}>
      <span>进度</span><span className={collapsed ? "" : "-rotate-90 transition-transform duration-[180ms] ease-out"}>‹</span>
    </button>
    <div className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
      <div className="min-h-0 overflow-hidden">
        {todos.length === 0 ? <p className="webui-progress-empty">跟踪较长任务的进度</p> : todos.map((todo, index) => <div className={`webui-progress-row webui-progress-row--${todo.status}`} key={`${todo.content}-${index}`}>
          <span className="webui-progress-marker">{todo.status === "completed" ? "✓" : index + 1}</span>
          <span className={todo.status === "completed" ? "line-through text-text_default_tertiary" : ""}>{todo.content}</span>
        </div>)}
      </div>
    </div>
  </section>;
}

function FileTree({ files, onOpen }: { readonly files: readonly WebuiWorkspaceFile[]; readonly onOpen: (file: WebuiWorkspaceFile) => void }): ReactElement {
  return <div className="webui-file-tree">{files.map((file) => <div key={file.path}>
    <button type="button" className="webui-file-tree-row" onClick={() => onOpen(file)}>{file.kind === "directory" ? "▸" : "□"} {file.name}</button>
    {file.children?.length ? <div className="pl-3"><FileTree files={file.children} onOpen={onOpen} /></div> : null}
  </div>)}</div>;
}

export function WebuiWorkspacePanel({ sessionId, workspaceDir, listWorkspaceFileTree, readWorkspaceFile, readCanvas, applyCanvas, createTerminal, listTerminals, writeTerminal, disposeTerminal, todos = [] }: {
  readonly sessionId?: string; readonly workspaceDir?: string;
  readonly listWorkspaceFileTree?: (request: { workspaceDir: string; path?: string }) => Promise<readonly WebuiWorkspaceFile[]>;
  readonly readWorkspaceFile?: (request: { workspaceDir: string; path: string }) => Promise<WebuiWorkspaceFileContent>;
  readonly readCanvas?: (request: { sessionId: string }) => Promise<WebuiCanvasDocument>;
  readonly applyCanvas?: (request: { sessionId: string; operation: Record<string, unknown> }) => Promise<unknown>;
  readonly createTerminal?: (request: { workspaceDir: string }) => Promise<{ terminalId: string; status: string }>;
  readonly listTerminals?: () => Promise<readonly Record<string, unknown>[]>;
  readonly writeTerminal?: (request: { terminalId: string; data: string }) => Promise<unknown>;
  readonly disposeTerminal?: (request: { terminalId: string }) => Promise<unknown>;
  readonly todos?: readonly WebuiTodo[];
}): ReactElement {
  const [tab, setTab] = useState<"files" | "canvas" | "terminal">("files");
  const [files, setFiles] = useState<readonly WebuiWorkspaceFile[]>([]);
  const [file, setFile] = useState<{ path: string; content: WebuiWorkspaceFileContent }>();
  const [canvas, setCanvas] = useState<WebuiCanvasDocument>();
  const [zoom, setZoom] = useState(1);
  const [terminals, setTerminals] = useState<readonly Record<string, unknown>[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  useEffect(() => { if (workspaceDir && listWorkspaceFileTree) void listWorkspaceFileTree({ workspaceDir }).then(setFiles).catch(() => setFiles([])); }, [workspaceDir, listWorkspaceFileTree]);
  useEffect(() => { if (sessionId && readCanvas) void readCanvas({ sessionId }).then(setCanvas).catch(() => setCanvas(undefined)); }, [sessionId, readCanvas]);
  useEffect(() => { if (listTerminals) void listTerminals().then(setTerminals).catch(() => setTerminals([])); }, [listTerminals]);
  const tabs = useMemo(() => [{ id: "files" as const, label: "查看文件" }, { id: "canvas" as const, label: "画布" }, { id: "terminal" as const, label: "终端" }], []);
  return <aside className="webui-workspace-panel" data-testid="workspace-panel">
    <WebuiProgressPanel todos={todos} collapsed={progressCollapsed} onToggle={() => setProgressCollapsed((value) => !value)} />
    <div className="webui-workspace-tabs" role="tablist">{tabs.map((item) => <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-active" : ""} onClick={() => setTab(item.id)}>{item.label}</button>)}</div>
    {tab === "files" ? <div className="webui-workspace-content">
      <FileTree files={files} onOpen={(entry) => { if (workspaceDir && readWorkspaceFile && entry.kind !== "directory") void readWorkspaceFile({ workspaceDir, path: entry.path }).then((content) => setFile({ path: entry.path, content })); }} />
      {file ? <div className="webui-file-viewer"><div className="file-tab h-8 w-40 rounded-lg bg-bg_interaction_tertiary_selected"><span>□</span>{file.path}<button type="button" aria-label="关闭" onClick={() => setFile(undefined)}>×</button></div><pre>{file.content.error ?? file.content.content}</pre></div> : null}
    </div> : null}
    {tab === "canvas" ? <div className="webui-canvas-content" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.4, Math.min(2, value + (event.deltaY > 0 ? -.1 : .1)))); }}>
      {!canvas?.nodes.length ? <><strong>把文件放到画布上</strong><p>将文件添加到画布后，可以在这里查看和整理工作区素材。</p></> : <div className="webui-canvas-stage" style={{ transform: `scale(${zoom})` }}>{canvas.nodes.map((node) => <div className="webui-canvas-node" key={String(node.id)}>{String((node.file as Record<string, unknown> | undefined)?.fileName ?? node.id)}</div>)}</div>}
      <span className="webui-canvas-zoom">{Math.round(zoom * 100)}%</span>
    </div> : null}
    {tab === "terminal" ? <div className="webui-terminal-empty">{terminals.length === 0 ? <><strong>还没有终端</strong><p>可直接在右侧面板中启动当前工作区的 Shell。</p></> : terminals.map((terminal) => <div key={String(terminal.terminalId)} className="webui-terminal-instance"><pre>{String(terminal.output ?? "")}</pre><form onSubmit={(event) => { event.preventDefault(); if (writeTerminal) void writeTerminal({ terminalId: String(terminal.terminalId), data: `${terminalInput}\n` }).then(() => listTerminals?.().then(setTerminals)); setTerminalInput(""); }}><input value={terminalInput} onChange={(event) => setTerminalInput(event.target.value)} aria-label="终端输入" /><button type="submit">发送</button><button type="button" onClick={() => { if (disposeTerminal) void disposeTerminal({ terminalId: String(terminal.terminalId) }).then(() => listTerminals?.().then(setTerminals)); }}>关闭</button></form></div>)}<button type="button" onClick={() => { if (workspaceDir && createTerminal) void createTerminal({ workspaceDir }).then(() => listTerminals?.().then(setTerminals)); }}>新建终端</button></div> : null}
  </aside>;
}
