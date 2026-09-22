import { useEffect, useState } from "react";
import type { WebuiModelEntry } from "../../server/port.js";

interface SettingsModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly dataDir?: string;
  readonly sessionId?: string;
  readonly listModels?: (request?: { readonly sessionId?: string }) => Promise<readonly WebuiModelEntry[]>;
  readonly selectModel?: (request: { readonly providerId: string; readonly modelId: string; readonly variant?: string; readonly sessionId?: string }) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: (request: { readonly id: string }) => Promise<Record<string, unknown>>;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<Record<string, unknown>>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
}

function stored(key: string, fallback: string): string {
  return typeof localStorage === "undefined" ? fallback : localStorage.getItem(key) ?? fallback;
}

export function SettingsModal({
  open,
  onClose,
  dataDir,
  sessionId,
  listModels,
  selectModel,
  getSessionUsage,
  getAccountStatus,
  signOut,
}: SettingsModalProps) {
  const [theme, setTheme] = useState(() => stored("webui-theme", "light"));
  const [language, setLanguage] = useState(() => stored("mavis-locale", "en"));
  const [density, setDensity] = useState(() => stored("webui-density", "comfortable"));
  const [fontSize, setFontSize] = useState(() => stored("webui-font-size", "14px"));
  const [models, setModels] = useState<readonly WebuiModelEntry[]>([]);
  const [account, setAccount] = useState<Record<string, unknown>>();
  const [usage, setUsage] = useState<Record<string, unknown>>();
  const [signOutError, setSignOutError] = useState<string>();

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(theme === "dark" ? "dark" : "light");
    root.lang = language.startsWith("zh") ? "zh-CN" : "en";
    root.dataset.density = density;
    root.style.setProperty("--webui-font-size", fontSize);
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("webui-theme", theme);
      localStorage.setItem("mavis-locale", language);
      localStorage.setItem("webui-density", density);
      localStorage.setItem("webui-font-size", fontSize);
    }
  }, [density, fontSize, language, theme]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void Promise.all([
      listModels?.({ sessionId }),
      getAccountStatus?.({ sessionId }),
      sessionId && getSessionUsage ? getSessionUsage({ id: sessionId }) : undefined,
    ]).then(([nextModels, nextAccount, nextUsage]) => {
      if (cancelled) return;
      if (nextModels) setModels(nextModels);
      if (nextAccount) setAccount(nextAccount);
      if (nextUsage) setUsage(nextUsage);
    });
    return () => {
      cancelled = true;
    };
  }, [getAccountStatus, getSessionUsage, listModels, open, sessionId]);

  if (!open) return null;
  const selected = models.find((model) => model.selected);
  const selectedValue = selected ? `${selected.providerId}/${selected.modelId}/${selected.variant ?? ""}` : "";
  const onModelChange = async (value: string) => {
    const model = models.find((candidate) => `${candidate.providerId}/${candidate.modelId}/${candidate.variant ?? ""}` === value);
    if (!model || !selectModel) return;
    await selectModel({
      providerId: model.providerId,
      modelId: model.modelId,
      ...(model.variant ? { variant: model.variant } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    const refreshed = await listModels?.({ sessionId });
    if (refreshed) setModels(refreshed);
  };
  const handleSignOut = async () => {
    if (!signOut) return;
    try {
      setSignOutError(undefined);
      await signOut();
      onClose();
    } catch (error) {
      setSignOutError(error instanceof Error ? error.message : String(error));
    }
  };
  return <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-spacing_16">
    <section className="webui-card max-h-[90vh] w-full max-w-2xl overflow-auto p-spacing_24">
      <div className="flex items-center justify-between"><h2 className="text-xl font-semibold">Settings</h2><button className="webui-button-secondary" onClick={onClose}>Close</button></div>
      <div className="mt-spacing_16 grid gap-spacing_16">
        <section><h3>General</h3><label>Theme <select value={theme} onChange={(event) => setTheme(event.target.value)}><option value="light">Light</option><option value="dark">Dark</option></select></label><label className="ml-spacing_12">Language <select value={language} onChange={(event) => setLanguage(event.target.value)}><option value="en">English</option><option value="zh-CN">中文</option></select></label></section>
        <section><h3>Appearance</h3><label>Font size <select value={fontSize} onChange={(event) => setFontSize(event.target.value)}><option value="12px">12</option><option value="14px">14</option><option value="16px">16</option></select></label><label className="ml-spacing_12">Density <select value={density} onChange={(event) => setDensity(event.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></section>
        <section><h3>Account</h3><p>{typeof account?.email === "string" ? account.email : "Managed MiniMax account"}</p><button className="webui-button-secondary" onClick={() => void handleSignOut()} disabled={!signOut}>Sign out</button>{signOutError ? <p role="alert">{signOutError}</p> : null}</section>
        <section><h3>Account onboarding</h3><a href="/onboarding">Review onboarding</a></section>
        <section><h3>Model</h3>{models.length ? <select aria-label="Settings model" value={selectedValue} onChange={(event) => void onModelChange(event.target.value)}>{models.map((model) => <option key={`${model.providerId}/${model.modelId}/${model.variant ?? ""}`} value={`${model.providerId}/${model.modelId}/${model.variant ?? ""}`}>{model.displayName ?? `${model.providerId}/${model.modelId}`}</option>)}</select> : <p>Model selection is available when a session is active.</p>}<p>Usage: {usage ? String(usage.totalTokens ?? usage.total_tokens ?? "available") : "not loaded"}</p></section>
        <section><h3>Persona</h3><p className="text-text_default_secondary">Coming soon — desktop only.</p></section>
        <section><h3>Providers</h3><p className="text-text_default_secondary">Coming soon — desktop only.</p></section>
        <section><h3>Memory</h3><p className="text-text_default_secondary">Coming soon — desktop only.</p></section>
        <section><h3>Data directory</h3><p className="text-text_default_secondary">Read-only current path: {dataDir ?? "managed runtime directory"}</p></section>
      </div>
    </section>
  </div>;
}
