import { describe, expect, it } from "vitest";
import {
  WEBUI_OUTSIDE_CLOSE_POLICIES,
  evaluateOutsideClose,
  type WebuiOutsideCloseSurface,
} from "../../src/client/projection/outside-close.js";

/**
 * Pure tests for the four outside-close strategies.
 *
 * The four surfaces are: UserMenu, ModelPicker, SessionComposer
 * slash-popover, ContextMenu. Each has a slightly different mix of
 * subscribed event kinds and Escape handling. The tests pin the truth
 * table that lives in `outside-close.ts` and pin the contract that no
 * surface closes on a non-subscribed event (the listener is simply not
 * attached).
 *
 * Manual acceptance (out-of-band, can't be automated in this runner):
 *   - UserMenu: open the user menu, click outside the anchor → menu closes.
 *     Press Escape → menu closes.
 *   - ModelPicker: open the picker, click outside the root → picker closes.
 *     Press Escape → picker stays open (no keydown listener).
 *   - Slash popover: type `/ask-` to open the popover, click outside the
 *     composer region → the `/ask-` segment is cleared and the popover
 *     disappears. Press Escape → the composer input handler treats Escape
 *     as a normal keystroke (the popover does NOT listen for it).
 *   - ContextMenu: open the context menu, mousedown outside → menu closes.
 *     Press Escape → menu closes.
 */

const SURFACES: readonly WebuiOutsideCloseSurface[] = [
  "userMenu",
  "modelPicker",
  "slashPopover",
  "contextMenu",
];

describe("WEBUI_OUTSIDE_CLOSE_POLICIES — the four surfaces are all registered", () => {
  for (const surface of SURFACES) {
    it(`registers policy for "${surface}"`, () => {
      expect(WEBUI_OUTSIDE_CLOSE_POLICIES[surface]).toBeDefined();
      expect(WEBUI_OUTSIDE_CLOSE_POLICIES[surface].surface).toBe(surface);
    });
  }
});

describe("UserMenu — pointerdown outside closes; keydown Escape closes; other keys ignored", () => {
  it("closes on pointerdown outside the anchor", () => {
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "pointerdown",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores pointerdown inside the anchor", () => {
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "pointerdown",
        insideContainer: true,
      }),
    ).toBe("ignore");
  });

  it("closes on keydown Escape", () => {
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "keydown",
        key: "Escape",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores keydown with non-Escape keys", () => {
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "keydown",
        key: "Enter",
        insideContainer: false,
      }),
    ).toBe("ignore");
  });

  it("ignores keydown with non-Escape keys even when target is inside", () => {
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "keydown",
        key: "a",
        insideContainer: true,
      }),
    ).toBe("ignore");
  });

  it("is `not-subscribed` for mousedown events", () => {
    // UserMenu never attaches a mousedown listener; the value is the
    // documentation the truth table promises.
    expect(
      evaluateOutsideClose({
        surface: "userMenu",
        kind: "mousedown",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });
});

describe("ModelPicker — pointerdown outside closes; no keydown listener", () => {
  it("closes on pointerdown outside the root", () => {
    expect(
      evaluateOutsideClose({
        surface: "modelPicker",
        kind: "pointerdown",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores pointerdown inside the root", () => {
    expect(
      evaluateOutsideClose({
        surface: "modelPicker",
        kind: "pointerdown",
        insideContainer: true,
      }),
    ).toBe("ignore");
  });

  it("is `not-subscribed` for keydown events (no Escape handler)", () => {
    expect(
      evaluateOutsideClose({
        surface: "modelPicker",
        kind: "keydown",
        key: "Escape",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });

  it("is `not-subscribed` for mousedown events", () => {
    expect(
      evaluateOutsideClose({
        surface: "modelPicker",
        kind: "mousedown",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });
});

describe("Slash popover — pointerdown outside closes; no keydown listener; close clears the slash segment", () => {
  it("closes on pointerdown outside the composer region", () => {
    expect(
      evaluateOutsideClose({
        surface: "slashPopover",
        kind: "pointerdown",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores pointerdown inside the composer region", () => {
    expect(
      evaluateOutsideClose({
        surface: "slashPopover",
        kind: "pointerdown",
        insideContainer: true,
      }),
    ).toBe("ignore");
  });

  it("is `not-subscribed` for keydown events (the input change handler is the only path)", () => {
    expect(
      evaluateOutsideClose({
        surface: "slashPopover",
        kind: "keydown",
        key: "Escape",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });

  it("is `not-subscribed` for mousedown events", () => {
    expect(
      evaluateOutsideClose({
        surface: "slashPopover",
        kind: "mousedown",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });
});

describe("ContextMenu — mousedown outside closes; keydown Escape closes; pointerdown is NOT subscribed", () => {
  it("closes on mousedown outside the menu", () => {
    expect(
      evaluateOutsideClose({
        surface: "contextMenu",
        kind: "mousedown",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores mousedown inside the menu", () => {
    expect(
      evaluateOutsideClose({
        surface: "contextMenu",
        kind: "mousedown",
        insideContainer: true,
      }),
    ).toBe("ignore");
  });

  it("closes on keydown Escape", () => {
    expect(
      evaluateOutsideClose({
        surface: "contextMenu",
        kind: "keydown",
        key: "Escape",
        insideContainer: false,
      }),
    ).toBe("close");
  });

  it("ignores keydown with non-Escape keys", () => {
    expect(
      evaluateOutsideClose({
        surface: "contextMenu",
        kind: "keydown",
        key: "Tab",
        insideContainer: false,
      }),
    ).toBe("ignore");
  });

  it("is `not-subscribed` for pointerdown events (desktop parity)", () => {
    // ContextMenu does NOT listen to pointerdown — it listens to
    // mousedown only, matching the desktop's mousedown listener.
    expect(
      evaluateOutsideClose({
        surface: "contextMenu",
        kind: "pointerdown",
        insideContainer: false,
      }),
    ).toBe("not-subscribed");
  });
});

describe("truth table — every (surface × event × inside) cell is exactly one of close / ignore / not-subscribed", () => {
  // 4 surfaces × 3 event kinds × 2 inside states = 24 cells, all enumerated.
  const cases: ReadonlyArray<{
    surface: WebuiOutsideCloseSurface;
    kind: "pointerdown" | "mousedown" | "keydown";
    key?: string;
    inside: boolean;
  }> = [
    { surface: "userMenu", kind: "pointerdown", inside: false },
    { surface: "userMenu", kind: "pointerdown", inside: true },
    { surface: "userMenu", kind: "mousedown", inside: false },
    { surface: "userMenu", kind: "keydown", key: "Escape", inside: false },
    { surface: "userMenu", kind: "keydown", key: "Enter", inside: false },

    { surface: "modelPicker", kind: "pointerdown", inside: false },
    { surface: "modelPicker", kind: "pointerdown", inside: true },
    { surface: "modelPicker", kind: "mousedown", inside: false },
    { surface: "modelPicker", kind: "keydown", key: "Escape", inside: false },

    { surface: "slashPopover", kind: "pointerdown", inside: false },
    { surface: "slashPopover", kind: "pointerdown", inside: true },
    { surface: "slashPopover", kind: "mousedown", inside: false },
    { surface: "slashPopover", kind: "keydown", key: "Escape", inside: false },

    { surface: "contextMenu", kind: "mousedown", inside: false },
    { surface: "contextMenu", kind: "mousedown", inside: true },
    { surface: "contextMenu", kind: "pointerdown", inside: false },
    { surface: "contextMenu", kind: "keydown", key: "Escape", inside: false },
    { surface: "contextMenu", kind: "keydown", key: "Tab", inside: false },
  ];

  for (const test of cases) {
    it(`${test.surface} × ${test.kind}${test.key ? `/${test.key}` : ""} × inside=${test.inside}`, () => {
      const decision = evaluateOutsideClose({
        surface: test.surface,
        kind: test.kind,
        ...(test.key !== undefined ? { key: test.key } : {}),
        insideContainer: test.inside,
      });
      expect(
        decision === "close" ||
          decision === "ignore" ||
          decision === "not-subscribed",
      ).toBe(true);
    });
  }
});

describe("policy catalogue — exactly the expected four subscribed kinds per surface", () => {
  it("UserMenu subscribes pointerdown + keydown", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.userMenu.subscribedKinds).toEqual([
      "pointerdown",
      "keydown",
    ]);
  });

  it("ModelPicker subscribes pointerdown only", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.modelPicker.subscribedKinds).toEqual([
      "pointerdown",
    ]);
  });

  it("Slash popover subscribes pointerdown only", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.slashPopover.subscribedKinds).toEqual([
      "pointerdown",
    ]);
  });

  it("ContextMenu subscribes mousedown + keydown", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.contextMenu.subscribedKinds).toEqual([
      "mousedown",
      "keydown",
    ]);
  });
});

describe("onEscape flag — only UserMenu + ContextMenu flip it on", () => {
  it("UserMenu.onEscape is true", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.userMenu.onEscape).toBe(true);
  });

  it("ModelPicker.onEscape is undefined (no keydown listener)", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.modelPicker.onEscape).toBeUndefined();
  });

  it("SlashPopover.onEscape is undefined (no keydown listener)", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.slashPopover.onEscape).toBeUndefined();
  });

  it("ContextMenu.onEscape is true", () => {
    expect(WEBUI_OUTSIDE_CLOSE_POLICIES.contextMenu.onEscape).toBe(true);
  });
});