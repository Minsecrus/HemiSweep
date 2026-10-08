import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { Flag, Bomb } from "lucide-react";
import type { GameState } from "../game/types";
import type {
  BoardMesh,
  CellFragment,
  Quaternion,
  Vec2,
} from "../geometry/types";
import { dragRotation, projectBoard } from "../geometry/projection";
import { createMousePress, updateMousePress } from "./mousePress";
import type { MouseAction, MousePress } from "./mousePress";

interface Props {
  mesh: BoardMesh;
  game: GameState;
  rotation: Quaternion;
  setRotation: (q: Quaternion) => void;
  topology: boolean;
  reveal: (id: number) => void;
  flag: (id: number) => void;
  chord: (id: number) => void;
}
interface Gesture {
  pointerId: number;
  x: number;
  y: number;
  previousX: number;
  previousY: number;
  id: number | null;
  moved: boolean;
  button: number;
  pointerType: string;
  mouse: MousePress | null;
  handled: boolean;
  cancelled: boolean;
}

export default function Board({
  mesh,
  game,
  rotation,
  setRotation,
  topology,
  reveal,
  flag,
  chord,
}: Props) {
  const fragments = useMemo(
    () => projectBoard(mesh, rotation),
    [mesh, rotation],
  );
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pressed, setPressed] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const touchPointers = useRef(new Set<number>());
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const svg = useRef<SVGSVGElement>(null);
  const rotationRef = useRef(rotation);
  rotationRef.current = rotation;
  const splitCells = useMemo(() => {
    const counts = new Map<number, number>();
    fragments.forEach((f) =>
      counts.set(f.cellId, (counts.get(f.cellId) ?? 0) + 1),
    );
    return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
  }, [fragments]);
  const activeId = hovered ?? focused;
  const activeFragments = fragments.filter((f) => f.cellId === activeId);
  const pair = activeFragments.length > 1;

  function clearHold() {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }
  useEffect(() => () => clearHold(), []);

  function hover(id: number | null) {
    if (gesture.current?.moved) return;
    setHovered(id);
  }
  function performMouseAction(g: Gesture, action: MouseAction | null) {
    if (action === null || g.moved || g.handled || g.cancelled || g.id === null)
      return;
    g.handled = true;
    setPressed(null);
    setFocused(g.id);
    if (action === "chord") chord(g.id);
    else if (action === "secondary") flag(g.id);
    else if (game.cells[g.id].revealed) chord(g.id);
    else reveal(g.id);
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0 && event.button !== 2) return;
    if (event.pointerType === "touch") {
      touchPointers.current.add(event.pointerId);
      event.currentTarget.setPointerCapture(event.pointerId);
      if (touchPointers.current.size > 1 || !event.isPrimary) {
        clearHold();
        if (gesture.current) gesture.current.cancelled = true;
        setPressed(null);
        setDragging(false);
        return;
      }
    }
    if (gesture.current) {
      const g = gesture.current;
      if (g.pointerId === event.pointerId && g.mouse)
        performMouseAction(g, updateMousePress(g.mouse, event.buttons));
      return;
    }
    const target = (event.target as Element).closest("[data-cell]");
    const id = target ? Number(target.getAttribute("data-cell")) : null;
    gesture.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      previousX: event.clientX,
      previousY: event.clientY,
      id,
      moved: false,
      button: event.button,
      pointerType: event.pointerType,
      mouse:
        event.pointerType === "mouse"
          ? createMousePress(event.button, event.buttons)
          : null,
      handled: false,
      cancelled: false,
    };
    setPressed(id);
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch" && id !== null) {
      const activeGesture = gesture.current;
      holdTimer.current = setTimeout(() => {
        holdTimer.current = null;
        if (
          gesture.current !== activeGesture ||
          activeGesture.pointerType !== "touch" ||
          activeGesture.moved ||
          activeGesture.cancelled ||
          activeGesture.handled
        )
          return;
        activeGesture.handled = true;
        setPressed(null);
        setFocused(id);
        flag(id);
      }, 450);
    }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId || g.cancelled) return;
    const action = g.mouse ? updateMousePress(g.mouse, event.buttons) : null;
    if (!g.moved && Math.hypot(event.clientX - g.x, event.clientY - g.y) > 5) {
      clearHold();
      g.moved = true;
      setDragging(g.button === 0 && !g.mouse?.chorded);
      setPressed(null);
      setHovered(null);
    }
    if (g.mouse?.chorded) setDragging(false);
    if (g.moved && g.button === 0 && !g.mouse?.chorded) {
      const size = svg.current?.getBoundingClientRect().width ?? 620;
      const scale = 620 / size;
      const next = dragRotation(
        rotationRef.current,
        (event.clientX - g.previousX) * scale,
        (event.clientY - g.previousY) * scale,
      );
      rotationRef.current = next;
      setRotation(next);
    }
    g.previousX = event.clientX;
    g.previousY = event.clientY;
    performMouseAction(g, action);
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    touchPointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (!g || g.pointerId !== event.pointerId) {
      if (event.currentTarget.hasPointerCapture(event.pointerId))
        event.currentTarget.releasePointerCapture(event.pointerId);
      return;
    }
    clearHold();
    if (g.mouse) {
      // pointerup is emitted only after the last mouse button is released.
      if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 5)
        g.moved = true;
      performMouseAction(g, updateMousePress(g.mouse, event.buttons));
    } else if (!g.moved && !g.handled && !g.cancelled && g.id !== null) {
      setFocused(g.id);
      if (g.button === 2) flag(g.id);
      else if (game.cells[g.id].revealed) chord(g.id);
      else reveal(g.id);
    }
    gesture.current = null;
    setDragging(false);
    setPressed(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function mouseButtons(event: MouseEvent<SVGSVGElement>) {
    const g = gesture.current;
    if (!g?.mouse || g.cancelled) return;
    // Mouse events cover every button transition even if pointermove is coalesced.
    if (Math.hypot(event.clientX - g.x, event.clientY - g.y) > 5) {
      g.moved = true;
      setPressed(null);
    }
    performMouseAction(g, updateMousePress(g.mouse, event.buttons));
  }
  function cancel(event: PointerEvent<SVGSVGElement>) {
    touchPointers.current.delete(event.pointerId);
    if (gesture.current && gesture.current.pointerId !== event.pointerId)
      return;
    clearHold();
    gesture.current = null;
    setDragging(false);
    setPressed(null);
  }
  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    setHovered(null);
    const id =
      focused ??
      fragments.reduce((a, b) =>
        Math.hypot(...a.label) < Math.hypot(...b.label) ? a : b,
      ).cellId;
    if (event.key === "Enter") {
      event.preventDefault();
      game.cells[id].revealed ? chord(id) : reveal(id);
    } else if (event.key === " " || event.key.toLowerCase() === "f") {
      event.preventDefault();
      flag(id);
    } else if (event.key.startsWith("Arrow")) {
      event.preventDefault();
      const origin = fragments
        .filter((f) => f.cellId === id)
        .sort((a, b) => b.area - a.area)[0].label;
      const direction: Vec2 =
        event.key === "ArrowLeft"
          ? [-1, 0]
          : event.key === "ArrowRight"
            ? [1, 0]
            : event.key === "ArrowUp"
              ? [0, -1]
              : [0, 1];
      let best: CellFragment | null = null;
      let score = Infinity;
      for (const fragment of fragments) {
        if (fragment.cellId === id || fragment.area < 0.001) continue;
        const dx = fragment.label[0] - origin[0],
          dy = fragment.label[1] - origin[1];
        const forward = dx * direction[0] + dy * direction[1];
        if (forward <= 0.005) continue;
        const sideways = Math.abs(dx * direction[1] - dy * direction[0]);
        const candidate = Math.hypot(dx, dy) + sideways * 3;
        if (candidate < score) {
          best = fragment;
          score = candidate;
        }
      }
      if (best) {
        setFocused(best.cellId);
      }
    }
  }
  const numberSize = Math.min(0.16, 0.86 / Math.sqrt(mesh.cells.length));
  return (
    <div className={`disk-stage ${dragging ? "is-dragging" : ""}`}>
      <svg
        ref={svg}
        className="board-svg"
        viewBox="-1.16 -1.16 2.32 2.32"
        role="application"
        tabIndex={0}
        aria-label={`射影平面棋盘，${mesh.cells.length} 格。拖动旋转，点击翻开，右键或长按插旗。方向键选择格子，Enter 翻开或快速展开，空格插旗。`}
        onPointerDown={pointerDown}
        onPointerMove={pointerMove}
        onPointerUp={pointerUp}
        onPointerCancel={cancel}
        onLostPointerCapture={cancel}
        onMouseDown={mouseButtons}
        onMouseUp={mouseButtons}
        onContextMenu={(e) => e.preventDefault()}
        onKeyDown={keyDown}
        onFocus={() => {
          if (focused === null)
            setFocused(
              fragments.reduce((a, b) =>
                Math.hypot(...a.label) < Math.hypot(...b.label) ? a : b,
              ).cellId,
            );
        }}
        onBlur={() => setFocused(null)}
        onPointerLeave={() => {
          if (!gesture.current) hover(null);
        }}
      >
        <defs>
          <radialGradient id="diskHalo">
            <stop offset="78%" stopColor="var(--halo)" stopOpacity="0" />
            <stop offset="94%" stopColor="var(--halo)" stopOpacity=".055" />
            <stop offset="100%" stopColor="var(--halo)" stopOpacity="0" />
          </radialGradient>
          <clipPath id="diskClip">
            <circle r="1.001" />
          </clipPath>
        </defs>
        <circle r="1.14" fill="url(#diskHalo)" />
        <circle
          r="1.051"
          fill="none"
          stroke="var(--tick)"
          strokeWidth=".0018"
          strokeDasharray=".005 .018"
          opacity=".55"
        />
        {Array.from({ length: 48 }, (_, i) => {
          const a = (i * Math.PI) / 24,
            long = i % 4 === 0;
          return (
            <line
              key={i}
              x1={Math.cos(a) * 1.073}
              y1={Math.sin(a) * 1.073}
              x2={Math.cos(a) * (long ? 1.1 : 1.083)}
              y2={Math.sin(a) * (long ? 1.1 : 1.083)}
              stroke="var(--tick)"
              opacity={long ? 1 : 0.5}
              strokeWidth=".002"
            />
          );
        })}
        <g clipPath="url(#diskClip)">
          <circle r="1" fill="var(--hidden-cell)" />
          {fragments.map((fragment) => {
            const cell = game.cells[fragment.cellId];
            const shownMine =
              cell.mine && (game.status === "lost" || cell.revealed);
            const wrongFlag =
              cell.flagged && !cell.mine && game.status === "lost";
            const active = fragment.cellId === activeId;
            return (
              <g
                key={fragment.key}
                data-cell={fragment.cellId}
                data-revealed={cell.revealed}
                data-flagged={cell.flagged}
                data-split={splitCells.has(fragment.cellId)}
                onPointerEnter={() => hover(fragment.cellId)}
              >
                <path
                  d={fragment.path}
                  className={[
                    "cell-path",
                    cell.revealed ? "revealed" : "hidden",
                    cell.flagged ? "flagged" : "",
                    shownMine ? "mine" : "",
                    game.explodedCell === fragment.cellId ? "exploded" : "",
                    topology && splitCells.has(fragment.cellId) ? "seam" : "",
                    active ? "hovered" : "",
                    active && pair ? "paired" : "",
                    pressed === fragment.cellId ? "pressed" : "",
                  ].join(" ")}
                />
                {fragment.area > 0.00055 && (
                  <g
                    className="cell-label"
                    transform={`translate(${fragment.label[0]} ${fragment.label[1]})`}
                  >
                    {shownMine ? (
                      <Bomb
                        x={-numberSize / 2}
                        y={-numberSize / 2}
                        width={numberSize}
                        height={numberSize}
                        color="var(--mine-icon)"
                        strokeWidth={1.8}
                      />
                    ) : cell.flagged ? (
                      <Flag
                        x={-numberSize / 2}
                        y={-numberSize / 2}
                        width={numberSize}
                        height={numberSize}
                        color={wrongFlag ? "var(--error)" : "var(--flag)"}
                        fill={wrongFlag ? "none" : "var(--flag)"}
                        strokeWidth={1.4}
                      />
                    ) : cell.revealed && cell.adjacentMines > 0 ? (
                      <text
                        fontSize={
                          numberSize * (cell.adjacentMines >= 10 ? 0.78 : 1)
                        }
                        textAnchor="middle"
                        dominantBaseline="central"
                        className={`number number-${cell.adjacentMines}`}
                      >
                        {cell.adjacentMines}
                      </text>
                    ) : null}
                    {wrongFlag && (
                      <path
                        d="M-.025-.025 .025.025M.025-.025-.025.025"
                        stroke="var(--error)"
                        strokeWidth=".007"
                      />
                    )}
                  </g>
                )}
              </g>
            );
          })}
          {activeFragments.map((f) => (
            <path
              key={`outline-${f.key}`}
              d={f.path}
              fill="none"
              stroke={pair ? "var(--pair)" : "var(--accent)"}
              strokeWidth=".005"
              pointerEvents="none"
            />
          ))}
        </g>
        <circle
          r="1.002"
          className="disk-edge"
          fill="none"
          strokeWidth=".003"
          pointerEvents="none"
        />
        {topology &&
          (pair ? activeFragments : []).map((f, i) => {
            const radius = Math.hypot(...f.label),
              x = (f.label[0] / radius) * 1.1,
              y = (f.label[1] / radius) * 1.1;
            return (
              <g key={f.key} pointerEvents="none">
                <circle cx={x} cy={y} r=".033" fill="var(--pair)" />
                <text
                  x={x}
                  y={y}
                  fontSize=".033"
                  fill="var(--pair-ink)"
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {i === 0 ? "A" : "A′"}
                </text>
              </g>
            );
          })}
        {!pair && topology && (
          <g
            pointerEvents="none"
            fill="var(--muted)"
            fontSize=".032"
            textAnchor="middle"
          >
            <text x="0" y="-1.105">
              A
            </text>
            <text x="0" y="1.132">
              A′
            </text>
          </g>
        )}
      </svg>
    </div>
  );
}
