import { describe, expect, it } from "vitest";
import { DESKTOP_SETTINGS_TABS, SETTINGS_GROUPS } from "../../src/client/components/SettingsModal.js";

describe("desktop settings registry", () => {
  it("keeps the electron tab order, labels, and groups", () => {
    expect(DESKTOP_SETTINGS_TABS.map((tab) => [tab.key, tab.group, tab.label])).toEqual([
      ["desktop", "preferences", "通用"],
      ["shortcuts", "preferences", "快捷键"],
      ["voice", "preferences", "声音"],
      ["custom-instructions", "preferences", "个性化"],
      ["usage", "management", "用量与模型"],
      ["connection", "management", "连接"],
      ["account", "management", "账户"],
      ["coding", "coding", "代码审查"],
      ["worktree", "coding", "工作树"],
      ["archived", "archived", "已归档任务"],
    ]);
  });

  it("declares every desktop group exactly once", () => {
    expect(SETTINGS_GROUPS.map((group) => group.key)).toEqual(["preferences", "management", "coding", "archived"]);
    expect(new Set(DESKTOP_SETTINGS_TABS.map((tab) => tab.key)).size).toBe(DESKTOP_SETTINGS_TABS.length);
    for (const group of SETTINGS_GROUPS) expect(DESKTOP_SETTINGS_TABS.some((tab) => tab.group === group.key)).toBe(true);
  });
});
