/**
 * Client-side state for the create-time Agent Team choice.
 *
 * The protocol exposes only `teamModeOff` on create. The WebUI therefore
 * keeps the choice locally for the composer and for the session-list badge;
 * there is no later server signal to reconstruct it.
 */

export const TEAM_MODE_STORAGE_KEY = "mavis-team-mode";
const TEAM_MODE_SESSION_STORAGE_KEY = "mavis-team-mode:sessions:v1";

export interface TeamModeSession {
  readonly id: string;
  readonly teamModeOff?: boolean;
}

export type TeamModeChildSessionReader = (
  sessionId: string,
) => readonly unknown[];

export function isTeamModeLocked(
  session: TeamModeSession,
  getChildSessions: TeamModeChildSessionReader,
): boolean {
  return (
    session.teamModeOff === false || getChildSessions(session.id).length > 0
  );
}

function browserStorage(): Storage | undefined {
  return typeof localStorage === "undefined" ? undefined : localStorage;
}

function readBoolean(
  storage: Storage | undefined,
  key: string,
  fallback: boolean,
): boolean {
  const raw = storage?.getItem(key);
  if (raw === null || raw === undefined) return fallback;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === "boolean" ? value : fallback;
  } catch {
    return fallback;
  }
}

export function readTeamModeOff(
  storage: Storage | undefined = browserStorage(),
): boolean {
  return readBoolean(storage, TEAM_MODE_STORAGE_KEY, true);
}

export function writeTeamModeOff(
  teamModeOff: boolean,
  storage: Storage | undefined = browserStorage(),
): void {
  storage?.setItem(TEAM_MODE_STORAGE_KEY, JSON.stringify(teamModeOff));
}

export type TeamModeSessionChoices = Readonly<Record<string, boolean>>;

export function readTeamModeSessionChoices(
  storage: Storage | undefined = browserStorage(),
): TeamModeSessionChoices {
  const raw = storage?.getItem(TEAM_MODE_SESSION_STORAGE_KEY);
  if (raw === null || raw === undefined) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return {};
    const choices: Record<string, boolean> = {};
    for (const [sessionId, choice] of Object.entries(value)) {
      if (typeof choice === "boolean") choices[sessionId] = choice;
    }
    return choices;
  } catch {
    return {};
  }
}

export function writeTeamModeSessionChoice(
  sessionId: string,
  teamModeOff: boolean,
  storage: Storage | undefined = browserStorage(),
): void {
  const choices = {
    ...readTeamModeSessionChoices(storage),
    [sessionId]: teamModeOff,
  };
  storage?.setItem(TEAM_MODE_SESSION_STORAGE_KEY, JSON.stringify(choices));
}

export function teamModeCopy(locale?: string): {
  readonly label: string;
  readonly lockedTip: string;
} {
  const isChinese = (locale ?? "").toLowerCase().startsWith("zh");
  return isChinese
    ? { label: "Agent 团队", lockedTip: "本对话已锁定 Agent 团队" }
    : { label: "Agent Team", lockedTip: "Agent Team locked for this chat" };
}
