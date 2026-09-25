// Minimal augmentation for the File System Access API we lean on for the
// "选择新项目" picker. The standard lib doesn't ship types for these symbols
// until newer TypeScript versions, so we declare just enough to keep
// `pickWorkspaceDirectory` type-safe.
interface FileSystemDirectoryHandle {
  readonly name: string;
}

interface Window {
  showDirectoryPicker?: (options?: {
    mode?: "read" | "readwrite";
    startIn?: FileSystemHandle | string;
  }) => Promise<FileSystemDirectoryHandle>;
}

interface HTMLInputElement {
  webkitdirectory?: boolean;
}

interface File {
  readonly path?: string;
}

declare module "highlight.js/lib/core" {
  interface HighlightResult { value: string; }
  interface HighlightOptions { language: string; ignoreIllegals?: boolean; }
  interface HighlightJs {
    highlight(code: string, options: HighlightOptions): HighlightResult;
    getLanguage(name: string): unknown;
    registerLanguage(name: string, language: (hljs: unknown) => unknown): void;
  }
  const hljs: HighlightJs;
  export default hljs;
}

declare module "highlight.js/lib/languages/*" {
  const language: (hljs: unknown) => unknown;
  export default language;
}
