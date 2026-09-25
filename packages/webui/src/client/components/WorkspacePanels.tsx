import { useEffect, useRef, useState, type ReactElement } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import toml from "highlight.js/lib/languages/ini";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import { WebuiMarkdown } from "../markdown.js";
import type {
  WebuiCanvasDocument,
  WebuiWorkspaceEnvironment,
  WebuiWorkspaceFile,
  WebuiWorkspaceFileContent,
  WebuiWorkspaceGitMutationRequest,
  WebuiWorkspaceReviewDiffs,
  WebuiWorkspaceReviewFileContent,
  WebuiWorkspaceReviewSearchResult,
  WebuiWorkspaceReviewSummary,
} from "../../server/port.js";
import type { WorkspacePanelCommand, WorkspacePanelState, WorkspacePanelTab } from "../projection/workspace-panel-state.js";
import { focusWebuiFileLine, webuiFileLineTargetId } from "../projection/file-line-navigation.js";
import type { WebuiClientEventWatcher } from "../contracts.js";
import {
  projectWebuiWorkspaceHistory,
  type WebuiWorkspaceSubagent,
  type WebuiWorkspaceTodo,
} from "../projection/workspace-progress.js";
import { WebuiIconCheck, WebuiIconChevronDown, WebuiIconChevronLeft, WebuiIconClose, WebuiIconFile, WebuiIconFolder, WebuiIconRunLocation, WebuiIconSearch, WebuiIconSidebarToggle, WebuiIconWorkspaceCanvas, WebuiIconWorkspaceExpand, WebuiIconWorkspaceReview, WebuiIconWorkspaceTerminal } from "../icons.js";

export type WebuiTodo = WebuiWorkspaceTodo;
const DESKTOP_COPY = { environment: "环境信息", progress: "进度", progressEmpty: "跟踪较长任务的进度", newTerminal: "新建终端", terminalLimit: "最多可以打开 5 个终端", terminalLabel: "终端", terminalExited: "已退出", terminalEmptyTitle: "还没有终端", terminalEmptyDescription: "可直接在右侧面板中启动当前工作区的 Shell。", canvasEmptyTitle: "把文件放到画布上", canvasEmptyDescription: "添加图片或其他工作区文件，然后自由排列和调整大小。", fileClose: "关闭", changes: "变更", commit: "提交或推送", openTerminal: "打开终端", unsupported: "WebUI 尚未接入此操作" } as const;

const FILE_CODE_LANGUAGES = {
  bash,
  c,
  cpp,
  css,
  go,
  java,
  javascript,
  json,
  markdown,
  python,
  rust,
  typescript,
  toml,
  xml,
  yaml,
} as const;
for (const [name, language] of Object.entries(FILE_CODE_LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}

const FILE_LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  c: "c", cjs: "javascript", cpp: "cpp", css: "css", go: "go", h: "c", htm: "xml", html: "xml", java: "java",
  js: "javascript", json: "json", jsx: "javascript", md: "markdown", mjs: "javascript", mts: "typescript",
  py: "python", rs: "rust", sh: "bash", svg: "xml", toml: "toml", ts: "typescript", tsx: "typescript", xml: "xml", yaml: "yaml", yml: "yaml",
};

export function webuiFileLanguage(path: string): string | undefined {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const language = extension ? FILE_LANGUAGE_BY_EXTENSION[extension] : undefined;
  return language && hljs.getLanguage(language) ? language : undefined;
}

function highlightFileLine(line: string, language: string | undefined): string | undefined {
  if (!language || !hljs.getLanguage(language)) return undefined;
  try {
    return hljs.highlight(line, { language, ignoreIllegals: true }).value;
  } catch {
    return undefined;
  }
}

function filterWorkspaceFiles(files: readonly WebuiWorkspaceFile[], query: string): WebuiWorkspaceFile[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [...files];
  return files.flatMap((file) => {
    const children = file.children ? filterWorkspaceFiles(file.children, normalizedQuery) : [];
    if (file.name.toLowerCase().includes(normalizedQuery) || children.length > 0) {
      return [{ ...file, ...(file.children ? { children } : {}) }];
    }
    return [];
  });
}

export function mergeWorkspaceFileChildren(
  files: readonly WebuiWorkspaceFile[],
  directoryPath: string,
  children: readonly WebuiWorkspaceFile[],
): readonly WebuiWorkspaceFile[] {
  return files.map((file) => {
    if (file.path === directoryPath && file.type === "directory") {
      return { ...file, children };
    }
    return file.children?.length
      ? { ...file, children: mergeWorkspaceFileChildren(file.children, directoryPath, children) }
      : file;
  });
}

export function projectWebuiTodos(messages: readonly Record<string, unknown>[]): WebuiTodo[] {
  return projectWebuiWorkspaceHistory(
    messages as never,
  ).todos as WebuiTodo[];
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
            <span className={`min-w-0 flex-1 truncate ${todo.status === "completed" ? "line-through text-text_default_tertiary" : ""}`}>{todo.content}</span>
          </div>)}
        </div>
      </div>
    </div>
  </div>;
}

export function WebuiSubagentsPanel({ subagents, collapsed = false, onToggle, onMemberClick }: {
  readonly subagents: readonly WebuiWorkspaceSubagent[];
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
  readonly onMemberClick?: (subagent: WebuiWorkspaceSubagent) => void;
}): ReactElement | null {
  if (subagents.length === 0) return null;
  return <div className="webui-subagents-panel" data-webui-subagents-panel="true" data-workspace-section="true">
    <button type="button" className="webui-workspace-section-title" onClick={onToggle} aria-expanded={!collapsed}>
      <span data-workspace-section-title="true">Subagents</span>
      <WebuiIconChevronDown className={collapsed ? "size-4 -rotate-90 text-icon_default_tertiary transition-transform duration-[180ms] ease-out" : "size-4 text-icon_default_tertiary transition-transform duration-[180ms] ease-out"} />
    </button>
    <div className={`grid transition-[grid-template-rows,opacity] duration-[180ms] ease-out ${collapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`} aria-hidden={collapsed}>
      <div className="min-h-0 overflow-hidden">
        {subagents.map((subagent) => {
          const label = subagent.title?.trim() || subagent.agentName;
          return <button type="button" className="webui-subagent-row" key={subagent.sessionId} onClick={() => onMemberClick?.(subagent)}>
            <span className="webui-subagent-avatar" aria-hidden="true">🤖</span>
            <span className="min-w-0 flex-1 truncate text-left">{label}</span>
            <span className={`webui-subagent-status webui-subagent-status--${subagent.status}`} aria-label={subagent.status}>
              {subagent.status === "completed" ? <WebuiIconCheck className="size-3" /> : subagent.status === "error" ? "!" : "·"}
            </span>
          </button>;
        })}
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

export function WebuiEnvironmentPanel({ workspaceDir, isDefaultWorkspace = false, workspaceEnvironment, getWorkspaceEnvironment, watchEvents, mutateWorkspaceGit, collapsed = false, onToggle, onOpenChanges, onOpenTerminal }: {
  readonly workspaceDir?: string;
  readonly isDefaultWorkspace?: boolean;
  readonly workspaceEnvironment?: WebuiWorkspaceEnvironment;
  readonly getWorkspaceEnvironment?: (request: { readonly workspaceDir: string }) => Promise<WebuiWorkspaceEnvironment>;
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly mutateWorkspaceGit?: (request: WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>;
  readonly collapsed?: boolean;
  readonly onToggle?: () => void;
  readonly onOpenChanges?: () => void;
  readonly onOpenTerminal?: () => void;
}): ReactElement | null {
  const [environment, setEnvironment] = useState<WebuiWorkspaceEnvironment | undefined>(workspaceEnvironment);
  const [commitOpen, setCommitOpen] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const environmentWorkspaceDir = useRef(workspaceDir);
  useEffect(() => {
    let cancelled = false;
    if (environmentWorkspaceDir.current !== workspaceDir) {
      environmentWorkspaceDir.current = workspaceDir;
      setEnvironment(undefined);
    }
    if (workspaceEnvironment) {
      setEnvironment(workspaceEnvironment);
      return () => { cancelled = true; };
    }
    if (!workspaceDir || isDefaultWorkspace || !getWorkspaceEnvironment) return () => { cancelled = true; };
    void getWorkspaceEnvironment({ workspaceDir }).then((next) => { if (!cancelled) setEnvironment(next); }).catch(() => { if (!cancelled) setEnvironment(undefined); });
    return () => { cancelled = true; };
  }, [getWorkspaceEnvironment, isDefaultWorkspace, reloadToken, workspaceDir, workspaceEnvironment]);
  useEffect(() => {
    if (!workspaceDir || isDefaultWorkspace || !getWorkspaceEnvironment || !watchEvents) return undefined;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = watchEvents((event) => {
      if (event.type !== "workspace.git.changed") return;
      const changedWorkspace = event.payload.workspace;
      const aliases = event.payload.aliases;
      if (changedWorkspace !== workspaceDir && !(Array.isArray(aliases) && aliases.includes(workspaceDir))) return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => setReloadToken((current) => current + 1), 350);
    });
    return () => {
      unsubscribe();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [getWorkspaceEnvironment, isDefaultWorkspace, watchEvents, workspaceDir]);
  if (!workspaceDir || isDefaultWorkspace || (!getWorkspaceEnvironment && !workspaceEnvironment) || !environment?.isGitRepo) return null;
  const hasChanges = environment.changedFiles > 0;
  const canMutate = Boolean(mutateWorkspaceGit && !environment.changesError && !environment.metadataError && (hasChanges || environment.canPush));
  const hasLineChanges = environment.lineStatsStatus === "ready" && (environment.insertions > 0 || environment.deletions > 0);
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
            <WebuiIconRunLocation className="size-5" /><span>{DESKTOP_COPY.changes}</span>{hasLineChanges ? <small aria-label={`新增 ${environment.insertions} 行，删除 ${environment.deletions} 行`}><span className="webui-diff-additions">+{environment.insertions}</span><span className="webui-diff-deletions">-{environment.deletions}</span></small> : null}
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

export function WebuiWorkspacePanelControls({ filePanelOpen, progressPanelOpen, onOpenFiles, onToggleProgressPanel }: { readonly filePanelOpen: boolean; readonly progressPanelOpen: boolean; readonly onOpenFiles: () => void; readonly onToggleProgressPanel: () => void }): ReactElement {
  return <div className="webui-workspace-panel-controls" data-testid="workspace-panel-controls">
    <button type="button" className={`webui-workspace-icon-button ${filePanelOpen ? "is-active" : ""}`} aria-label="工作区文件侧栏" title="工作区文件侧栏" aria-pressed={filePanelOpen} onClick={onOpenFiles}><WebuiIconFolder className="size-5" /></button>
    <button type="button" className={`webui-workspace-icon-button ${progressPanelOpen ? "is-active" : ""}`} aria-label="环境信息与进度" title="环境信息与进度" aria-pressed={progressPanelOpen} onClick={onToggleProgressPanel}><WebuiIconSidebarToggle className="size-5" /></button>
  </div>;
}

export function WebuiProgressOverviewPanel({ workspaceDir, isDefaultWorkspace = false, workspaceEnvironment, todos, subagents = [], showProgress = true, showEmptyProgress = true, getWorkspaceEnvironment, watchEvents, mutateWorkspaceGit, environmentCollapsed = false, progressCollapsed = false, subagentsCollapsed = false, onToggleEnvironment, onToggleProgress, onToggleSubagents, onMemberClick, onOpenChanges, onOpenTerminal }: { readonly workspaceDir?: string; readonly isDefaultWorkspace?: boolean; readonly workspaceEnvironment?: WebuiWorkspaceEnvironment; readonly todos: readonly WebuiTodo[]; readonly subagents?: readonly WebuiWorkspaceSubagent[]; readonly showProgress?: boolean; readonly showEmptyProgress?: boolean; readonly getWorkspaceEnvironment?: (request: { readonly workspaceDir: string }) => Promise<WebuiWorkspaceEnvironment>; readonly watchEvents?: WebuiClientEventWatcher; readonly mutateWorkspaceGit?: (request: WebuiWorkspaceGitMutationRequest) => Promise<Record<string, unknown>>; readonly environmentCollapsed?: boolean; readonly progressCollapsed?: boolean; readonly subagentsCollapsed?: boolean; readonly onToggleEnvironment?: () => void; readonly onToggleProgress?: () => void; readonly onToggleSubagents?: () => void; readonly onMemberClick?: (subagent: WebuiWorkspaceSubagent) => void; readonly onOpenChanges?: () => void; readonly onOpenTerminal?: () => void }): ReactElement {
  return <div className="webui-progress-overview-card" data-testid="progress-overview-card">
    <WebuiEnvironmentPanel workspaceDir={workspaceDir} isDefaultWorkspace={isDefaultWorkspace} workspaceEnvironment={workspaceEnvironment} getWorkspaceEnvironment={getWorkspaceEnvironment} watchEvents={watchEvents} mutateWorkspaceGit={mutateWorkspaceGit} collapsed={environmentCollapsed} onToggle={onToggleEnvironment} onOpenChanges={onOpenChanges} onOpenTerminal={onOpenTerminal} />
    <WebuiProgressPanel todos={todos} showProgress={showProgress} showEmptyProgress={showEmptyProgress} collapsed={progressCollapsed} onToggle={onToggleProgress} />
    <WebuiSubagentsPanel subagents={subagents} collapsed={subagentsCollapsed} onToggle={onToggleSubagents} onMemberClick={onMemberClick} />
  </div>;
}

function FileTree({ files, onOpen, expandedPaths, loadingPaths, directoryErrors, onToggle, selectedPath }: { readonly files: readonly WebuiWorkspaceFile[]; readonly onOpen: (file: WebuiWorkspaceFile) => void; readonly expandedPaths: ReadonlySet<string>; readonly loadingPaths: ReadonlySet<string>; readonly directoryErrors: Readonly<Record<string, string>>; readonly onToggle: (file: WebuiWorkspaceFile) => void; readonly selectedPath?: string }): ReactElement {
  return <div className="webui-file-tree">{files.map((file) => <div key={file.path}>
    <button type="button" className={`webui-file-tree-row ${file.path === selectedPath ? "is-selected" : ""}`} aria-current={file.path === selectedPath ? "true" : undefined} aria-expanded={file.type === "directory" ? expandedPaths.has(file.path) : undefined} aria-busy={file.type === "directory" && loadingPaths.has(file.path) ? "true" : undefined} onClick={() => file.type === "directory" ? onToggle(file) : onOpen(file)}>
      {file.type === "directory" ? <WebuiIconChevronLeft className={`inline size-3 ${expandedPaths.has(file.path) ? "rotate-90" : ""}`} /> : <WebuiIconFile className="inline size-3" />} {file.name}
    </button>
    {file.type === "directory" && expandedPaths.has(file.path) ? <div className="webui-file-tree-children">
      {loadingPaths.has(file.path) ? <p role="status">正在加载目录…</p>
        : directoryErrors[file.path] ? <p role="alert">{directoryErrors[file.path]}</p>
          : file.children?.length ? <FileTree files={file.children} onOpen={onOpen} expandedPaths={expandedPaths} loadingPaths={loadingPaths} directoryErrors={directoryErrors} onToggle={onToggle} selectedPath={selectedPath} />
            : <p>此文件夹为空。</p>}
    </div> : null}
  </div>)}</div>;
}

export function WebuiFilePreview({ tab, result, codeMode }: {
  readonly tab: Extract<WorkspacePanelTab, { readonly kind: "file-preview" }>;
  readonly result?: { readonly loading: boolean; readonly content?: WebuiWorkspaceFileContent; readonly error?: string };
  readonly codeMode: boolean;
}): ReactElement {
  const previewMarkdown = /\.md$/iu.test(tab.path) && !codeMode;
  const content = result?.content?.content ?? "";
  const language = webuiFileLanguage(tab.path);
  return <div className="webui-workspace-file-document" data-testid="workspace-file-preview" data-file-path={tab.path}>
      {result?.loading ? <p role="status">正在加载文件…</p>
        : result?.error ? <p role="alert">{result.error}</p>
          : result?.content?.type === "binary" ? <p>无法在文本预览中显示二进制文件。</p>
            : result?.content?.error ? <p role="alert">{result.content.error}</p>
              : result?.content ? previewMarkdown ? <WebuiMarkdown source={content} /> : <pre className="webui-file-code"><code className={language ? `hljs language-${language}` : ""}>{content.split("\n").map((line, index) => {
                const lineNumber = index + 1;
                const highlighted = highlightFileLine(line, language);
                return <span key={lineNumber} id={lineNumber === tab.lineStart ? webuiFileLineTargetId(tab.id, lineNumber) : undefined} tabIndex={lineNumber === tab.lineStart ? -1 : undefined} data-line={lineNumber} data-scroll-target-line={lineNumber === tab.lineStart ? "true" : undefined} className={`webui-file-code-line ${lineNumber >= (tab.lineStart ?? 0) && lineNumber <= (tab.lineEnd ?? tab.lineStart ?? 0) ? "webui-file-preview-line-active" : ""}`} data-line-number={lineNumber} {...(highlighted !== undefined ? { dangerouslySetInnerHTML: { __html: highlighted || " " } } : {})}>{highlighted === undefined ? line || " " : undefined}</span>;
              })}</code></pre>
                : <p>文件读取能力暂不可用。</p>}
  </div>;
}

export function WebuiWorkspacePanel({ state, dispatch, sessionId, workspaceDir, listWorkspaceFileTree, readWorkspaceFile, readCanvas, applyCanvas, createTerminal, listTerminals, writeTerminal, disposeTerminal, watchTerminal, watchEvents, getWorkspaceReviewSummary, listWorkspaceReviewFileDiffs, getWorkspaceReviewFileContent, searchWorkspaceReviewDiffs, onClose }: {
  readonly state: WorkspacePanelState;
  readonly dispatch: (command: WorkspacePanelCommand) => void;
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
  readonly watchEvents?: WebuiClientEventWatcher;
  readonly getWorkspaceReviewSummary?: (request: { readonly workspaceDir: string }) => Promise<WebuiWorkspaceReviewSummary>;
  readonly listWorkspaceReviewFileDiffs?: (request: { readonly workspaceDir: string; readonly reviewSnapshotId: string; readonly fileIds: readonly string[] }) => Promise<WebuiWorkspaceReviewDiffs>;
  readonly getWorkspaceReviewFileContent?: (request: { readonly workspaceDir: string; readonly reviewSnapshotId: string; readonly fileId: string; readonly side: "old" | "new" }) => Promise<WebuiWorkspaceReviewFileContent>;
  readonly searchWorkspaceReviewDiffs?: (request: { readonly workspaceDir: string; readonly reviewSnapshotId: string; readonly query: string; readonly includeUntrackedFiles: boolean; readonly pageIndex?: number; readonly pageSize?: number }) => Promise<WebuiWorkspaceReviewSearchResult>;
  readonly onClose?: () => void;
}): ReactElement {
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const tab = activeTab?.kind ?? "files";
  const [files, setFiles] = useState<readonly WebuiWorkspaceFile[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [fileTreeOpen, setFileTreeOpen] = useState(true);
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const [loadedDirectories, setLoadedDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(() => new Set());
  const [directoryErrors, setDirectoryErrors] = useState<Readonly<Record<string, string>>>({});
  const [fileCodeMode, setFileCodeMode] = useState(false);
  const [fileTreeState, setFileTreeState] = useState<{ readonly workspaceDir?: string; readonly loading: boolean; readonly error?: string }>({ loading: false });
  const [fileResults, setFileResults] = useState<Record<string, { loading: boolean; content?: WebuiWorkspaceFileContent; error?: string }>>({});
  const fileResultsRef = useRef(fileResults);
  fileResultsRef.current = fileResults;
  const [reviewSummary, setReviewSummary] = useState<{ readonly tabId: string; readonly summary?: WebuiWorkspaceReviewSummary; readonly error?: string; readonly loading: boolean; readonly stale?: boolean }>();
  const [reviewDiff, setReviewDiff] = useState<{ readonly tabId: string; readonly snapshotId: string; readonly path: string; readonly loading: boolean; readonly diff?: string; readonly error?: string }>();
  const [reviewContent, setReviewContent] = useState<{ readonly tabId: string; readonly snapshotId: string; readonly path: string; readonly loading: boolean; readonly old?: WebuiWorkspaceReviewFileContent; readonly current?: WebuiWorkspaceReviewFileContent; readonly error?: string }>();
  const [reviewSearchQuery, setReviewSearchQuery] = useState("");
  const [reviewSearch, setReviewSearch] = useState<{ readonly tabId: string; readonly snapshotId: string; readonly loading: boolean; readonly result?: WebuiWorkspaceReviewSearchResult; readonly error?: string }>();
  const [reviewRefreshToken, setReviewRefreshToken] = useState(0);
  const retriedSnapshots = useRef(new Set<string>());
  const currentPanelState = useRef(state);
  currentPanelState.current = state;
  const refreshStaleReview = (tabId: string, snapshotId: string) => {
    const retryKey = `${tabId}:${snapshotId}`;
    if (retriedSnapshots.current.has(retryKey)) return;
    retriedSnapshots.current.add(retryKey);
    setReviewRefreshToken((value) => value + 1);
  };
  const [canvas, setCanvas] = useState<WebuiCanvasDocument>();
  const [zoom, setZoom] = useState(1);
  const [terminals, setTerminals] = useState<readonly Record<string, unknown>[]>([]);
  const [activeTerminalId, setActiveTerminalId] = useState<string>();
  const [terminalError, setTerminalError] = useState<string>();
  const terminalHost = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal>();
  const terminalStop = useRef<(() => void) | undefined>();
  const activeWorkspace = activeTab && "workspaceDir" in activeTab ? activeTab.workspaceDir : workspaceDir;
  const activeWorkspaceRef = useRef(activeWorkspace);
  activeWorkspaceRef.current = activeWorkspace;
  const hasFileWorkspace = tab === "files" || activeTab?.kind === "file-preview";
  const visibleFiles = filterWorkspaceFiles(files, fileSearch);
  useEffect(() => {
    setFileSearch("");
    setExpandedDirectories(new Set());
    setLoadedDirectories(new Set());
    setLoadingDirectories(new Set());
    setDirectoryErrors({});
  }, [activeWorkspace]);
  useEffect(() => {
    setFileCodeMode(activeTab?.kind === "file-preview" && activeTab.lineStart !== undefined);
  }, [activeTab?.id]);
  useEffect(() => {
    if (!activeWorkspace || !listWorkspaceFileTree) { setFiles([]); setFileTreeState({ workspaceDir: activeWorkspace, loading: false, ...(!listWorkspaceFileTree ? { error: "文件浏览能力暂不可用。" } : {}) }); return undefined; }
    let cancelled = false;
    setFiles([]);
    setFileTreeState({ workspaceDir: activeWorkspace, loading: true });
    void listWorkspaceFileTree({ workspaceDir: activeWorkspace }).then((next) => { if (!cancelled) { setFiles(next); setFileTreeState({ workspaceDir: activeWorkspace, loading: false }); } }).catch((reason: unknown) => { if (!cancelled) { setFiles([]); setFileTreeState({ workspaceDir: activeWorkspace, loading: false, error: reason instanceof Error ? reason.message : String(reason) }); } });
    return () => { cancelled = true; };
  }, [activeWorkspace, listWorkspaceFileTree]);
  useEffect(() => {
    if (activeTab?.kind !== "file-preview" || !readWorkspaceFile) return undefined;
    if (fileResultsRef.current[activeTab.id]?.content) return undefined;
    let cancelled = false;
    setFileResults((current) => ({ ...current, [activeTab.id]: { loading: true } }));
    void readWorkspaceFile({ workspaceDir: activeTab.workspaceDir, path: activeTab.path }).then((content) => {
      if (!cancelled) setFileResults((current) => ({ ...current, [activeTab.id]: { loading: false, content } }));
    }).catch((reason: unknown) => {
      if (!cancelled) setFileResults((current) => ({ ...current, [activeTab.id]: { loading: false, error: reason instanceof Error ? reason.message : String(reason) } }));
    });
    return () => { cancelled = true; };
  }, [activeTab?.id, readWorkspaceFile]);
  useEffect(() => {
    if (activeTab?.kind !== "file-preview" || activeTab.lineStart === undefined || fileResults[activeTab.id]?.loading || !fileResults[activeTab.id]?.content || fileResults[activeTab.id]?.error) return;
    const target = document.getElementById(webuiFileLineTargetId(activeTab.id, activeTab.lineStart));
    if (target) focusWebuiFileLine(target);
  }, [activeTab?.id, activeTab?.kind === "file-preview" ? activeTab.lineStart : undefined, fileResults]);
  useEffect(() => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace") return undefined;
    if (!getWorkspaceReviewSummary) {
      setReviewSummary({ tabId: activeTab.id, loading: false, error: "工作区变更审查能力暂不可用。" });
      return undefined;
    }
    let cancelled = false;
    setReviewSummary((current) => ({ tabId: activeTab.id, summary: current?.tabId === activeTab.id ? current.summary : undefined, loading: true, stale: current?.tabId === activeTab.id && Boolean(current.summary) }));
    void getWorkspaceReviewSummary({ workspaceDir: activeTab.workspaceDir }).then((summary) => {
      if (cancelled) return;
      setReviewSummary({ tabId: activeTab.id, summary, loading: false });
      dispatch({ type: "set-review-snapshot", tabId: activeTab.id, reviewSnapshotId: summary.reviewSnapshotId });
    }).catch((reason: unknown) => { if (!cancelled) setReviewSummary((current) => ({ tabId: activeTab.id, summary: current?.tabId === activeTab.id ? current.summary : undefined, loading: false, stale: current?.tabId === activeTab.id && Boolean(current.summary), error: reason instanceof Error ? reason.message : String(reason) })); });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.workspaceDir : undefined, getWorkspaceReviewSummary, dispatch, reviewRefreshToken]);
  useEffect(() => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace" || !watchEvents) return undefined;
    return watchEvents((event) => {
      if (event.type !== "workspace.git.changed") return;
      const aliases = event.payload.aliases;
      if (event.payload.workspace === activeTab.workspaceDir || (Array.isArray(aliases) && aliases.includes(activeTab.workspaceDir))) setReviewRefreshToken((value) => value + 1);
    });
  }, [activeTab?.id, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.workspaceDir : undefined, watchEvents]);
  const workspaceReviewSelectedPath = activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.selectedPath : undefined;
  const workspaceReviewFiles = reviewSummary !== undefined && reviewSummary.tabId === activeTab?.id ? reviewSummary.summary?.files ?? [] : [];
  const turnReviewFiles = activeTab?.kind === "review" && activeTab.source === "turn" ? activeTab.files ?? [] : [];
  const selectedReviewPath = activeTab?.kind === "review" && activeTab.source === "workspace"
    ? workspaceReviewFiles.some((file) => file.path === workspaceReviewSelectedPath) ? workspaceReviewSelectedPath : workspaceReviewFiles[0]?.path
    : activeTab?.kind === "review" && activeTab.source === "turn" ? activeTab.selectedPath ?? turnReviewFiles[0]?.file : undefined;
  const selectedReviewFile = activeTab?.kind === "review" && activeTab.source === "workspace" ? workspaceReviewFiles.find((file) => file.path === selectedReviewPath) : undefined;
  useEffect(() => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace" || !selectedReviewPath || selectedReviewPath === activeTab.selectedPath) return;
    dispatch({ type: "select-review-file", tabId: activeTab.id, path: selectedReviewPath });
  }, [activeTab?.id, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.selectedPath : undefined, selectedReviewPath, dispatch]);
  useEffect(() => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace" || !selectedReviewFile || !activeTab.reviewSnapshotId) return undefined;
    if (!listWorkspaceReviewFileDiffs) {
      setReviewDiff({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId, path: selectedReviewFile.path, loading: false, error: "工作区文件差异能力暂不可用。" });
      return undefined;
    }
    let cancelled = false;
    setReviewDiff({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: true });
    void listWorkspaceReviewFileDiffs({ workspaceDir: activeTab.workspaceDir, reviewSnapshotId: activeTab.reviewSnapshotId, fileIds: [selectedReviewFile.fileId] }).then((result) => {
      if (cancelled) return;
      if (result.reviewSnapshotId !== activeTab.reviewSnapshotId) {
        setReviewDiff({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: false, error: "工作区变更已更新，正在刷新审查…" });
        refreshStaleReview(activeTab.id, activeTab.reviewSnapshotId!);
        return;
      }
      const fileDiff = result.diffs.find((item) => item.fileId === selectedReviewFile.fileId);
      setReviewDiff({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: false, diff: fileDiff?.diff?.diff ?? fileDiff?.diff?.content, error: fileDiff?.error ?? fileDiff?.errorCode });
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setReviewDiff({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        refreshStaleReview(activeTab.id, activeTab.reviewSnapshotId!);
      }
    });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.reviewSnapshotId : undefined, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.workspaceDir : undefined, selectedReviewFile?.fileId, selectedReviewPath, listWorkspaceReviewFileDiffs]);
  useEffect(() => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace" || !selectedReviewFile || !activeTab.reviewSnapshotId) return undefined;
    if (!getWorkspaceReviewFileContent) {
      setReviewContent({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId, path: selectedReviewFile.path, loading: false, error: "工作区文件内容能力暂不可用。" });
      return undefined;
    }
    let cancelled = false;
    setReviewContent({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId, path: selectedReviewFile.path, loading: true });
    const readSide = (side: "old" | "new") => getWorkspaceReviewFileContent({ workspaceDir: activeTab.workspaceDir, reviewSnapshotId: activeTab.reviewSnapshotId!, fileId: selectedReviewFile.fileId, side });
    void Promise.all([readSide("old"), readSide("new")]).then(([old, current]) => {
      if (cancelled) return;
      setReviewContent({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: false, old, current });
    }).catch((reason: unknown) => {
      if (!cancelled) {
        setReviewContent({ tabId: activeTab.id, snapshotId: activeTab.reviewSnapshotId!, path: selectedReviewFile.path, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
        refreshStaleReview(activeTab.id, activeTab.reviewSnapshotId!);
      }
    });
    return () => { cancelled = true; };
  }, [activeTab?.id, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.reviewSnapshotId : undefined, activeTab?.kind === "review" && activeTab.source === "workspace" ? activeTab.workspaceDir : undefined, selectedReviewFile?.fileId, selectedReviewPath, getWorkspaceReviewFileContent]);
  const runReviewSearch = () => {
    if (activeTab?.kind !== "review" || activeTab.source !== "workspace" || !activeTab.reviewSnapshotId || !searchWorkspaceReviewDiffs) return;
    const tabId = activeTab.id;
    const snapshotId = activeTab.reviewSnapshotId;
    setReviewSearch({ tabId, snapshotId, loading: true });
    void searchWorkspaceReviewDiffs({ workspaceDir: activeTab.workspaceDir, reviewSnapshotId: snapshotId, query: reviewSearchQuery, includeUntrackedFiles: true }).then((result) => {
      if (result.reviewSnapshotId !== snapshotId) {
        setReviewSearch({ tabId, snapshotId, loading: false, error: "工作区变更已更新，正在刷新审查…" });
        refreshStaleReview(tabId, snapshotId);
        return;
      }
      const currentTab = currentPanelState.current.tabs.find((tab) => tab.id === tabId);
      if (currentTab?.kind !== "review" || currentTab.source !== "workspace" || currentTab.reviewSnapshotId !== snapshotId) return;
      setReviewSearch({ tabId, snapshotId, loading: false, result });
    }).catch((reason: unknown) => {
      setReviewSearch({ tabId, snapshotId, loading: false, error: reason instanceof Error ? reason.message : String(reason) });
      refreshStaleReview(tabId, snapshotId);
    });
  };
  const toggleWorkspaceDirectory = (directory: WebuiWorkspaceFile) => {
    const path = directory.path;
    if (expandedDirectories.has(path)) {
      setExpandedDirectories((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
      return;
    }
    setExpandedDirectories((current) => new Set(current).add(path));
    if (directory.children !== undefined || loadedDirectories.has(path) || loadingDirectories.has(path)) return;
    if (!activeWorkspace || !listWorkspaceFileTree) {
      setDirectoryErrors((current) => ({ ...current, [path]: "文件夹读取能力暂不可用。" }));
      return;
    }
    const requestWorkspace = activeWorkspace;
    setDirectoryErrors((current) => {
      const next = { ...current };
      delete next[path];
      return next;
    });
    setLoadingDirectories((current) => new Set(current).add(path));
    void listWorkspaceFileTree({ workspaceDir: requestWorkspace, path }).then((children) => {
      if (activeWorkspaceRef.current !== requestWorkspace) return;
      setFiles((current) => mergeWorkspaceFileChildren(current, path, children));
      setLoadedDirectories((current) => new Set(current).add(path));
    }).catch((reason: unknown) => {
      if (activeWorkspaceRef.current !== requestWorkspace) return;
      setDirectoryErrors((current) => ({ ...current, [path]: reason instanceof Error ? reason.message : String(reason) }));
    }).finally(() => {
      if (activeWorkspaceRef.current !== requestWorkspace) return;
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    });
  };
  const activeSessionId = activeTab && "sessionId" in activeTab ? activeTab.sessionId : sessionId;
  useEffect(() => {
    if (!activeSessionId || !readCanvas) { setCanvas(undefined); return undefined; }
    let cancelled = false;
    void readCanvas({ sessionId: activeSessionId }).then((next) => { if (!cancelled) setCanvas(next); }).catch(() => { if (!cancelled) setCanvas(undefined); });
    return () => { cancelled = true; };
  }, [activeSessionId, activeTab?.id, readCanvas]);
  useEffect(() => {
    if (!listTerminals) return undefined;
    let cancelled = false;
    void listTerminals().then((next) => { if (!cancelled) setTerminals(next); }).catch(() => { if (!cancelled) setTerminals([]); });
    return () => { cancelled = true; };
  }, [listTerminals, activeTab?.id, activeWorkspace]);
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
  const tabLabel = (item: WorkspacePanelTab): string => item.kind === "file-preview" ? item.path.split("/").at(-1) ?? item.path : item.kind === "review" && item.source === "turn" ? "Review" : ({ files: "查看文件", review: "变更", canvas: "画布", terminal: "终端" } as const)[item.kind];
  return <aside className={`webui-workspace-panel ${state.expanded ? "is-expanded" : ""}`} data-testid="workspace-panel" data-active-tab={tab}>
    <div className="webui-workspace-panel-header">
      <div className="webui-workspace-tabs" role="tablist" aria-label="工作区面板标签">
        <div className="webui-workspace-tab-list">
          {state.tabs.map((item) => <div key={item.id} className={`webui-workspace-tab ${state.activeTabId === item.id ? "is-active" : ""}`} role="presentation">
            <button type="button" role="tab" aria-selected={state.activeTabId === item.id} onClick={() => dispatch({ type: "select-tab", tabId: item.id })}>{tabLabel(item)}</button>
            <button type="button" aria-label={`${tabLabel(item)} ${DESKTOP_COPY.fileClose}`} onClick={() => dispatch({ type: "close-tab", tabId: item.id })}><WebuiIconClose className="size-3" /></button>
          </div>)}
        </div>
        <div className="webui-workspace-add-anchor">
          <button type="button" className="webui-workspace-add-trigger" aria-label="添加标签" aria-haspopup="menu" aria-expanded={state.addMenuOpen} onClick={() => dispatch({ type: "toggle-add-menu" })}>+</button>
          {state.addMenuOpen ? <div className="webui-workspace-add-menu" role="menu" aria-label="添加工作区标签">
            {sessionId && workspaceDir ? <button type="button" role="menuitem" onClick={() => dispatch({ type: "open-workspace-review", sessionId, workspaceDir })}><WebuiIconWorkspaceReview className="size-[18px] shrink-0" /><span>审查</span></button> : null}
            <button type="button" role="menuitem" onClick={() => dispatch({ type: "open-tab", kind: "terminal", sessionId, workspaceDir })}><WebuiIconWorkspaceTerminal className="size-[18px] shrink-0" /><span>终端</span></button>
            <button type="button" role="menuitem" onClick={() => dispatch({ type: "open-tab", kind: "canvas", sessionId, workspaceDir })}><WebuiIconWorkspaceCanvas className="size-[18px] shrink-0" /><span>画布</span></button>
            <button type="button" role="menuitem" onClick={() => dispatch({ type: "open-tab", kind: "files", sessionId, workspaceDir })}><WebuiIconFile className="size-[18px] shrink-0" /><span>查看文件</span></button>
          </div> : null}
        </div>
      </div>
      <div className="webui-workspace-panel-actions">
        <button type="button" aria-label={state.expanded ? "收起面板" : "展开面板"} aria-pressed={state.expanded} onClick={() => dispatch({ type: "toggle-expanded" })}><WebuiIconWorkspaceExpand className="size-[18px]" /></button>
        <button type="button" className="webui-workspace-panel-close" aria-label="关闭面板" onClick={onClose}><WebuiIconClose className="size-[18px]" /></button>
      </div>
    </div>
    {hasFileWorkspace ? <div className="webui-workspace-file-toolbar">
      <div className="webui-workspace-file-breadcrumb" aria-label="文件路径">
        {activeTab?.kind === "file-preview" ? activeTab.path.split("/").map((part, index) => <span key={`${part}-${index}`} className={index === activeTab.path.split("/").length - 1 ? "is-current" : ""}>{index ? <span aria-hidden="true">›</span> : null}{part}</span>) : <span className="is-current">{workspaceDir?.split(/[\\/]/u).filter(Boolean).at(-1) ?? "工作区"}</span>}
      </div>
      {activeTab?.kind === "file-preview" && /\.md$/iu.test(activeTab.path) ? <div className="webui-workspace-file-mode" role="group" aria-label="文件显示模式">
        <button type="button" aria-pressed={!fileCodeMode} onClick={() => setFileCodeMode(false)}>预览</button>
        <button type="button" aria-pressed={fileCodeMode} onClick={() => setFileCodeMode(true)}>代码</button>
      </div> : null}
      <button type="button" className="webui-workspace-tree-toggle" aria-label={fileTreeOpen ? "隐藏文件树" : "显示文件树"} aria-pressed={fileTreeOpen} onClick={() => setFileTreeOpen((open) => !open)}><WebuiIconSidebarToggle className="size-5" /></button>
    </div> : null}
    <div className="webui-workspace-panel-body">
      <div className="webui-workspace-view">
    {tab === "files" ? <div className="webui-workspace-files-empty" data-testid="workspace-files-empty"><WebuiIconFolder className="size-8" /><strong>查看文件</strong><p>从工作区目录树中选择文件</p></div> : null}
    {tab === "file-preview" && activeTab?.kind === "file-preview" ? <WebuiFilePreview tab={activeTab} result={fileResults[activeTab.id]} codeMode={fileCodeMode} /> : null}
    {tab === "review" && activeTab?.kind === "review" && activeTab.source === "workspace" ? <div className="webui-workspace-content" data-testid="workspace-review"><h3>变更审查</h3>{reviewSummary?.tabId !== activeTab.id || reviewSummary.loading && !reviewSummary.summary ? <p role="status">正在收集变更…</p> : reviewSummary.error && !reviewSummary.summary ? <p role="alert">{reviewSummary.error}</p> : reviewSummary.summary?.files.length ? <><form onSubmit={(event) => { event.preventDefault(); runReviewSearch(); }}><input aria-label="搜索变更" value={reviewSearchQuery} onChange={(event) => setReviewSearchQuery(event.currentTarget.value)} /><button type="submit" disabled={!searchWorkspaceReviewDiffs || reviewSearch?.loading}>搜索</button></form>{reviewSummary.stale || reviewSummary.error ? <p role="status">变更列表可能已过期{reviewSummary.error ? `：${reviewSummary.error}` : "，正在刷新…"}</p> : null}{reviewSearch?.tabId === activeTab.id && reviewSearch.snapshotId === activeTab.reviewSnapshotId ? reviewSearch.loading ? <p role="status">正在搜索变更…</p> : reviewSearch.error ? <p role="alert">{reviewSearch.error}</p> : reviewSearch.result ? <ul data-testid="workspace-review-search-results">{reviewSearch.result.matchedFiles.map((match) => <li key={match.fileId}><button type="button" onClick={() => dispatch({ type: "select-review-file", tabId: activeTab.id, path: match.path })}>{match.path} <small>{match.matchCount}</small></button></li>)}</ul> : null : null}<ul>{reviewSummary.summary.files.map((file) => <li key={file.fileId}><button type="button" aria-current={selectedReviewPath === file.path ? "true" : undefined} onClick={() => dispatch({ type: "select-review-file", tabId: activeTab.id, path: file.path })}>{file.path} <small>+{file.additions} −{file.deletions}</small></button></li>)}</ul><section>{reviewDiff?.tabId !== activeTab.id || reviewDiff.snapshotId !== activeTab.reviewSnapshotId || reviewDiff.path !== selectedReviewPath || reviewDiff.loading ? <p role="status">正在加载差异…</p> : reviewDiff.error ? <p role="alert">{reviewDiff.error}</p> : reviewDiff.diff ? <pre>{reviewDiff.diff}</pre> : <p>此文件没有可预览的文本差异。</p>}{reviewContent?.tabId !== activeTab.id || reviewContent.snapshotId !== activeTab.reviewSnapshotId || reviewContent.path !== selectedReviewPath || reviewContent.loading ? <p role="status">正在加载文件内容…</p> : reviewContent.error ? <p role="alert">{reviewContent.error}</p> : <div data-testid="workspace-review-file-content"><section><h4>变更前</h4>{reviewContent.old?.type === "binary" ? <p>二进制文件</p> : <pre>{reviewContent.old?.content ?? ""}</pre>}</section><section><h4>变更后</h4>{reviewContent.current?.type === "binary" ? <p>二进制文件</p> : <pre>{reviewContent.current?.content ?? ""}</pre>}</section></div>}</section></> : !reviewSummary.summary?.files.length && !reviewSummary.loading ? <p>当前没有变更。</p> : null}</div> : null}
    {tab === "review" && activeTab?.kind === "review" && activeTab.source === "turn" ? <div className="webui-workspace-content" data-testid="turn-review-panel" data-session-id={activeTab.sessionId} data-message-id={activeTab.messageId} data-turn-id={activeTab.turnId} data-change-set-id={activeTab.changeSetId}><h3>本轮改动</h3>{turnReviewFiles.length ? <><ul>{turnReviewFiles.map((file) => <li key={file.file}><button type="button" aria-current={selectedReviewPath === file.file ? "true" : undefined} onClick={() => dispatch({ type: "select-review-file", tabId: activeTab.id, path: file.file })}>{file.file}</button></li>)}</ul>{turnReviewFiles.find((file) => file.file === selectedReviewPath)?.diff ? <pre>{turnReviewFiles.find((file) => file.file === selectedReviewPath)?.diff}</pre> : <p>当前运行时没有提供该文件的 patch 预览。</p>}</> : <p>本轮没有可审查的文件差异。</p>}</div> : null}
    {tab === "canvas" ? <div className="webui-canvas-content" onWheel={(event) => { event.preventDefault(); setZoom((value) => Math.max(.4, Math.min(2, value + (event.deltaY > 0 ? -.1 : .1)))); }}>
      {!canvas?.nodes.length ? <><strong>{DESKTOP_COPY.canvasEmptyTitle}</strong><p>{DESKTOP_COPY.canvasEmptyDescription}</p></> : <div className="webui-canvas-stage" style={{ transform: `scale(${zoom})` }}>{canvas.nodes.map((node) => <div className="webui-canvas-node" key={String(node.id)}>{String((node.file as Record<string, unknown> | undefined)?.fileName ?? node.id)}</div>)}</div>}
      <span className="webui-canvas-zoom">{Math.round(zoom * 100)}%</span>
    </div> : null}
    {tab === "terminal" ? <div className="webui-terminal-empty">{terminals.length === 0 ? <><strong>{DESKTOP_COPY.terminalEmptyTitle}</strong><p>{DESKTOP_COPY.terminalEmptyDescription}</p></> : <><div className="webui-terminal-tabs">{terminals.map((terminal, index) => <button type="button" key={String(terminal.terminalId)} className={`file-tab group/tab-close h-8 w-40 min-w-20 ${String(terminal.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId)) ? "bg-bg_interaction_tertiary_selected" : ""}`} onClick={() => setActiveTerminalId(String(terminal.terminalId))}><span>#{index + 1}</span>{terminal.status === "exited" ? DESKTOP_COPY.terminalExited : DESKTOP_COPY.terminalLabel}<span className="file-tab-close opacity-0 group-hover/tab-close:opacity-100"><WebuiIconClose className="size-[14px]" /></span></button>)}</div><div ref={terminalHost} className="webui-xterm-host" />{terminalError ? <p role="alert">{terminalError}</p> : null}<div className="webui-terminal-actions"><button type="button" onClick={() => { if (!activeWorkspace || !createTerminal) return; void createTerminal({ workspaceDir: activeWorkspace }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button><button type="button" onClick={() => { const active = terminals.find((candidate) => String(candidate.terminalId) === (activeTerminalId ?? String(terminals[0]?.terminalId))); if (active && disposeTerminal) void disposeTerminal({ terminalId: String(active.terminalId) }).then(() => listTerminals?.().then(setTerminals)); }}>{DESKTOP_COPY.fileClose}</button></div></> }{terminals.length === 0 ? <button type="button" onClick={() => { if (!activeWorkspace || !createTerminal) return; void createTerminal({ workspaceDir: activeWorkspace }).then((created) => { setActiveTerminalId(created.terminalId); return listTerminals?.().then(setTerminals); }).catch((error: unknown) => setTerminalError(error instanceof Error ? error.message : String(error))); }}>{DESKTOP_COPY.newTerminal}</button> : null}</div> : null}
      </div>
      {hasFileWorkspace && fileTreeOpen ? <aside className="webui-workspace-file-tree-panel" aria-label="工作区文件树">
        <label className="webui-workspace-file-search"><WebuiIconSearch className="size-4" /><input aria-label="搜索文件" placeholder="搜索" value={fileSearch} onChange={(event) => setFileSearch(event.currentTarget.value)} /></label>
        <div className="webui-workspace-file-tree-scroll">
          {fileTreeState.workspaceDir !== activeWorkspace || fileTreeState.loading ? <p role="status">正在加载文件…</p> : fileTreeState.error ? <p role="alert">{fileTreeState.error}</p> : files.length ? visibleFiles.length ? <FileTree files={visibleFiles} expandedPaths={expandedDirectories} loadingPaths={loadingDirectories} directoryErrors={directoryErrors} onToggle={toggleWorkspaceDirectory} selectedPath={activeTab?.kind === "file-preview" ? activeTab.path : undefined} onOpen={(entry) => { const context = activeTab && "sessionId" in activeTab ? activeTab.sessionId : sessionId; if (activeWorkspace && context && entry.type !== "directory") dispatch({ type: "open-file", sessionId: context, workspaceDir: activeWorkspace, path: entry.path }); }} /> : <p className="webui-workspace-tree-empty">没有匹配的文件。</p> : <p className="webui-workspace-tree-empty">此工作区没有可显示的文件。</p>}
        </div>
      </aside> : null}
    </div>
  </aside>;
}
