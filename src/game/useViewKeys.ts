import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import { dragRotation } from "../geometry/projection";
import type { Quaternion } from "../geometry/types";

const DIRECTIONS: Record<string, readonly [number, number]> = {
  KeyW: [0, 1],
  KeyA: [1, 0],
  KeyS: [0, -1],
  KeyD: [-1, 0],
};
const SPEED = 160;

/** Held WASD keys turn the spherical camera independently of game state. */
export function useViewKeys(
  setRotation: Dispatch<SetStateAction<Quaternion>>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    const held = new Set<string>();
    let frame: number | null = null;
    let previousTime: number | null = null;

    function stop() {
      held.clear();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      previousTime = null;
    }
    function tick(time: number) {
      frame = null;
      const elapsed =
        previousTime === null ? 0 : Math.min(40, time - previousTime) / 1000;
      previousTime = time;
      let dx = 0;
      let dy = 0;
      for (const code of held) {
        dx += DIRECTIONS[code][0];
        dy += DIRECTIONS[code][1];
      }
      const length = Math.hypot(dx, dy);
      if (length > 0 && elapsed > 0)
        setRotation((rotation) =>
          dragRotation(
            rotation,
            (dx / length) * SPEED * elapsed,
            (dy / length) * SPEED * elapsed,
          ),
        );
      if (held.size > 0) frame = requestAnimationFrame(tick);
    }
    function keyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) {
        stop();
        return;
      }
      if (!(event.code in DIRECTIONS) || event.isComposing) return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]',
        )
      ) {
        stop();
        return;
      }
      event.preventDefault();
      held.add(event.code);
      if (frame === null) frame = requestAnimationFrame(tick);
    }
    function keyUp(event: KeyboardEvent) {
      if (!held.delete(event.code)) return;
      event.preventDefault();
      if (held.size === 0) stop();
    }
    function visibilityChanged() {
      if (document.hidden) stop();
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", stop);
    document.addEventListener("visibilitychange", visibilityChanged);
    return () => {
      stop();
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", stop);
      document.removeEventListener("visibilitychange", visibilityChanged);
    };
  }, [enabled, setRotation]);
}
