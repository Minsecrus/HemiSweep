export type MouseAction = "primary" | "secondary" | "chord";

export interface MousePress {
  buttons: number;
  initialButton: number;
  chorded: boolean;
  handled: boolean;
}

export function createMousePress(button: number, buttons: number): MousePress {
  return {
    buttons,
    initialButton: button,
    chorded: (buttons & 3) === 3,
    handled: false,
  };
}

/**
 * Additional mouse buttons produce pointermove, including without cursor motion.
 * Consume a chord on its first release, then suppress the remaining single key.
 */
export function updateMousePress(
  press: MousePress,
  buttons: number,
): MouseAction | null {
  const released = (press.buttons & ~buttons & 3) !== 0;
  press.buttons = buttons;
  if ((buttons & 3) === 3) press.chorded = true;
  if (press.handled) return null;
  if (press.chorded && released) {
    press.handled = true;
    return "chord";
  }
  if (buttons === 0) {
    press.handled = true;
    return press.initialButton === 2 ? "secondary" : "primary";
  }
  return null;
}
