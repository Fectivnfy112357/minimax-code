import { useMemo, useState } from "react";

export interface WebuiOnboardingStep {
  readonly subtitle: string;
  readonly title: string;
  readonly description: string;
  readonly image?: string;
}

const STEPS = {
  en: [
    {
      subtitle: "Agent Team mode",
      title: "Define the goal. MiniMax builds the team.",
      description:
        "Enable Agent Team mode and simply drop in a task. MiniMax assesses the complexity: routing simple requests to a single agent for instant resolution, or assembling a team to tackle complex challenges.",
      image: "/assets/img/onboard_v2_1_en.png",
    },
    {
      subtitle: "Ready",
      title: "Just say the word",
      description:
        "Select a local workspace directory to begin. Whether you're creating a skill, reviewing memories, setting up scheduled tasks, or assembling an Agent Team, just ask in the prompt.",
      image: "/assets/img/onboard_v2_4_en.png",
    },
  ],
  zh: [
    {
      subtitle: "Agent Team 模式",
      title: "下达目标，MiniMax 自主组建小队",
      description:
        "启用 Agent Team 模式后，你只需随心抛出任务，MiniMax 会自行评估复杂度，简单任务由单一 Agent 极速办结，复杂类则召集小队联合解决。",
      image: "/assets/img/onboard_v2_1_cn.png",
    },
    {
      subtitle: "就绪",
      title: "在输入框里下达一切指令",
      description:
        "选择一个本地工作目录开始你的任务。无论是创建技能、查看记忆、设置定时任务，还是组建 Agent Team，一切需求，在输入框里下达即可。",
      image: "/assets/img/onboard_v2_4_cn.png",
    },
  ],
} as const satisfies Record<"en" | "zh", readonly WebuiOnboardingStep[]>;

function readLocale(): "en" | "zh" {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("mavis-locale")?.toLowerCase();
    if (stored === "zh" || stored?.startsWith("zh-")) return "zh";
    if (stored === "en" || stored?.startsWith("en-")) return "en";
  }
  return typeof navigator !== "undefined" && navigator.language.toLowerCase().startsWith("zh")
    ? "zh"
    : "en";
}

export function OnboardingSteps({
  onComplete,
  steps,
}: {
  readonly onComplete?: () => void;
  readonly steps?: readonly WebuiOnboardingStep[];
}) {
  const locale = useMemo(readLocale, []);
  const resolvedSteps = steps ?? STEPS[locale];
  const [currentStep, setCurrentStep] = useState(0);
  const step = resolvedSteps[currentStep];
  if (!step) return null;
  const isLast = currentStep === resolvedSteps.length - 1;
  return (
    <section className="relative flex min-h-screen w-full bg-bg_default_primary">
      {currentStep > 0 ? (
        <button
          type="button"
          className="absolute left-spacing_16 top-spacing_16 z-10 webui-icon-button"
          aria-label="Go back"
          onClick={() => setCurrentStep((value) => value - 1)}
        >
          ←
        </button>
      ) : null}
      <div className="flex w-1/2 flex-col justify-between p-spacing_64">
        <div>
          <p className="text-size_16 text-text_status_warning">{step.subtitle}</p>
          <h1 className="mt-spacing_12 text-[32px] font-medium leading-line_height_40 text-text_default_primary">
            {step.title}
          </h1>
          <p className="mt-spacing_12 text-size_16 leading-[26px] text-text_default_secondary">
            {step.description}
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div className="flex gap-spacing_6" aria-label="Onboarding steps">
            {resolvedSteps.map((_, index) => (
              <button
                key={index}
                type="button"
                aria-label={`Go to step ${index + 1}`}
                aria-current={index === currentStep ? "step" : undefined}
                className={`h-1.5 w-1.5 rounded-full ${index === currentStep ? "bg-text_default_primary" : "bg-text_default_quaternary"}`}
                onClick={() => setCurrentStep(index)}
              />
            ))}
          </div>
          <button
            type="button"
            className="webui-button-primary"
            onClick={() => (isLast ? onComplete?.() : setCurrentStep((value) => value + 1))}
          >
            {isLast ? (locale === "zh" ? "开始" : "Get started") : "Next"}
          </button>
        </div>
      </div>
      <div className="flex w-1/2 items-center justify-center bg-bg_grouped_secondary">
        {step.image ? (
          <img src={step.image} alt={step.title} className="h-full w-full object-contain" />
        ) : null}
      </div>
    </section>
  );
}
