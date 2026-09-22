export interface SettingsSearchHighlightTarget {
  readonly classList: { add(name: string): void; remove(name: string): void };
  readonly scrollIntoView?: (options?: { readonly behavior?: "auto" | "smooth"; readonly block?: "center" }) => void;
}

export function scheduleSettingsSearchHighlight(
  target: SettingsSearchHighlightTarget,
  options: { readonly reducedMotion: boolean; readonly setTimeout?: typeof setTimeout; readonly clearTimeout?: typeof clearTimeout } = { reducedMotion: false },
): () => void {
  const setTimer = options.setTimeout ?? setTimeout;
  const clearTimer = options.clearTimeout ?? clearTimeout;
  target.scrollIntoView?.({ behavior: options.reducedMotion ? "auto" : "smooth", block: "center" });
  let removeTimer: ReturnType<typeof setTimeout> | undefined;
  const highlightTimer = setTimer(() => {
    target.classList.add("mavis-settings-search-highlight");
    removeTimer = setTimer(() => target.classList.remove("mavis-settings-search-highlight"), 1400);
  }, options.reducedMotion ? 0 : 260);
  return () => {
    clearTimer(highlightTimer);
    if (removeTimer !== undefined) clearTimer(removeTimer);
    target.classList.remove("mavis-settings-search-highlight");
  };
}
