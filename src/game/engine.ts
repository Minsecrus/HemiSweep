import { seededShuffle } from "./random";
import type { CellState, GameState } from "./types";

export type { CellState, GameState, GameStatus } from "./types";

function canAct(state: GameState, id: number): boolean {
  return (
    Number.isInteger(id) &&
    id >= 0 &&
    id < state.cells.length &&
    (state.status === "ready" || state.status === "playing")
  );
}

export function createGame(
  neighbors: readonly (readonly number[])[],
  mineCount: number,
  seed: string,
): GameState {
  if (neighbors.length === 0)
    throw new RangeError("A board needs at least one cell.");
  if (
    !Number.isInteger(mineCount) ||
    mineCount < 0 ||
    mineCount >= neighbors.length
  ) {
    throw new RangeError(
      "Mine count must be an integer from zero to cell count minus one.",
    );
  }
  const graph = neighbors.map((row, id) => {
    if (
      new Set(row).size !== row.length ||
      row.some(
        (other) =>
          !Number.isInteger(other) ||
          other < 0 ||
          other >= neighbors.length ||
          other === id,
      )
    ) {
      throw new RangeError(`Invalid adjacency row for cell ${id}.`);
    }
    return Object.freeze([...row]);
  });
  for (let id = 0; id < graph.length; id += 1) {
    if (graph[id].some((other) => !graph[other].includes(id))) {
      throw new RangeError(`Adjacency must be symmetric at cell ${id}.`);
    }
  }

  return {
    cells: graph.map(() => ({
      mine: false,
      adjacentMines: 0,
      revealed: false,
      flagged: false,
    })),
    status: "ready",
    mineCount,
    seed,
    neighbors: Object.freeze(graph),
    startedAt: null,
    finishedAt: null,
    explodedCell: null,
    firstCell: null,
  };
}

function placeMines(
  state: GameState,
  firstCell: number,
  now: number,
): GameState {
  let protectedCells = new Set([firstCell, ...state.neighbors[firstCell]]);
  // Dense custom boards may not have enough space for the whole safe ring.
  if (state.cells.length - protectedCells.size < state.mineCount) {
    protectedCells = new Set([firstCell]);
  }
  const available = state.cells
    .map((_, id) => id)
    .filter((id) => !protectedCells.has(id));
  const mines = new Set(
    seededShuffle(available, state.seed).slice(0, state.mineCount),
  );
  const cells = state.cells.map((cell, id): CellState => ({
    ...cell,
    mine: mines.has(id),
    adjacentMines: state.neighbors[id].reduce(
      (count, other) => count + Number(mines.has(other)),
      0,
    ),
  }));

  return { ...state, cells, status: "playing", startedAt: now, firstCell };
}

function revealMany(
  state: GameState,
  ids: readonly number[],
  now: number,
): GameState {
  const cells = state.cells.map((cell) => ({ ...cell }));
  const queue = [...ids];
  let changed = false;
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const id = queue[cursor];
    const cell = cells[id];
    if (cell.revealed || cell.flagged) continue;
    changed = true;
    cell.revealed = true;
    if (cell.mine) {
      // Show the minefield on defeat; the triggering cell is retained separately.
      for (const other of cells) if (other.mine) other.revealed = true;
      return {
        ...state,
        cells,
        status: "lost",
        finishedAt: now,
        explodedCell: id,
      };
    }
    if (cell.adjacentMines === 0) queue.push(...state.neighbors[id]);
  }
  if (!changed) return state;
  if (cells.every((cell) => cell.mine || cell.revealed)) {
    for (const cell of cells) if (cell.mine) cell.flagged = true;
    return { ...state, cells, status: "won", finishedAt: now };
  }
  return { ...state, cells };
}

export function revealCell(
  state: GameState,
  id: number,
  now: number,
): GameState {
  if (
    !canAct(state, id) ||
    !Number.isFinite(now) ||
    state.cells[id].flagged ||
    state.cells[id].revealed
  ) {
    return state;
  }
  const started = state.status === "ready" ? placeMines(state, id, now) : state;
  return revealMany(started, [id], now);
}

export function toggleFlag(state: GameState, id: number): GameState {
  if (!canAct(state, id) || state.cells[id].revealed) return state;
  const cells = [...state.cells];
  cells[id] = { ...cells[id], flagged: !cells[id].flagged };
  return { ...state, cells };
}

export function chordCell(
  state: GameState,
  id: number,
  now: number,
): GameState {
  if (!canAct(state, id) || !Number.isFinite(now)) return state;
  const cell = state.cells[id];
  if (!cell.revealed || cell.adjacentMines === 0) return state;
  const adjacent = state.neighbors[id];
  if (
    adjacent.filter((other) => state.cells[other].flagged).length !==
    cell.adjacentMines
  ) {
    return state;
  }
  return revealMany(state, adjacent, now);
}

export function countFlags(state: GameState): number {
  return state.cells.reduce((count, cell) => count + Number(cell.flagged), 0);
}

export function remainingMines(state: GameState): number {
  return state.mineCount - countFlags(state);
}

export function elapsedSeconds(state: GameState, now: number): number {
  if (state.startedAt === null) return 0;
  return Math.max(
    0,
    Math.floor(((state.finishedAt ?? now) - state.startedAt) / 1000),
  );
}
