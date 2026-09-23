// Questionnaire state helpers — pure functions for the questionnaire panel
// the runtime asks the user to fill in.
//
// The interaction panel keeps three `Record<stepId, …>` blobs in component
// state: which option ids are selected, whether the user picked "Other",
// and what they typed in the "Other" box. These helpers are the pure
// transforms that derive the next state from user clicks and the wire
// payload — keeping them here lets the test layer assert the
// recommendations-first sort, the multi/single toggle, and the
// `allowOther` projection without rendering the panel.

import type {
  WebuiQuestionnaireAnswer,
  WebuiQuestionnaireOption,
  WebuiQuestionnaireRequest,
  WebuiQuestionnaireStep,
} from "../../server/port.js";

/** Read the selected option ids for one step, defaulting to an empty list
 *  when the user hasn't touched that step yet. Internal to this module — the
 *  panel reaches the same state through its own controlled input. */
export function optionIdsForStep(
  selections: Readonly<Record<string, readonly string[]>>,
  stepId: string,
): readonly string[] {
  return selections[stepId] ?? [];
}

/** Sort the options of one step so the recommended option comes first. The
 *  sort is stable for ties: the wire order is preserved. */
export function sortWebuiQuestionnaireOptions(
  options: readonly WebuiQuestionnaireOption[],
): readonly WebuiQuestionnaireOption[] {
  return [...options].sort(
    (left, right) =>
      Number(right.recommended === true) - Number(left.recommended === true),
  );
}

/** Decide whether the user may advance past one step. Non-required steps
 *  always advance; required steps demand at least one option, or — when the
 *  user picked "Other" — a non-empty `otherText`. */
export function canAdvanceWebuiQuestionnaireStep(
  step: WebuiQuestionnaireStep | undefined,
  selected: readonly string[],
  selectedOther: boolean,
  otherText: string,
): boolean {
  if (!step || !step.required) return true;
  if (selectedOther) return Boolean(otherText.trim());
  return selected.length > 0;
}

/** Toggle one option on/off. For single-select steps the click is a
 *  replacement (the panel always shows the new selection); for multi-select
 *  steps the click flips membership in the existing selection list. */
export function toggleWebuiQuestionnaireOption(
  selected: readonly string[],
  optionId: string,
  multiple: boolean,
): readonly string[] {
  if (!multiple) return [optionId];
  return selected.includes(optionId)
    ? selected.filter((id) => id !== optionId)
    : [...selected, optionId];
}

/**
 * Convert the interaction panel's controlled fields into the harness answer
 * shape. Keeping this projection outside the JSX makes the `allowOther`
 * path effect-testable without pretending a server-side render exercised
 * browser input events.
 */
export function buildWebuiQuestionnaireAnswers(
  request: WebuiQuestionnaireRequest,
  selections: Readonly<Record<string, readonly string[]>>,
  otherSelections: Readonly<Record<string, boolean>>,
  otherTexts: Readonly<Record<string, string>>,
): readonly WebuiQuestionnaireAnswer[] {
  return request.steps.map((step) => {
    const selectedOther = otherSelections[step.id] === true;
    return {
      stepId: step.id,
      selectedOptionIds: optionIdsForStep(selections, step.id),
      ...(selectedOther
        ? {
            selectedOther: true,
            otherText: otherTexts[step.id] ?? "",
          }
        : {}),
    };
  });
}