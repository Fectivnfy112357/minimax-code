import { describe, expect, it } from "vitest";
import { DESKTOP_SETTINGS_TABS, filterSettingsTabs, GENERIC_FILE_ROW_ORDER, GENERIC_RADIO_CONTRACT, GENERIC_SECTION_TEST_IDS, resolveThemePreference, SETTINGS_GROUPS, SETTINGS_ICON_PATHS } from "../../src/client/components/SettingsModal.js";

describe("desktop settings registry", () => {
  it("keeps the electron tab order, labels, and groups", () => {
    expect(DESKTOP_SETTINGS_TABS.map((tab) => [tab.key, tab.group, tab.label])).toEqual([
      ["desktop", "preferences", "通用"],
      ["voice", "preferences", "语音"],
      ["shortcuts", "preferences", "快捷键"],
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

  it("resolves system theme against the OS preference", () => {
    expect(resolveThemePreference("system", true)).toBe("dark");
    expect(resolveThemePreference("system", false)).toBe("light");
    expect(resolveThemePreference("light", true)).toBe("light");
    expect(resolveThemePreference("dark", false)).toBe("dark");
  });

  it("returns the desktop empty-state condition for an unmatched search", () => {
    expect(filterSettingsTabs("不存在的设置")).toHaveLength(0);
  });

  it("keeps the generic page structure and control contracts", () => {
    expect(GENERIC_SECTION_TEST_IDS).toEqual(["app-mode-section", "application-section", "link-open-destination-section", "file-section", "session-management-section", "agent-control-permission-section", "preference-settings", "about-section"]);
    expect(GENERIC_FILE_ROW_ORDER).toEqual(["file-open-in-new-tab-switch", "file-line-wrap-switch"]);
    expect(GENERIC_RADIO_CONTRACT).toEqual({ position: "absolute right-4 top-[22px]", accentToken: "icon_default_accent" });
    for (const tab of DESKTOP_SETTINGS_TABS) expect(SETTINGS_ICON_PATHS[tab.icon]).toBeTruthy();
  });
});
