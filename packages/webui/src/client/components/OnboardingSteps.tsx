export interface WebuiOnboardingStep { readonly subtitle: string; readonly title: string; readonly description: string; readonly image?: string; }

const DEFAULT_STEPS: readonly WebuiOnboardingStep[] = [
  { subtitle: "Agent Team mode", title: "Define the goal. MiniMax builds the team.", description: "Enable Agent Team mode and let MiniMax assemble the right team for your goal.", image: "/assets/img/onboard_v2_1_en.png" },
  { subtitle: "Ready", title: "Just say the word", description: "Choose a local workspace to start your task. Whether you are creating a skill, reviewing memories, setting up scheduled tasks, or assembling an Agent Team, just ask in the prompt.", image: "/assets/img/onboard_v2_4_en.png" },
];

export function OnboardingSteps({ onComplete, steps = DEFAULT_STEPS }: { readonly onComplete?: () => void; readonly steps?: readonly WebuiOnboardingStep[] }) {
  const step = steps[0];
  if (!step) return null;
  return <section className="mx-auto flex max-w-2xl flex-col gap-spacing_16 p-spacing_24"><p className="text-size_12 text-text_default_tertiary">1 / {steps.length}</p>{step.image ? <img src={step.image} alt="" className="max-h-64 object-contain" /> : null}<p className="text-size_12 text-text_default_tertiary">{step.subtitle}</p><h1 className="text-3xl font-semibold">{step.title}</h1><p className="text-text_default_secondary">{step.description}</p><button className="webui-button-primary" onClick={onComplete}>{steps.length === 1 ? "Get started" : "Next"}</button></section>;
}
