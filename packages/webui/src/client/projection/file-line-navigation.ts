export interface WebuiFileLineTarget {
  focus(options?: FocusOptions): void;
  scrollIntoView(options?: ScrollIntoViewOptions): void;
}

/** Move keyboard focus and the scroll position to the requested source line. */
export function focusWebuiFileLine(target: WebuiFileLineTarget): void {
  target.scrollIntoView({ block: "center", behavior: "smooth" });
  target.focus({ preventScroll: true });
}

export function webuiFileLineTargetId(tabId: string, line: number): string {
  return `webui-file-line-${encodeURIComponent(tabId)}-${line}`;
}
