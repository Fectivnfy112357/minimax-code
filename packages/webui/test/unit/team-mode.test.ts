import { beforeEach, describe, expect, it } from "vitest";
import { readSessionOverlay, toggleSessionOverlay } from "../../src/client/components/LeftRail.js";
import {
  isTeamModeLocked,
  readTeamModeOff,
  writeTeamModeOff,
} from "../../src/client/team-mode.js";

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

describe("team mode lock contract", () => {
  it("locks when team mode is explicitly off or child sessions exist", () => {
    const children = new Map([["with-child", [{ id: "child-1" }]]]);
    const getChildSessions = (id: string) => children.get(id) ?? [];
    expect(
      isTeamModeLocked({ id: "off", teamModeOff: false }, getChildSessions),
    ).toBe(true);
    expect(
      isTeamModeLocked({ id: "with-child", teamModeOff: true }, getChildSessions),
    ).toBe(true);
    expect(
      isTeamModeLocked({ id: "free", teamModeOff: true }, getChildSessions),
    ).toBe(false);
  });

  it("round-trips the create-time choice through mavis-team-mode", () => {
    localStorage.clear();
    expect(readTeamModeOff()).toBe(true);
    writeTeamModeOff(false);
    expect(readTeamModeOff()).toBe(false);
    writeTeamModeOff(true);
    expect(readTeamModeOff()).toBe(true);
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
