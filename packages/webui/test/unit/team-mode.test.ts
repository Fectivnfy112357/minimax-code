import { beforeEach, describe, expect, it } from "vitest";
import { readSessionOverlay, toggleSessionOverlay } from "../../src/client/components/LeftRail.js";

function createMemoryLocalStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear() { values.clear(); },
    getItem(key) { return values.get(key) ?? null; },
    key(index) { return [...values.keys()][index] ?? null; },
    removeItem(key) { values.delete(key); },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

beforeEach(() => {
  globalThis.localStorage = createMemoryLocalStorage();
});

function isTeamModeLocked(session: { readonly teamModeOff?: boolean; readonly childSessionCount: number }): boolean {
  return session.teamModeOff === false || session.childSessionCount > 0;
}

describe("team mode lock contract", () => {
  it("locks when team mode is explicitly off or child sessions exist", () => {
    expect(isTeamModeLocked({ teamModeOff: false, childSessionCount: 0 })).toBe(true);
    expect(isTeamModeLocked({ teamModeOff: true, childSessionCount: 1 })).toBe(true);
    expect(isTeamModeLocked({ teamModeOff: true, childSessionCount: 0 })).toBe(false);
  });

  it("uses isolated v1 localStorage overlays for session row state", () => {
    localStorage.clear();
    expect(toggleSessionOverlay("stars", "s1")).toEqual({ s1: true });
    expect(toggleSessionOverlay("pins", "s1")).toEqual({ s1: true });
    expect(toggleSessionOverlay("archives", "s1")).toEqual({ s1: true });
    expect(readSessionOverlay("stars")).toEqual({ s1: true });
    expect(toggleSessionOverlay("stars", "s1")).toEqual({});
  });
});
