import { describe, expect, it } from "vitest";
import { createMousePress, updateMousePress } from "./mousePress";

describe("classic mouse button gestures", () => {
  it.each([
    { first: "left", button: 0, initial: 1, released: "left", remaining: 2 },
    { first: "left", button: 0, initial: 1, released: "right", remaining: 1 },
    { first: "right", button: 2, initial: 2, released: "left", remaining: 2 },
    { first: "right", button: 2, initial: 2, released: "right", remaining: 1 },
  ])(
    "chords once with $first pressed first and $released released first",
    ({ button, initial, remaining }) => {
      const press = createMousePress(button, initial);
      expect(updateMousePress(press, 3)).toBeNull();
      expect(updateMousePress(press, 3)).toBeNull();
      expect(updateMousePress(press, remaining)).toBe("chord");
      expect(updateMousePress(press, remaining)).toBeNull();
      expect(updateMousePress(press, 0)).toBeNull();
    },
  );

  it.each([
    { button: 0, buttons: 1, action: "primary" },
    { button: 2, buttons: 2, action: "secondary" },
  ])("emits $action only on single-button release", ({ button, buttons, action }) => {
    const press = createMousePress(button, buttons);
    expect(updateMousePress(press, buttons)).toBeNull();
    expect(updateMousePress(press, 0)).toBe(action);
    expect(updateMousePress(press, 0)).toBeNull();
  });

  it("does not chord again when the released button is pressed before full release", () => {
    const press = createMousePress(0, 1);
    const actions = [3, 2, 3, 2, 0].map((buttons) => updateMousePress(press, buttons));
    expect(actions).toEqual([null, "chord", null, null, null]);
  });
});
