/**
 * Outside-close policy catalogue.
 *
 * Four WebUI surfaces close themselves when an interaction happens outside
 * the surface's container. The implementations vary across components
 * today; this module captures the four existing behaviours as data so the
 * truth table lives in one place and a future refactor (e.g. unifying
 * pointerdown + mousedown into a single hook) can read from it without
 * rebuilding the matrix.
 *
 * No runtime change: this module is documentation + a pure evaluation
 * function. The four components continue to attach their listeners
 * directly; the policy table pins the contract.
 *
 * Pointer-event vocabulary:
 *
 *   `pointerdown` — the modern, fire-and-forget pointer event. Fires for
 *                    mouse, touch, pen. Used by UserMenu, ModelPicker,
 *                    SessionComposer slash-popover.
 *   `mousedown`    — the legacy mouse-only event. Used by ContextMenu;
 *                    kept verbatim because the desktop's context menu
 *                    listener is also `mousedown`.
 *   `keydown`      — keyboard event. Used by UserMenu and ContextMenu
 *                    for the Escape key; the two `pointerdown`-only
 *                    surfaces (ModelPicker, slash-popover) do NOT listen
 *                    to keyboard — the regex-driven dismiss in
 *                    slash-popover is triggered by the input change, and
 *                    ModelPicker is dismissed by the click that opens
 *                    another picker / blurs the textarea.
 *
 * Truth table — every (event, target-relationship-to-container) cell:
 *
 *   | surface       | pointerdown outside | pointerdown inside | mousedown outside | Escape |
 *   |---------------|---------------------|--------------------|-------------------|--------|
 *   | userMenu      | close               | ignore             | (n/a — pointer)   | close  |
 *   | modelPicker   | close               | ignore             | (n/a — pointer)   | (n/a)  |
 *   | slashPopover  | close (clear draft) | ignore             | (n/a — pointer)   | (n/a)  |
 *   | contextMenu   | (n/a — mousedown)   | (n/a — mousedown)  | close             | close  |
 *
 * Every cell maps to `evaluateOutsideClose(...) === true | false | null`
 * (null = event not subscribed by this surface; the component never
 * attaches a listener for it, so the value is purely documentation).
 */

export type WebuiOutsideCloseSurface =
  | "userMenu"
  | "modelPicker"
  | "slashPopover"
  | "contextMenu";

export type WebuiOutsideCloseEventKind = "pointerdown" | "mousedown" | "keydown";

/**
 * One row of the policy table. `subscribedKinds` lists the events the
 * surface attaches listeners for; the `kind` value the listener cares
 * about for `keydown` is the `key` field, all other surfaces close on any
 * event of the subscribed kind. `usesContainerContains` is always true
 * today (every implementation uses `Node.contains` to test inside-ness);
 * the flag exists so a future portal-rendered surface can flip it off
 * without rewriting the table.
 */
export interface WebuiOutsideClosePolicy {
  readonly surface: WebuiOutsideCloseSurface;
  readonly subscribedKinds: readonly WebuiOutsideCloseEventKind[];
  readonly usesContainerContains: true;
  readonly onEscape?: boolean;
  readonly notes: string;
}

export const WEBUI_OUTSIDE_CLOSE_POLICIES: {
  readonly [K in WebuiOutsideCloseSurface]: WebuiOutsideClosePolicy;
} = {
  userMenu: {
    surface: "userMenu",
    subscribedKinds: ["pointerdown", "keydown"],
    usesContainerContains: true,
    onEscape: true,
    notes:
      "UserMenu listens to pointerdown + keydown; Escape closes; the keydown does not check inside-ness (Escape is a global key).",
  },
  modelPicker: {
    surface: "modelPicker",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "ModelPicker listens to pointerdown only; no Escape handler — closing is triggered by an outside click that hits another surface or by re-clicking the trigger.",
  },
  slashPopover: {
    surface: "slashPopover",
    subscribedKinds: ["pointerdown"],
    usesContainerContains: true,
    notes:
      "Slash popover listens to pointerdown only; no Escape handler — the composer input change handler drops the '/xxx' segment when the regex no longer matches.",
  },
  contextMenu: {
    surface: "contextMenu",
    subscribedKinds: ["mousedown", "keydown"],
    usesContainerContains: true,
    onEscape: true,
    notes:
      "ContextMenu listens to mousedown (NOT pointerdown — desktop parity) + keydown; Escape closes.",
  },
} as const;

/**
 * Pure evaluation: given a surface policy, an event kind, an event key (for
 * keydown), and whether the target is inside the container, return whether
 * the close should fire.
 *
 * Behaviour table:
 *
 *   | surface       | event       | key     | inside | result     |
 *   |---------------|-------------|---------|--------|------------|
 *   | userMenu      | pointerdown | (any)   | true   | ignore     |
 *   | userMenu      | pointerdown | (any)   | false  | close      |
 *   | userMenu      | keydown     | Escape  | (any)  | close      |
 *   | userMenu      | keydown     | other   | (any)  | ignore     |
 *   | modelPicker   | pointerdown | (any)   | true   | ignore     |
 *   | modelPicker   | pointerdown | (any)   | false  | close      |
 *   | slashPopover  | pointerdown | (any)   | true   | ignore     |
 *   | slashPopover  | pointerdown | (any)   | false  | close      |
 *   | contextMenu   | mousedown   | (any)   | true   | ignore     |
 *   | contextMenu   | mousedown   | (any)   | false  | close      |
 *   | contextMenu   | keydown     | Escape  | (any)  | close      |
 *
 * Events the surface does NOT subscribe to return `null` (the component
 * would never attach a listener for that kind, so the value is purely
 * documentation).
 */
export type WebuiOutsideCloseDecision = "close" | "ignore" | "not-subscribed";

export function evaluateOutsideClose(args: {
  readonly surface: WebuiOutsideCloseSurface;
  readonly kind: WebuiOutsideCloseEventKind;
  readonly key?: string;
  readonly insideContainer: boolean;
}): WebuiOutsideCloseDecision {
  const policy = WEBUI_OUTSIDE_CLOSE_POLICIES[args.surface];
  if (!policy.subscribedKinds.includes(args.kind)) {
    return "not-subscribed";
  }
  if (args.kind === "keydown") {
    if (args.key === "Escape" && policy.onEscape === true) return "close";
    return "ignore";
  }
  // pointerdown / mousedown — close when the event target is outside
  // the surface container; ignore when the user clicked inside.
  if (args.insideContainer) return "ignore";
  return "close";
}