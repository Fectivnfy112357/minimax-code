export interface WebuiProjectionState {
  readonly permissions: readonly Record<string, unknown>[];
  readonly questionnaire?: Record<string, unknown>;
}

export const initialProjectionState: WebuiProjectionState = { permissions: [] };

export function projectPermissionEvent(
  state: WebuiProjectionState,
  event: { readonly type: string; readonly payload: Record<string, unknown> },
): WebuiProjectionState {
  const sessionId = readString(event.payload, "sessionId");
  if (event.type === "permission.ask") {
    return { ...state, permissions: [...state.permissions, { ...event.payload, ...(sessionId ? { sessionId } : {}) }] };
  }
  if (event.type === "permission.resolved") {
    const requestId = readString(event.payload, "requestId");
    return { ...state, permissions: state.permissions.filter((permission) => readString(permission, "requestId") !== requestId) };
  }
  if (event.type === "questionnaire.ask") return { ...state, questionnaire: event.payload };
  if (event.type === "questionnaire.dismiss" || event.type === "questionnaire.superseded") {
    return { ...state, questionnaire: undefined };
  }
  return state;
}

function readString(value: Record<string, unknown>, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] : undefined;
}

