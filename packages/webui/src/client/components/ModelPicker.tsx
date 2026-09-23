/**
 * Composer-side model picker. Mirrors the desktop's two-column popover:
 *
 *   ┌─ models ──────────┬─ detail ──────────────────┐
 *   │ ● MiniMax-M3       │ 思考  [on/off]              │
 *   │   MiniMax-M2.7-…   │ 上下文窗口                  │
 *   │   MiniMax-M2.7     │   ● 512K                  │
 *   │   OpenCode Go      │   ○ 1M  用量较高           │
 *   └────────────────────┴────────────────────────────┘
 *
 * The left list is the commit action: it folds the per-model drafts
 * (`variant`, `contextLimit`) into a single `selectModel` RPC, then closes
 * the popover. The right panel surfaces fields that already ride on every
 * `WebuiModelEntry`:
 *   - `effortOptions` / `thinkingConfig` (思考 levels). Toggle or chip clicks
 *     just update the focused model's local draft — they don't persist until
 *     the user commits via the left list. For binary on/off, the picker maps
 *     the choice onto the wire `variant` ("thinking" / "").
 *   - `contextWindowOptions` / `contextWindowOptionHints` (上下文窗口). The
 *     selected token count rides on the same `selectModel` payload via
 *     `contextLimit`; the runtime accepts it through the v2 contract so
 *     subsequent `listModels` echoes the new value back.
 *
 * Drafts live in a `useState` map keyed by `providerId/modelId/variant`.
 * They only reset when the popover transitions from open to closed; the
 * 2-second `listModels` refresh in `app.tsx` does not invalidate them
 * because the persisted selection already round-trips through the runtime.
 */
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";

import { WebuiIconChevronDown } from "../icons.js";
import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
} from "../contracts.js";

// Re-export so existing importers keep their import path stable.
export type { WebuiModelPickerDraft, WebuiModelPickerEntry };

export interface ModelPickerProps {
  readonly models: readonly WebuiModelPickerEntry[];
  readonly selected: WebuiModelPickerEntry | undefined;
  readonly onSelect: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly triggerLabel?: string;
}

function modelKey(model: WebuiModelPickerEntry): string {
  return `${model.providerId}/${model.modelId}/${model.variant ?? ""}`;
}

function formatContextWindow(value: number): string {
  if (value >= 1_000_000) return `${value / 1_000_000}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return String(value);
}

function resolveEffortOptions(
  model: WebuiModelPickerEntry,
): readonly string[] {
  const explicit = model.effortOptions ?? [];
  if (explicit.length > 0) return explicit;
  // The runtime reports switchable thinking via `thinkingConfig.mode` +
  // `supportedVariants`. Treat any model that supports both an empty and a
  // non-empty variant as a binary "off / on" toggle so the picker still
  // surfaces the control without the runtime having to fill `effortOptions`.
  if (model.thinkingConfig?.mode === "switchable") {
    const variants = model.supportedVariants ?? [];
    const hasOff = variants.includes("");
    const hasOn = variants.some((variant) => Boolean(variant));
    if (hasOff && hasOn) return ["off", "on"];
  }
  return [];
}

function resolveCurrentEffort(model: WebuiModelPickerEntry): string | undefined {
  const options = resolveEffortOptions(model);
  if (options.length === 0) return undefined;
  const thinking = model.thinking?.effort?.trim();
  if (thinking && options.includes(thinking)) return thinking;
  return model.variant === "thinking"
    ? options.includes("on")
      ? "on"
      : options[0]
    : options[0];
}

function resolveThinkingMode(
  model: WebuiModelPickerEntry,
): "switchable" | "forced_on" | "forced_off" | undefined {
  return model.thinkingConfig?.mode as
    | "switchable"
    | "forced_on"
    | "forced_off"
    | undefined;
}

function variantForEffort(
  model: WebuiModelPickerEntry,
  effort: string,
): string | undefined {
  const options = resolveEffortOptions(model);
  if (options.length === 0) return undefined;
  const thinkingOn = options.includes("on");
  if (thinkingOn && (effort === "on" || effort === "off")) {
    return effort === "on" ? "thinking" : "";
  }
  // Multi-level efforts (low/high/max, …) are not part of the wire variant.
  // The picker keeps them in local draft; the parent will see no variant
  // change because variant is undefined for these models.
  return undefined;
}

export function WebuiModelPicker({
  models,
  selected,
  onSelect,
  triggerLabel,
}: ModelPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [focusedKey, setFocusedKey] = useState<string | undefined>(undefined);
  const [drafts, setDrafts] = useState<
    Readonly<Record<string, WebuiModelPickerDraft>>
  >({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerId = useId();
  const menuId = useId();

  // Reset drafts only when the popover closes — not on every parent
  // re-render. The runtime's `listModels` refresh updates the model list
  // every two seconds; if we cleared drafts on each refresh the user's
  // pending toggle/radio choice would snap back to the previous server
  // value, which is exactly the bug this hook used to cause.
  useEffect(() => {
    if (open) return;
    setDrafts({});
  }, [open]);

  // Close on outside pointerdown.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: PointerEvent) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", handler);
    return () => document.removeEventListener("pointerdown", handler);
  }, [open]);

  const focusedModel = useMemo<WebuiModelPickerEntry | undefined>(() => {
    const key = focusedKey ?? (selected ? modelKey(selected) : undefined);
    if (!key) return undefined;
    return models.find((model) => modelKey(model) === key) ?? selected;
  }, [focusedKey, models, selected]);

  const focusedKeyString = focusedModel ? modelKey(focusedModel) : "";
  const focusedDraft: WebuiModelPickerDraft =
    focusedModel ? (drafts[focusedKeyString] ?? {}) : {};

  const updateFocusedDraft = (patch: Partial<WebuiModelPickerDraft>) => {
    if (!focusedModel) return;
    const next: WebuiModelPickerDraft = {
      ...drafts[focusedKeyString],
      ...patch,
    };
    setDrafts((current) => ({ ...current, [focusedKeyString]: next }));
  };

  const handleSelectModel = (model: WebuiModelPickerEntry) => {
    const draft = drafts[modelKey(model)] ?? {};
    setOpen(false);
    setFocusedKey(undefined);
    onSelect(model, draft);
  };

  const triggerText =
    selected?.displayName ??
    (selected ? `${selected.providerId}/${selected.modelId}` : undefined) ??
    triggerLabel ??
    "Model";

  const focusedEffort = (() => {
    if (!focusedModel) return undefined;
    if (focusedDraft.variant !== undefined) {
      // The user has committed an "off" draft → variant === "" → effort "off".
      return focusedDraft.variant === "thinking" ? "on" : "off";
    }
    return resolveCurrentEffort(focusedModel);
  })();

  const focusedContextLimit = (() => {
    if (!focusedModel) return undefined;
    if (focusedDraft.contextLimit !== undefined)
      return focusedDraft.contextLimit;
    return focusedModel.contextLimit;
  })();

  const focusedEffortOptions = focusedModel
    ? resolveEffortOptions(focusedModel)
    : [];
  const focusedContextOptions = focusedModel?.contextWindowOptions ?? [];

  return (
    <div
      ref={rootRef}
      className="webui-model-selector"
      data-webui-model-selector="true"
    >
      <button
        type="button"
        id={triggerId}
        className="webui-model-selector-trigger"
        aria-label="Model"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={models.length === 0}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="min-w-0 max-w-[220px] truncate whitespace-nowrap">
          {triggerText}
        </span>
        <WebuiIconChevronDown className="flex-shrink-0 text-icon_default_tertiary" />
      </button>
      {open ? (
        <div
          role="dialog"
          id={menuId}
          aria-labelledby={triggerId}
          data-webui-model-menu="true"
          className="webui-model-menu webui-model-menu--two-column"
        >
          <div
            role="listbox"
            aria-label="Model"
            className="webui-model-menu-list"
          >
            {models.map((model) => {
              const key = modelKey(model);
              const isSelected = selected
                ? modelKey(selected) === key
                : false;
              const isFocused = focusedModel
                ? modelKey(focusedModel) === key
                : false;
              return (
                <button
                  key={key}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  data-focused={isFocused ? "true" : "false"}
                  className="webui-model-option"
                  onMouseEnter={() => setFocusedKey(key)}
                  onFocus={() => setFocusedKey(key)}
                  onClick={() => handleSelectModel(model)}
                >
                  <span className="min-w-0 flex-1 truncate text-left">
                    {model.displayName ??
                      `${model.providerId}/${model.modelId}`}
                  </span>
                  {isSelected ? (
                    <span aria-hidden="true" className="webui-model-option-tick">
                      ✓
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <div className="webui-model-menu-detail" aria-live="polite">
            {focusedModel ? (
              <>
                {focusedEffortOptions.length > 0 ? (
                  <div className="webui-model-detail-row">
                    <span className="webui-model-detail-label">思考</span>
                    {focusedEffortOptions.length === 2 &&
                    focusedEffortOptions.includes("off") &&
                    focusedEffortOptions.includes("on") &&
                    resolveThinkingMode(focusedModel) === "switchable" ? (
                      <button
                        type="button"
                        role="switch"
                        aria-checked={focusedEffort === "on"}
                        data-webui-model-thinking-toggle="true"
                        className={`webui-model-thinking-toggle ${focusedEffort === "on" ? "is-on" : "is-off"}`}
                        onClick={() => {
                          if (!focusedModel) return;
                          const next = focusedEffort === "on" ? "off" : "on";
                          const variant = variantForEffort(focusedModel, next);
                          updateFocusedDraft({
                            ...(variant !== undefined ? { variant } : {}),
                          });
                        }}
                      >
                        <span className="webui-model-thinking-toggle-knob" />
                      </button>
                    ) : (
                      <div
                        role="radiogroup"
                        aria-label="思考"
                        className="webui-model-effort-group"
                      >
                        {focusedEffortOptions.map((option) => {
                          const active = focusedEffort === option;
                          return (
                            <button
                              key={option}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              className={`webui-model-effort-chip ${active ? "is-active" : ""}`}
                              onClick={() => {
                                if (!focusedModel) return;
                                const variant = variantForEffort(
                                  focusedModel,
                                  option,
                                );
                                updateFocusedDraft({
                                  ...(variant !== undefined ? { variant } : {}),
                                });
                              }}
                            >
                              {option}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                {focusedContextOptions.length > 0 ? (
                  <div className="webui-model-detail-row">
                    <span className="webui-model-detail-label">上下文窗口</span>
                    <div
                      role="radiogroup"
                      aria-label="上下文窗口"
                      className="webui-model-context-group"
                    >
                      {focusedContextOptions.map((value) => {
                        const active = focusedContextLimit === value;
                        const hint =
                          focusedModel.contextWindowOptionHints?.[
                            String(value)
                          ];
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            className={`webui-model-context-option ${active ? "is-active" : ""}`}
                            onClick={() => {
                              if (!focusedModel) return;
                              updateFocusedDraft({ contextLimit: value });
                            }}
                          >
                            <span className="webui-model-context-value">
                              {formatContextWindow(value)}
                            </span>
                            {hint === "higher_usage" ? (
                              <span className="webui-model-context-hint">
                                用量较高
                              </span>
                            ) : null}
                            {active ? (
                              <span
                                aria-hidden="true"
                                className="webui-model-context-tick"
                              >
                                ✓
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {focusedEffortOptions.length === 0 &&
                focusedContextOptions.length === 0 ? (
                  <div className="webui-model-detail-empty">
                    <div className="webui-model-detail-empty-title">
                      {focusedModel.displayName ?? focusedModel.modelId}
                    </div>
                    <div className="webui-model-detail-empty-hint">
                      这个模型没有可调设置。
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="webui-model-detail-empty">选择一个模型查看设置</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}