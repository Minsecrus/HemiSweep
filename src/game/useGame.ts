import { useCallback, useEffect, useMemo, useState } from "react";
import { createBoardMesh } from "../geometry/tilings";
import { createRegularMesh } from "../geometry/regular";
import type { BoardMesh, GridKind } from "../geometry/types";
import { chordCell, createGame, revealCell, toggleFlag } from "./engine";

export const SIZES = [
  { k: 5, name: "小型" },
  { k: 7, name: "标准" },
  { k: 9, name: "大型" },
] as const;
export const DENSITIES = [
  { value: 0.12, name: "轻松" },
  { value: 0.16, name: "经典" },
  { value: 0.2, name: "挑战" },
] as const;
export type BoardPattern = GridKind | "regular";
export interface GameConfig {
  frequency: number;
  density: number;
  pattern: BoardPattern;
  a: number;
  b: number;
}
const DEFAULT_CONFIG: GameConfig = {
  frequency: 7,
  density: 0.16,
  pattern: "dual",
  a: 5,
  b: 3,
};
const meshCache = new Map<string, BoardMesh>();
function getMesh(config: GameConfig) {
  const key =
    config.pattern === "regular"
      ? `regular:${config.a}:${config.b}`
      : `${config.pattern}:${config.frequency}`;
  if (!meshCache.has(key))
    meshCache.set(
      key,
      config.pattern === "regular"
        ? createRegularMesh(config.a, config.b)
        : createBoardMesh(config.frequency, config.pattern),
    );
  return meshCache.get(key)!;
}
function startGame(config: GameConfig, seed: string) {
  const mesh = getMesh(config);
  return createGame(
    mesh.cells.map((c) => c.neighbors),
    Math.min(
      mesh.cells.length - 1,
      Math.ceil(mesh.cells.length * config.density),
    ),
    seed,
  );
}
export function newSeed() {
  return `HEMI-${crypto.getRandomValues(new Uint32Array(1))[0].toString(36).toUpperCase()}`;
}
export function useGame() {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const mesh = useMemo(() => getMesh(config), [config]);
  const [game, setGame] = useState(() =>
    startGame(DEFAULT_CONFIG, "HEMI-ORBIT"),
  );
  const [clock, setClock] = useState(Date.now());
  useEffect(() => {
    if (game.status !== "playing") return;
    const timer = window.setInterval(() => setClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [game.status]);
  const reset = useCallback(
    (updates: Partial<GameConfig> & { seed?: string } = {}) => {
      const { seed = newSeed(), ...changes } = updates;
      const next = { ...config, ...changes };
      setConfig(next);
      setClock(Date.now());
      setGame(startGame(next, seed));
    },
    [config],
  );
  const reveal = useCallback(
    (id: number) => setGame((g) => revealCell(g, id, Date.now())),
    [],
  );
  const flag = useCallback(
    (id: number) => setGame((g) => toggleFlag(g, id)),
    [],
  );
  const chord = useCallback(
    (id: number) => setGame((g) => chordCell(g, id, Date.now())),
    [],
  );
  const flags = game.cells.filter((c) => c.flagged).length;
  const elapsed =
    game.startedAt === null
      ? 0
      : Math.max(
          0,
          Math.floor(
            ((game.finishedAt ?? Math.max(clock, game.startedAt)) -
              game.startedAt) /
              1000,
          ),
        );
  return {
    mesh,
    game,
    ...config,
    reset,
    reveal,
    flag,
    chord,
    flags,
    elapsed,
  };
}
