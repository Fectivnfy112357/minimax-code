/**
 * Composer-side model picker. Mirrors the desktop's two-column popover:
 *
 *   ┌─ models ──────────┬─ detail ──────────────────┐
 *   │ ● MiniMax-M3       │ 上下文窗口                 │
 *   │   MiniMax-M2.7-…   │ 512K                      │
 *   │   MiniMax-M2.7     │ 1M                    ✓   │
 *   │   OpenCode Go      ├─ 推理等级                 │
 *   │                    │ default                   │
 *   └────────────────────┴───────────────────────────┘
 *
 * Model choices and their settings share a compact vertical menu. Selecting a
 * model closes the menu; changing thinking or context immediately commits the
 * focused model's draft through the same `selectModel` operation.
 *
 * The model column is grouped by provider: each group renders a plain provider
 * name above its rows — no nested menu, no second level. Grouping follows the
 * catalog's own order, so the first provider listed stays on top.
 *
 * Drafts live in a `useState` map keyed by `providerId/modelId/variant` so a
 * setting remains responsive while the runtime refreshes its model catalog.
 * The runtime projection is the source of truth after the menu is reopened.
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
import { ToggleSwitch } from "./ToggleSwitch.js";
import type {
  WebuiModelPickerDraft,
  WebuiModelPickerEntry,
} from "../contracts.js";
import { evaluateOutsideClose } from "../projection/outside-close.js";

// Re-export so existing importers keep their import path stable.
export type { WebuiModelPickerDraft, WebuiModelPickerEntry };

export interface ModelPickerProps {
  readonly models: readonly WebuiModelPickerEntry[];
  readonly selected: WebuiModelPickerEntry | undefined;
  readonly onSelect: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly onSettingChange: (
    model: WebuiModelPickerEntry,
    draft: WebuiModelPickerDraft,
  ) => void;
  readonly triggerLabel?: string;
}

function modelKey(model: WebuiModelPickerEntry): string {
  return `${model.providerId}/${model.modelId}/${model.variant ?? ""}`;
}

export interface WebuiModelProviderGroup {
  readonly label: string;
  readonly models: readonly WebuiModelPickerEntry[];
}

/** 分组标题优先用供应商显示名，缺失时退回 providerId。 */
function providerGroupLabel(model: WebuiModelPickerEntry): string {
  const name = model.providerName?.trim();
  return name || model.providerId;
}

/**
 * 按供应商分组，保持目录里原有的出现顺序——与 TUI 侧 `groupModels` 的分组
 * 口径一致（见 `packages/tui/src/tui/features/model/picker.ts`）。
 */
export function groupModelsByProvider(
  models: readonly WebuiModelPickerEntry[],
): readonly WebuiModelProviderGroup[] {
  const groups = new Map<string, WebuiModelPickerEntry[]>();
  for (const model of models) {
    const label = providerGroupLabel(model);
    const group = groups.get(label);
    if (group) group.push(model);
    else groups.set(label, [model]);
  }
  return [...groups].map(([label, entries]) => ({ label, models: entries }));
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
  if (explicit.length > 0) {
    return explicit.includes("default") ? explicit : ["default", ...explicit];
  }
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
  if (options.includes("default")) return "default";
  const defaultEffort = model.defaultEffort?.trim();
  if (defaultEffort && options.includes(defaultEffort)) return defaultEffort;
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
  // Multi-level efforts (low/high/max, …) are not part of the wire variant;
  // their value is carried by the thinking.effort selection instead.
  return undefined;
}

/**
 * 模型列。分组标题只是一行文字，不是可选项——它落在 `role="group"` 内，
 * 由该组的 `aria-label` 承担语义，可见文本因此对辅助技术隐藏。
 */
export function WebuiModelMenuList({
  groups,
  selected,
  focusedKey,
  onFocus,
  onSelect,
}: {
  readonly groups: readonly WebuiModelProviderGroup[];
  readonly selected: WebuiModelPickerEntry | undefined;
  readonly focusedKey: string | undefined;
  readonly onFocus: (key: string) => void;
  readonly onSelect: (model: WebuiModelPickerEntry) => void;
}): ReactElement {
  return (
    <div role="listbox" aria-label="Model" className="webui-model-menu-list">
      {groups.map((group) => (
        <div
          key={group.label}
          role="group"
          aria-label={group.label}
          className="webui-model-menu-group"
        >
          <div className="webui-model-group-header" aria-hidden="true">
            {group.label}
          </div>
          {group.models.map((model) => {
            const key = modelKey(model);
            const isSelected = selected ? modelKey(selected) === key : false;
            const isFocused = focusedKey === key;
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-focused={isFocused ? "true" : "false"}
                className="webui-model-option"
                onMouseEnter={() => onFocus(key)}
                onFocus={() => onFocus(key)}
                onClick={() => onSelect(model)}
              >
                <span className="min-w-0 flex-1 truncate text-left">
                  {model.displayName ??
                    `${model.providerId}/${model.modelId}`}
                </span>
                {isSelected ? (
                  <span
                    aria-hidden="true"
                    className="webui-model-option-tick"
                  >
                    ✓
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

export function WebuiModelPicker({
  models,
  selected,
  onSelect,
  onSettingChange,
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

  // Keep the local mirror through model-catalog refreshes while the menu is
  // open; each setting change is also committed immediately to the runtime.
  // Drop the mirror on close so reopening always starts from persisted state.
  useEffect(() => {
    if (open) return;
    setDrafts({});
  }, [open]);

  // Close on outside pointerdown.
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: PointerEvent) => {
      if (!rootRef.current) return;
      const insideContainer = rootRef.current.contains(event.target as Node);
      // The four-surface outside-close policy lives in
      // `projection/outside-close.ts`; ModelPicker's per-surface variant
      // subscribes to `pointerdown` only (no keydown listener). Routing
      // through `evaluateOutsideClose` keeps the four call sites
      // consistent without changing the original close semantics.
      if (
        evaluateOutsideClose({
          surface: "modelPicker",
          kind: "pointerdown",
          insideContainer,
        }) === "close"
      ) {
        setOpen(false);
      }
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
    onSettingChange(focusedModel, next);
  };

  const handleSelectModel = (model: WebuiModelPickerEntry) => {
    const draft = drafts[modelKey(model)] ?? {};
    setOpen(false);
    setFocusedKey(undefined);
    onSelect(model, draft);
  };

  const groupedModels = useMemo(() => groupModelsByProvider(models), [models]);

  const triggerText =
    selected?.displayName ??
    (selected ? `${selected.providerId}/${selected.modelId}` : undefined) ??
    triggerLabel ??
    "Model";

  const focusedEffort = (() => {
    if (!focusedModel) return undefined;
    if (focusedDraft.thinkingEffort !== undefined) {
      if (focusedDraft.thinkingEffort !== null)
        return focusedDraft.thinkingEffort;
      return "default";
    }
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
          <WebuiModelMenuList
            groups={groupedModels}
            selected={selected}
            focusedKey={focusedKeyString || undefined}
            onFocus={setFocusedKey}
            onSelect={handleSelectModel}
          />
          <div className="webui-model-menu-detail" aria-live="polite">
            {focusedModel ? (
              <>
                {focusedEffortOptions.length > 0 ? (
                  <div className="webui-model-detail-row webui-model-setting-effort">
                    <span className="webui-model-detail-label">推理等级</span>
                    {focusedEffortOptions.length === 2 &&
                    focusedEffortOptions.includes("off") &&
                    focusedEffortOptions.includes("on") &&
                    resolveThinkingMode(focusedModel) === "switchable" ? (
                      <ToggleSwitch
                        checked={focusedEffort === "on"}
                        label="推理等级"
                        data-webui-model-thinking-toggle="true"
                        className="webui-model-thinking-toggle"
                        onChange={() => {
                          if (!focusedModel) return;
                          const next = focusedEffort === "on" ? "off" : "on";
                          const variant = variantForEffort(focusedModel, next);
                          updateFocusedDraft({
                            ...(variant !== undefined ? { variant } : {}),
                          });
                        }}
                      />
                    ) : (
                      <div
                        role="radiogroup"
                        aria-label="推理等级"
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
                              className="webui-model-effort-option"
                              onClick={() => {
                                if (!focusedModel) return;
                                const variant = variantForEffort(
                                  focusedModel,
                                  option,
                                );
                                updateFocusedDraft({
                                  ...(variant !== undefined ? { variant } : {}),
                                  ...(option === "default"
                                    ? { thinkingEffort: null }
                                    : option === "off" || option === "on"
                                      ? {}
                                      : { thinkingEffort: option }),
                                });
                              }}
                            >
                              {option}
                              {active ? (
                                <span aria-hidden="true" className="webui-model-context-tick">✓</span>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}
                {focusedContextOptions.length > 0 ? (
                  <div className="webui-model-detail-row webui-model-setting-context">
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
