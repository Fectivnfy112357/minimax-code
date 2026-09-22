import { useState, type ReactNode } from "react";
import { SettingsModal } from "./SettingsModal.js";
import type { WebuiModelEntry } from "../../server/port.js";

interface ArchonPageProps {
  readonly children: ReactNode;
  readonly dataDir?: string;
  readonly sessionId?: string;
  readonly listModels?: (request?: { readonly sessionId?: string }) => Promise<readonly WebuiModelEntry[]>;
  readonly selectModel?: (request: { readonly providerId: string; readonly modelId: string; readonly variant?: string; readonly sessionId?: string }) => Promise<{ readonly success?: boolean }>;
  readonly getSessionUsage?: (request: { readonly id: string }) => Promise<Record<string, unknown>>;
  readonly getAccountStatus?: (request?: { readonly sessionId?: string }) => Promise<Record<string, unknown>>;
  readonly signOut?: () => Promise<{ readonly success?: boolean }>;
}

export function ArchonPage({
  children,
  dataDir,
  sessionId,
  listModels,
  selectModel,
  getSessionUsage,
  getAccountStatus,
  signOut,
}: ArchonPageProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <><button className="fixed right-spacing_16 top-spacing_16 z-40 webui-button-secondary" onClick={() => setSettingsOpen(true)}>Settings</button>{children}<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} dataDir={dataDir} sessionId={sessionId} listModels={listModels} selectModel={selectModel} getSessionUsage={getSessionUsage} getAccountStatus={getAccountStatus} signOut={signOut} /></>;
}
