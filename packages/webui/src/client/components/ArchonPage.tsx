import { useState, type ReactNode } from "react";
import { SettingsModal } from "./SettingsModal.js";

export function ArchonPage({ children }: { readonly children: ReactNode }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  return <><button className="fixed right-spacing_16 top-spacing_16 z-40 webui-button-secondary" onClick={() => setSettingsOpen(true)}>Settings</button>{children}<SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} /></>;
}

