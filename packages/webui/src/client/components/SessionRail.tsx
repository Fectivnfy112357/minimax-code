// SessionRail — the desktop-faithful rail listing projects + recent sessions,
// plus the helpers they share (`sessionLabel`,
// `groupWebuiSessionsByWorkspace`, `sortWebuiProjectSessionIds`,
// `WebuiProjectGroup`).
//
// W3 tier 3 lift: this cluster (2 components + 4 helpers) was moved
// verbatim out of `app.tsx`. The bodies are byte-identical to what used
// to live there; the lift is move-only. `app.tsx` keeps a thin re-export
// block so existing consumers (`webui-shell.test.ts`, importers via
// `app.tsx`) keep their current import path during the W3 wave.

import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent,
  type ReactElement,
} from "react";
import {
  WebuiIconContextArchive,
  WebuiIconContextCopy,
  WebuiIconContextFeedback,
  WebuiIconContextFork,
  WebuiIconContextPin,
  WebuiIconContextRename,
  WebuiIconContextTrash,
  WebuiIconFolder,
} from "../icons.js";
import { WebuiContextMenu, type WebuiContextMenuItem } from "./ContextMenu.js";
import { RailRow } from "./RailRow.js";
import type {
  WebuiClientSession,
  WebuiClientSessionPage,
  WebuiClientSessionTreePage,
  WebuiClientProject,
} from "../contracts.js";
import { teamModeCopy, type TeamModeSessionChoices } from "../team-mode.js";

export interface WebuiProjectGroup {
  readonly key: string;
  readonly name: string;
  readonly workspaceDir?: string;
  readonly latestSessionId: string;
  readonly sessionIds: readonly string[];
  readonly updatedAt: number;
  readonly pinned?: boolean;
}

/**
 * The desktop's home rail is project-first, even though its source data is a
 * session history. Keep the grouping deterministic so paging and a refresh do
 * not reshuffle a project while the user is looking at it.
 */
export function groupWebuiSessionsByWorkspace(
  sessions: readonly WebuiClientSession[],
): WebuiProjectGroup[] {
  const ordered = [...sessions].sort(
    (left, right) => right.updatedAt - left.updatedAt,
  );
  const groups = new Map<string, WebuiProjectGroup>();
  for (const session of ordered) {
    const workspaceDir = session.workspaceDir?.trim() || undefined;
    const key = workspaceDir ?? "__webui_unassigned_project__";
    const current = groups.get(key);
    if (current) {
      groups.set(key, {
        ...current,
        sessionIds: [...current.sessionIds, session.sessionId],
      });
      continue;
    }
    groups.set(key, {
      key,
      name: workspaceProjectName(workspaceDir),
      ...(workspaceDir ? { workspaceDir } : {}),
      latestSessionId: session.sessionId,
      sessionIds: [session.sessionId],
      updatedAt: session.updatedAt,
    });
  }
  return [...groups.values()];
}

export function sortWebuiProjectSessionIds(
  sessions: readonly Pick<WebuiClientSession, "sessionId" | "updatedAt">[],
  pinnedSessions: Readonly<Record<string, boolean>>,
  sessionIds: readonly string[],
): string[] {
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  return [...sessionIds].sort((left, right) => {
    const pinDelta = Number(Boolean(pinnedSessions[right])) - Number(Boolean(pinnedSessions[left]));
    if (pinDelta) return pinDelta;
    return (byId.get(right)?.updatedAt ?? 0) - (byId.get(left)?.updatedAt ?? 0);
  });
}

export function sessionLabel(session: WebuiClientSession): string {
  return session.title?.trim() || session.agentName || session.sessionId;
}

export function workspaceProjectName(workspaceDir?: string): string {
  const value = workspaceDir?.trim();
  if (!value) return "未选项目";
  const normalized = value.replace(/[\\/]+$/u, "");
  const parts = normalized.split(/[\\/]/u).filter(Boolean);
  return parts.at(-1) || normalized;
}

export function sessionHash(sessionId: string): string {
  const params = new URLSearchParams();
  params.set("session", sessionId);
  return `#${params.toString()}`;
}

export function WebuiProjectList({
  page,
  treePage,
  projectRecords,
  loading,
  onLoadMore,
  selectedSessionId,
  onProjectSelect,
  error,
  pinnedSessions,
  pinnedProjects,
  projectNames,
  onRenameProject,
  onToggleProjectPin,
  onArchiveProject,
  onRenameSession,
  onToggleSessionPin,
  onArchiveSession,
  onForkSession,
  onCopySession,
  onDeleteSession,
}: {
  readonly page: WebuiClientSessionPage;
  readonly treePage?: WebuiClientSessionTreePage;
  readonly projectRecords?: readonly WebuiClientProject[];
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly onProjectSelect?: (workspaceDir?: string) => void;
  readonly error?: string;
  readonly pinnedSessions?: Readonly<Record<string, boolean>>;
  readonly pinnedProjects?: Readonly<Record<string, boolean>>;
  readonly projectNames?: Readonly<Record<string, string>>;
  readonly onRenameProject?: (project: WebuiProjectGroup) => void;
  readonly onToggleProjectPin?: (project: WebuiProjectGroup) => void;
  readonly onArchiveProject?: (project: WebuiProjectGroup) => void;
  readonly onRenameSession?: (session: WebuiClientSession) => void;
  readonly onToggleSessionPin?: (session: WebuiClientSession) => void;
  readonly onArchiveSession?: (session: WebuiClientSession) => void;
  readonly onForkSession?: (session: WebuiClientSession, createIsolatedWorktree: boolean) => void;
  readonly onCopySession?: (session: WebuiClientSession, value: "workspaceDir" | "sessionId") => void;
  readonly onDeleteSession?: (session: WebuiClientSession) => void;
}): ReactElement {
  // Build a lookup from parent session id to its child sessions. When
  // `treePage` is provided, this lets the rail render child sessions under
  // each root — mirroring the desktop sidebar's parent/child grouping.
  const childrenByParentId = useMemo(() => {
    const map = new Map<string, readonly WebuiClientSession[]>();
    if (!treePage) return map;
    for (const node of treePage.sessions) {
      if (node.childSessions.length > 0) {
        map.set(node.session.sessionId, node.childSessions);
      }
    }
    return map;
  }, [treePage]);
  const projects = useMemo(
    () => {
      const grouped = projectRecords
        ? (() => {
            const sessionsByWorkspace = new Map<string, WebuiClientSession[]>();
            for (const session of page.sessions) {
              const key = session.isDefaultWorkspace
                ? "__webui_unassigned_project__"
                : session.workspaceDir?.trim() || "__webui_unassigned_project__";
              const values = sessionsByWorkspace.get(key) ?? [];
              values.push(session);
              sessionsByWorkspace.set(key, values);
            }
            return projectRecords.filter((project) => !project.hidden).map((project) => {
              const key = project.workspaceDir ?? "__webui_unassigned_project__";
              const sessions = sessionsByWorkspace.get(key) ?? [];
              return {
                key,
                name: workspaceProjectName(project.workspaceDir ?? undefined),
                ...(project.workspaceDir ? { workspaceDir: project.workspaceDir } : {}),
                latestSessionId: sessions[0]?.sessionId ?? "",
                sessionIds: sessions.map(({ sessionId }) => sessionId),
                updatedAt: project.recentAtMs ?? project.latestActivityAtMs,
                pinned: project.pinned,
              };
            });
          })()
        : groupWebuiSessionsByWorkspace(page.sessions);
      return [...grouped].sort((left, right) => {
        const pinDelta = Number(Boolean(pinnedProjects?.[right.key] ?? right.pinned)) - Number(Boolean(pinnedProjects?.[left.key] ?? left.pinned));
        return pinDelta || right.updatedAt - left.updatedAt;
      });
    },
    [page.sessions, pinnedProjects, projectRecords],
  );
  const [expandedProjects, setExpandedProjects] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [contextMenu, setContextMenu] = useState<
    | { readonly x: number; readonly y: number; readonly items: readonly WebuiContextMenuItem[] }
    | undefined
  >();
  const sessionsById = useMemo(
    () => new Map(page.sessions.map((session) => [session.sessionId, session])),
    [page.sessions],
  );

  const openSessionMenu = (event: MouseEvent<HTMLElement>, session: WebuiClientSession) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
      items: [
        {
          kind: "item",
          key: "pin",
          label: pinnedSessions?.[session.sessionId] ? "取消置顶" : "置顶",
          icon: <WebuiIconContextPin />,
          disabled: !onToggleSessionPin,
          onSelect: () => onToggleSessionPin?.(session),
        },
        {
          kind: "item",
          key: "rename",
          label: "重命名",
          icon: <WebuiIconContextRename />,
          disabled: !onRenameSession,
          onSelect: () => onRenameSession?.(session),
        },
        {
          kind: "item",
          key: "archive",
          label: session.archived ? "取消归档" : "归档",
          icon: <WebuiIconContextArchive />,
          disabled: !onArchiveSession,
          onSelect: () => onArchiveSession?.(session),
        },
        { kind: "divider", key: "fork-divider" },
        {
          kind: "item",
          key: "fork-current",
          label: "复制为新会话",
          icon: <WebuiIconContextFork />,
          disabled: !onForkSession,
          onSelect: () => onForkSession?.(session, false),
        },
        {
          kind: "item",
          key: "fork-worktree",
          label: "复制到新工作树",
          icon: <WebuiIconContextFork />,
          disabled: !onForkSession,
          onSelect: () => onForkSession?.(session, true),
        },
        { kind: "divider", key: "copy-divider" },
        {
          kind: "item",
          key: "show-folder",
          label: "在文件夹中显示",
          icon: <WebuiIconFolder />,
          disabled: true,
        },
        {
          kind: "item",
          key: "copy",
          label: "复制",
          icon: <WebuiIconContextCopy />,
          submenu: [
            {
              kind: "item",
              key: "copy-workspace-dir",
              label: "复制工作目录",
              icon: <WebuiIconContextCopy />,
              disabled: !session.workspaceDir || !onCopySession,
              onSelect: () => onCopySession?.(session, "workspaceDir"),
            },
            {
              kind: "item",
              key: "copy-session-id",
              label: "复制会话 ID",
              icon: <WebuiIconContextCopy />,
              disabled: !onCopySession,
              onSelect: () => onCopySession?.(session, "sessionId"),
            },
          ],
        },
        {
          kind: "item",
          key: "feedback",
          label: "问题反馈",
          icon: <WebuiIconContextFeedback />,
          disabled: true,
        },
        { kind: "divider", key: "delete-divider" },
        {
          kind: "item",
          key: "delete",
          label: "删除",
          icon: <WebuiIconContextTrash />,
          danger: true,
          disabled: !onDeleteSession,
          onSelect: () => onDeleteSession?.(session),
        },
      ],
    });
  };

  useEffect(() => {
    if (!selectedSessionId) return;
    const activeProject = projects.find((project) =>
      project.sessionIds.includes(selectedSessionId),
    );
    if (!activeProject) return;
    setExpandedProjects((current) => {
      if (current.has(activeProject.key)) return current;
      return new Set(current).add(activeProject.key);
    });
  }, [projects, selectedSessionId]);

  return (
    <section data-webui-project-list="true">
      <div
        className="flex h-7 items-center px-2 text-sm font-normal leading-5 text-text_default_tertiary"
        data-webui-rail-section-header="true"
      >
        项目
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load projects: {error}
        </p>
      ) : null}
      {!error && projects.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          暂无项目
        </p>
      ) : (
        <ul className="space-y-px" data-webui-project-list-items="true">
          {projects.map((project) => {
            const expanded = expandedProjects.has(project.key);
            const projectName = projectNames?.[project.key] ?? project.name;
            const orderedSessionIds = sortWebuiProjectSessionIds(
              page.sessions,
              pinnedSessions ?? {},
              project.sessionIds,
            );
            return (
              <li key={project.key}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => {
                    onProjectSelect?.(project.workspaceDir);
                    setExpandedProjects((current) => {
                      const next = new Set(current);
                      if (next.has(project.key)) next.delete(project.key);
                      else next.add(project.key);
                      return next;
                    });
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!project.workspaceDir) return;
                    setContextMenu({
                      x: event.clientX,
                      y: event.clientY,
                      items: [
                        {
                          kind: "item",
                          key: "rename-project",
                          label: "重命名项目",
                          icon: <WebuiIconContextRename />,
                          disabled: !onRenameProject,
                          onSelect: () => onRenameProject?.(project),
                        },
                        {
                          kind: "item",
                          key: "toggle-pin-project",
                          label: pinnedProjects?.[project.key] ? "取消置顶项目" : "置顶项目",
                          icon: <WebuiIconContextPin />,
                          disabled: !onToggleProjectPin,
                          onSelect: () => onToggleProjectPin?.(project),
                        },
                        {
                          kind: "item",
                          key: "show-project-in-folder",
                          label: "在文件夹中显示",
                          icon: <WebuiIconFolder />,
                          disabled: true,
                        },
                        {
                          kind: "item",
                          key: "archive-project-sessions",
                          label: "归档对话",
                          icon: <WebuiIconContextArchive />,
                          disabled: !onArchiveProject,
                          onSelect: () => onArchiveProject?.(project),
                        },
                        {
                          kind: "item",
                          key: "remove-project",
                          label: "移除",
                          icon: <WebuiIconContextTrash />,
                          danger: true,
                          disabled: true,
                        },
                      ],
                    });
                  }}
                  data-webui-project-link={project.key}
                  title={project.workspaceDir}
                  className="webui-project-card text-left text-text_default_secondary"
                >
                  <WebuiIconFolder className="flex-shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-sm leading-5">
                    {projectName}
                  </span>
                </button>
                {expanded ? (
                  <ul
                    className="webui-project-session-list"
                    data-webui-project-sessions={project.key}
                  >
                    {orderedSessionIds.map((sessionId) => {
                      const session = sessionsById.get(sessionId);
                      if (!session) return null;
                      const children = childrenByParentId.get(session.sessionId) ?? [];
                      return (
                        <li key={session.sessionId}>
                          <a
                            href={sessionHash(session.sessionId)}
                            data-webui-session-link={session.sessionId}
                            data-webui-session-active={
                              session.sessionId === selectedSessionId
                                ? "true"
                                : "false"
                            }
                            onContextMenu={(event) => openSessionMenu(event, session)}
                            className="webui-project-session-card text-text_default_primary"
                          >
                            <span className="min-w-0 flex-1 truncate">
                              {sessionLabel(session)}
                            </span>
                          </a>
                          {children.length > 0 ? (
                            <ul
                              className="webui-project-child-session-list"
                              data-webui-project-child-sessions={session.sessionId}
                            >
                              {children.map((child) => (
                                <li key={child.sessionId}>
                                  <a
                                    href={sessionHash(child.sessionId)}
                                    data-webui-session-link={child.sessionId}
                                    data-webui-session-child-of={session.sessionId}
                                    data-webui-session-active={
                                      child.sessionId === selectedSessionId
                                        ? "true"
                                        : "false"
                                    }
                                    onContextMenu={(event) => openSessionMenu(event, child)}
                                    className="webui-project-child-session-card text-text_default_primary"
                                  >
                                    <span className="min-w-0 flex-1 truncate">
                                      {sessionLabel(child)}
                                    </span>
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
      {contextMenu ? (
        <WebuiContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(undefined)}
        />
      ) : null}
    </section>
  );
}

export function WebuiSessionList({
  page,
  loading,
  onLoadMore,
  selectedSessionId,
  error,
  teamModeChoices,
}: {
  readonly page: WebuiClientSessionPage;
  readonly loading: boolean;
  readonly onLoadMore?: () => void;
  readonly selectedSessionId?: string;
  readonly error?: string;
  readonly teamModeChoices?: TeamModeSessionChoices;
}): ReactElement {
  const sessions = useMemo(
    () =>
      [...page.sessions].sort(
        (left, right) => right.updatedAt - left.updatedAt,
      ),
    [page.sessions],
  );
  return (
    <div
      className="transition-colors group/project-list"
      data-webui-rail-sessions="true"
    >
      <div
        className="group/section flex h-[30px] items-center gap-1 pl-2 pr-0.5"
        data-webui-rail-section-header="true"
      >
        <span className="truncate text-sm font-normal leading-5 text-text_default_tertiary">
          最近任务
        </span>
        <span className="ml-auto flex-shrink-0 text-sm font-normal leading-5 text-text_default_tertiary">
          {sessions.length}
        </span>
      </div>
      {error ? (
        <p
          role="alert"
          className="px-1 pb-1 text-text_default_secondary text-size_12 leading-line_height_16"
        >
          Unable to load sessions: {error}
        </p>
      ) : null}
      {!error && sessions.length === 0 ? (
        <p className="webui-empty-state mx-1 text-text_default_secondary text-size_12 leading-line_height_16">
          No sessions yet.
        </p>
      ) : (
        <ul className="pt-px space-y-px" data-webui-session-list="true">
          {sessions.map((session) => (
            <li key={session.sessionId} data-webui-session-card="true">
              <a
                href={sessionHash(session.sessionId)}
                data-webui-session-link={session.sessionId}
                data-webui-session-active={
                  selectedSessionId === session.sessionId ? "true" : "false"
                }
                title={session.workspaceDir ?? undefined}
                className="webui-session-card text-text_default_primary"
              >
                <span className="flex h-[31px] w-[18px] flex-shrink-0 items-center justify-center">
                  <span className="block h-[31px] w-0 border-l-[0.5px] border-border_default" />
                </span>
                <span className="w-0 flex-1 truncate text-sm">
                  {sessionLabel(session)}
                </span>
                {teamModeChoices?.[session.sessionId] === false ||
                sessions.some(
                  (child) => child.parentSessionId === session.sessionId,
                ) ? (
                  <span
                    className="webui-pill flex-shrink-0 bg-bg_interaction_primary_default text-text_default_primary text-[11px]"
                    data-webui-team-badge="true"
                    title={teamModeCopy().label}
                  >
                    Agent Team
                  </span>
                ) : null}
              </a>
              {session.workspaceDir ? (
                <div
                  data-webui-workspace-dir={session.workspaceDir}
                  className="truncate pl-[28px] pr-1 text-xs leading-4 text-text_default_tertiary"
                >
                  {session.workspaceDir}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {page.hasMore && onLoadMore ? (
        <div className="px-1 pt-px">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loading}
            className="webui-rail-more text-text_default_secondary"
          >
            {loading ? "Loading…" : "Load more"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
