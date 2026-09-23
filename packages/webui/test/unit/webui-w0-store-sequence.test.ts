// W0 safety net — the session runtime store's transition sequence.
//
// `sessionRuntimeStates` is a module-level Map plus a listener registry that
// currently lives inside `app.tsx` (L1878-1961). W2.75 moves it into its own
// module, and two documented contracts have to survive that move:
//
//   1. `migrateSessionRuntimeState` deliberately does NOT notify listeners
//      (`app.tsx:1907-1916`): the only subscriber is the view that is about to
//      switch keys, and the target key has no subscriber yet.
//   2. Writes follow the key that is currently on screen (`sessionKeyRef`,
//      `app.tsx:1934-1953`), not the key a setter was captured with.
//
// Contract 1 is NOT observable from this file: listeners are registered inside
// the `useSessionRuntimeState` hook, which needs a mounted React tree, and W0 is
// not allowed to change production code to expose a subscribe seam. It is
// recorded as an open W2.75 requirement rather than faked here.
//
// What this file pins is the observable half: read/update/migrate semantics,
// object identity across a migration, isolation between keys, and the two
// degenerate cases. The store is a module-level singleton shared by every test
// in this worker, so each case restores what it touched.

import { describe, it, expect, afterEach } from "vitest";
import {
  migrateSessionRuntimeState,
  readSessionRuntimeState,
  updateSessionRuntimeState,
} from "../../src/client/session-runtime-store.js";
import { initialWebuiStreamState } from "../../src/client/stream.js";

/** `HOME_SESSION_RUNTIME_KEY` is not exported; this is the literal at `app.tsx:1878`. */
const HOME_KEY = "__webui-home__";
const SESSION_KEY = "w0-session";

function initialState(): {
  readonly stream: typeof initialWebuiStreamState;
  readonly sending: boolean;
} {
  return { stream: initialWebuiStreamState, sending: false };
}

function resetStore(): void {
  migrateSessionRuntimeState(SESSION_KEY, HOME_KEY);
  updateSessionRuntimeState(HOME_KEY, () => initialState());
}

afterEach(resetStore);

describe("W0 · session runtime store transition sequence", () => {
  it("reads the initial state for a key that was never written", () => {
    expect(readSessionRuntimeState("w0-untouched")).toEqual(initialState());
  });

  it("writes the reducer result under the key it was given", () => {
    updateSessionRuntimeState(HOME_KEY, (current) => ({
      stream: { ...current.stream, phase: "streaming" },
      sending: true,
    }));

    expect(readSessionRuntimeState(HOME_KEY)).toEqual({
      stream: { ...initialWebuiStreamState, phase: "streaming" },
      sending: true,
    });
    // The other key must not have been touched by the write.
    expect(readSessionRuntimeState(SESSION_KEY)).toEqual(initialState());
  });

  it("migrates the live state to the session key and leaves home initial", () => {
    updateSessionRuntimeState(HOME_KEY, (current) => ({
      stream: { ...current.stream, phase: "streaming" },
      sending: true,
    }));

    migrateSessionRuntimeState(HOME_KEY, SESSION_KEY);

    expect(readSessionRuntimeState(HOME_KEY)).toEqual(initialState());
    expect(readSessionRuntimeState(SESSION_KEY)).toEqual({
      stream: { ...initialWebuiStreamState, phase: "streaming" },
      sending: true,
    });
  });

  it("keeps object identity across a migration", () => {
    // The in-flight turn has to stay on screen while the view switches keys, so
    // the migrated value must be the same object rather than a structural copy.
    updateSessionRuntimeState(HOME_KEY, (current) => ({
      ...current,
      sending: true,
    }));
    const before = readSessionRuntimeState(HOME_KEY);

    migrateSessionRuntimeState(HOME_KEY, SESSION_KEY);

    expect(readSessionRuntimeState(SESSION_KEY)).toBe(before);
  });

  it("does not create the target key when the source was never written", () => {
    migrateSessionRuntimeState("w0-missing", SESSION_KEY);

    expect(readSessionRuntimeState(SESSION_KEY)).toEqual(initialState());
  });

  it("is a no-op when both keys are the same", () => {
    updateSessionRuntimeState(SESSION_KEY, (current) => ({
      ...current,
      sending: true,
    }));
    const before = readSessionRuntimeState(SESSION_KEY);

    migrateSessionRuntimeState(SESSION_KEY, SESSION_KEY);

    expect(readSessionRuntimeState(SESSION_KEY)).toBe(before);
  });

  it("keeps two session keys isolated from each other", () => {
    updateSessionRuntimeState(SESSION_KEY, (current) => ({
      ...current,
      sending: true,
    }));

    expect(readSessionRuntimeState("w0-other-session")).toEqual(initialState());
  });
});
