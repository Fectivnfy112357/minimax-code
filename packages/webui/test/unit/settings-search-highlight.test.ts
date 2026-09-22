import { describe, expect, it, vi } from "vitest";
import { scheduleSettingsSearchHighlight } from "../../src/client/components/settings-search-highlight.js";

function target() {
  const classes = new Set<string>();
  return { classes, scroll: vi.fn(), classList: { add: (name: string) => classes.add(name), remove: (name: string) => classes.delete(name) }, scrollIntoView: vi.fn() };
}

describe("settings search highlight", () => {
  it("scrolls smoothly, highlights after 260ms, and removes after 1400ms", () => {
    vi.useFakeTimers();
    const item = target();
    scheduleSettingsSearchHighlight(item, { reducedMotion: false });
    expect(item.scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(false);
    vi.advanceTimersByTime(259);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(false);
    vi.advanceTimersByTime(1);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(true);
    vi.advanceTimersByTime(1399);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(true);
    vi.advanceTimersByTime(1);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(false);
    vi.useRealTimers();
  });

  it("uses immediate auto scrolling and highlighting for reduced motion", () => {
    vi.useFakeTimers();
    const item = target();
    scheduleSettingsSearchHighlight(item, { reducedMotion: true });
    expect(item.scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "center" });
    vi.advanceTimersByTime(0);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(true);
    vi.advanceTimersByTime(1400);
    expect(item.classes.has("mavis-settings-search-highlight")).toBe(false);
    vi.useRealTimers();
  });
});
