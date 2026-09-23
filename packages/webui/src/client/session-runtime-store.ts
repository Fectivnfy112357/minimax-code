// Session runtime store — module-level Map of session → runtime state.
//
// This module was lifted out of `app.tsx` in W2.75. The body of every
// function is byte-identical to what used to live there; the lift is a
// move-only refactor. **Do not** re-shape the Map, the listener set, the
// guard order in `updateSessionRuntimeState`, the no-notify call inside
// `migrateSessionRuntimeState`, or the `sessionKeyRef` semantics inside
// `useSessionRuntimeState`. Each of those is load-bearing for the
// `WebuiClientFoundationApp` home → first-session flow (see the
// comments inline) and changing any of them is a behaviour change.
//
// `WebuiSessionRuntimeState`, `readSessionRuntimeState`,
// `updateSessionRuntimeState`, `migrateSessionRuntimeState`, and
// `useSessionRuntimeState` are imported by `app.tsx` and the
// Webui-transcript-widgets-integration test. The Map and the listener
// Set are the canonical path: there is exactly one instance, declared
// here, and every consumer reads / writes through the helpers above.

import { useEffect, useRef, useState } from "react";
import { initialWebuiStreamState } from "./stream.js";
import type { WebuiComposerSubmitHandlers } from "./projection/composer-state.js";
import type { WebuiStreamState } from "./stream.js";

interface WebuiSessionRuntimeState {
  readonly stream: WebuiStreamState;
  readonly sending: boolean;
}

export const HOME_SESSION_RUNTIME_KEY = "__webui-home__";

const sessionRuntimeStates = new Map<string, WebuiSessionRuntimeState>();
const sessionRuntimeListeners = new Map<
  string,
  Set<(state: WebuiSessionRuntimeState) => void>
>();

export function readSessionRuntimeState(
  sessionKey: string,
): WebuiSessionRuntimeState {
  return (
    sessionRuntimeStates.get(sessionKey) ?? {
      stream: initialWebuiStreamState,
      sending: false,
    }
  );
}

export function updateSessionRuntimeState(
  sessionKey: string,
  update: (current: WebuiSessionRuntimeState) => WebuiSessionRuntimeState,
): void {
  const next = update(readSessionRuntimeState(sessionKey));
  sessionRuntimeStates.set(sessionKey, next);
  for (const listener of sessionRuntimeListeners.get(sessionKey) ?? [])
    listener(next);
}

/**
 * Carry a session's live runtime state (stream + sending) to a new key and
 * clear the source. The first turn starts streaming before the session
 * exists — it writes to the home key — and `onSessionCreated` switches the
 * view mid-turn; migrating keeps the in-flight stream on screen and leaves
 * home clean so the next 新建任务 cannot replay the previous turn under the
 * welcome hero. Listeners are not notified on purpose: the only subscriber
 * is the view that is about to switch keys (its effect re-reads the target
 * key), and the target key has no subscriber yet.
 */
export function migrateSessionRuntimeState(
  fromKey: string,
  toKey: string,
): void {
  if (fromKey === toKey) return;
  const state = sessionRuntimeStates.get(fromKey);
  sessionRuntimeStates.delete(fromKey);
  if (state) sessionRuntimeStates.set(toKey, state);
}

export function useSessionRuntimeState(sessionId: string | undefined): {
  readonly state: WebuiSessionRuntimeState;
  readonly setStream: WebuiComposerSubmitHandlers["setStream"];
  readonly setSending: (sending: boolean) => void;
} {
  const sessionKey = sessionId ?? HOME_SESSION_RUNTIME_KEY;
  const [state, setState] = useState(() => readSessionRuntimeState(sessionKey));
  // Writes follow the key that is currently on screen: the submit path
  // captures these setters before the first-session switch, so the in-flight
  // stream and the finish-time `setSending(false)` must land on the key the
  // state was migrated to, not on the abandoned home key.
  const sessionKeyRef = useRef(sessionKey);
  useEffect(() => {
    sessionKeyRef.current = sessionKey;
    setState(readSessionRuntimeState(sessionKey));
    let listeners = sessionRuntimeListeners.get(sessionKey);
    if (!listeners) {
      listeners = new Set();
      sessionRuntimeListeners.set(sessionKey, listeners);
    }
    const listener = (next: WebuiSessionRuntimeState) => setState(next);
    listeners.add(listener);
    return () => {
      listeners?.delete(listener);
      if (listeners?.size === 0) sessionRuntimeListeners.delete(sessionKey);
    };
  }, [sessionKey]);
  return {
    state,
    setStream: (update) =>
      updateSessionRuntimeState(sessionKeyRef.current, (current) => ({
        ...current,
        stream: update(current.stream),
      })),
    setSending: (sending) =>
      updateSessionRuntimeState(sessionKeyRef.current, (current) => ({
        ...current,
        sending,
      })),
  };
}