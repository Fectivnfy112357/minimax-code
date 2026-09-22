export function LoginCard({ onContinue }: { readonly onContinue?: () => void }) {
  return <section className="webui-card mx-auto flex max-w-md flex-col gap-spacing_16 p-spacing_24"><h1 className="text-2xl font-semibold">Sign in to MiniMax Code</h1><p className="text-text_default_secondary">Use your managed MiniMax account to continue.</p><button className="webui-button-primary" onClick={onContinue}>Continue</button></section>;
}

