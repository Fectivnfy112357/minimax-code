import type { WebuiRuntimeEvent } from "../port.js";
import { isCompactionEvent, projectCompactionEvent } from "./compaction.js";
import { initialProjectionState, projectPermissionEvent, type WebuiProjectionState } from "./permissions.js";

export interface WebuiEventProjection extends WebuiProjectionState {
  readonly compaction?: ReturnType<typeof projectCompactionEvent>;
}

export function reduceEvents(
  state: WebuiEventProjection = { ...initialProjectionState },
  frame: WebuiRuntimeEvent,
): WebuiEventProjection {
  const permissions = projectPermissionEvent(state, frame);
  return {
    ...permissions,
    ...(isCompactionEvent(frame.type) ? { compaction: projectCompactionEvent(frame) } : {}),
  };
}

export async function* projectEventStream(
  source: AsyncIterable<WebuiRuntimeEvent>,
): AsyncIterable<WebuiRuntimeEvent> {
  let state: WebuiEventProjection = { ...initialProjectionState };
  for await (const frame of source) {
    state = reduceEvents(state, frame);
    yield { ...frame, payload: { ...frame.payload, webuiProjection: state } };
  }
}

export { projectContextSnapshot } from "./context-snapshot.js";
export { isCompactionEvent, projectCompactionEvent } from "./compaction.js";
export { isTurnCompactionMessage, projectUsage } from "./usage.js";
export { initialProjectionState, projectPermissionEvent } from "./permissions.js";

