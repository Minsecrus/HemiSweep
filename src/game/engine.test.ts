import { describe, expect, it } from "vitest";
import { createProjectiveMesh } from "../geometry/topology";
import {
  dragRotation,
  IDENTITY_ROTATION,
  projectBoard,
} from "../geometry/projection";
import { dot } from "../geometry/vector";
import {
  chordCell,
  countFlags,
  createGame,
  elapsedSeconds,
  remainingMines,
  revealCell,
  toggleFlag,
} from "./engine";
import { seededRandom, seededShuffle } from "./random";
import type { GameState } from "./types";

const mesh = createProjectiveMesh(7);
const graph = mesh.cells.map((cell) => cell.neighbors);
const completeFour = [
  [1, 2, 3],
  [0, 2, 3],
  [0, 1, 3],
  [0, 1, 2],
];

/** An already-started fixture lets tests target specific topological edges. */
function placedGame(
  neighbors: readonly (readonly number[])[],
  mines: readonly number[],
  revealed: readonly number[] = [],
  flagged: readonly number[] = [],
): GameState {
  const base = createGame(neighbors, mines.length, "fixture");
  return {
    ...base,
    status: "playing",
    startedAt: 1000,
    firstCell: revealed[0] ?? null,
    cells: base.cells.map((cell, id) => ({
      ...cell,
      mine: mines.includes(id),
      adjacentMines: neighbors[id].filter((other) => mines.includes(other))
        .length,
      revealed: revealed.includes(id),
      flagged: flagged.includes(id),
    })),
  };
}

describe("seeded mine placement and first-click safety", () => {
  it("protects all 246 possible first cells and their quotient edge-neighbors", () => {
    for (const cell of mesh.cells) {
      const ready = createGame(graph, 42, "all-first-clicks");
      const playing = revealCell(ready, cell.id, 1234);
      expect(playing.firstCell).toBe(cell.id);
      expect(playing.startedAt).toBe(1234);
      expect(playing.cells[cell.id].revealed).toBe(true);
      expect(playing.cells[cell.id].adjacentMines).toBe(0);
      expect(playing.cells.filter((entry) => entry.mine)).toHaveLength(42);
      for (const id of [cell.id, ...cell.neighbors])
        expect(playing.cells[id].mine).toBe(false);
      expect(ready.status).toBe("ready");
      expect(ready.cells.some((entry) => entry.mine || entry.revealed)).toBe(
        false,
      );
    }
  });

  it("defers placement until an unflagged reveal and starts no timer for flags", () => {
    const ready = createGame(graph, 42, "delayed");
    const flagged = toggleFlag(ready, 0);
    expect(flagged.status).toBe("ready");
    expect(flagged.startedAt).toBeNull();
    expect(flagged.cells.every((cell) => !cell.mine)).toBe(true);
    expect(revealCell(flagged, 0, 5000)).toBe(flagged);
    const playing = revealCell(toggleFlag(flagged, 0), 0, 6000);
    expect(playing.startedAt).toBe(6000);
  });

  it("falls back to just the first cell when the safe ring cannot fit", () => {
    const game = revealCell(createGame(completeFour, 2, "dense"), 0, 100);
    expect(game.cells[0].mine).toBe(false);
    expect(game.cells[0].adjacentMines).toBe(2);
    expect(game.cells.filter((cell) => cell.mine)).toHaveLength(2);
  });

  it("reproduces a minefield using the same seed, graph, and first cell", () => {
    const a = revealCell(
      createGame(graph, 42, "a reproducible seed"),
      20,
      1000,
    );
    const b = revealCell(
      createGame(graph, 42, "a reproducible seed"),
      20,
      9000,
    );
    const c = revealCell(createGame(graph, 42, "another seed"), 20, 1000);
    expect(a.cells).toEqual(b.cells);
    expect(a.cells.map((cell) => cell.mine)).not.toEqual(
      c.cells.map((cell) => cell.mine),
    );
    const source = [1, 2, 3, 4, 5];
    expect(seededShuffle(source, "seed")).toEqual(
      seededShuffle(source, "seed"),
    );
    expect(source).toEqual([1, 2, 3, 4, 5]);
    const random = seededRandom("range");
    for (let i = 0; i < 50; i += 1) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("reveals, flags, chords, and end states", () => {
  it("computes every clue from exactly the supplied edge-neighbor graph", () => {
    const state = revealCell(createGame(graph, 42, "clues"), 0, 1000);
    state.cells.forEach((cell, id) => {
      expect(cell.adjacentMines).toBe(
        graph[id].filter((other) => state.cells[other].mine).length,
      );
    });
  });

  it("wins by revealing every safe cell, auto-flags mines, and freezes the clock", () => {
    let state = revealCell(createGame(graph, 42, "victory"), 0, 1000);
    const mineIds = state.cells.flatMap((cell, id) => (cell.mine ? [id] : []));
    for (let id = 0; id < state.cells.length; id += 1) {
      if (!state.cells[id].mine) state = revealCell(state, id, 7000);
    }
    expect(state.status).toBe("won");
    expect(state.cells.every((cell) => cell.mine || cell.revealed)).toBe(true);
    expect(mineIds.every((id) => state.cells[id].flagged)).toBe(true);
    expect(remainingMines(state)).toBe(0);
    expect(elapsedSeconds(state, 999000)).toBe(6);
    expect(revealCell(state, mineIds[0], 8000)).toBe(state);
    expect(toggleFlag(state, mineIds[0])).toBe(state);
    expect(chordCell(state, 0, 8000)).toBe(state);
  });

  it("loses on a mine, identifies the trigger, and displays all mines", () => {
    const started = revealCell(createGame(graph, 42, "defeat"), 0, 1000);
    const mineId = started.cells.findIndex((cell) => cell.mine);
    const lost = revealCell(started, mineId, 6500);
    expect(lost.status).toBe("lost");
    expect(lost.explodedCell).toBe(mineId);
    expect(lost.finishedAt).toBe(6500);
    expect(
      lost.cells.filter((cell) => cell.mine).every((cell) => cell.revealed),
    ).toBe(true);
    expect(elapsedSeconds(lost, 999000)).toBe(5);
    expect(revealCell(lost, 1, 8000)).toBe(lost);
    expect(toggleFlag(lost, 1)).toBe(lost);
    expect(chordCell(lost, 0, 8000)).toBe(lost);
  });

  it("opens an accurate chord and loses when matching-count flags are wrong", () => {
    const base = placedGame(completeFour, [1], [0]);
    expect(chordCell(base, 0, 2000)).toBe(base);
    const correct = chordCell(toggleFlag(base, 1), 0, 2000);
    expect(correct.status).toBe("won");
    expect(correct.cells[2].revealed).toBe(true);
    expect(correct.cells[3].revealed).toBe(true);
    const incorrect = chordCell(toggleFlag(base, 2), 0, 3000);
    expect(incorrect.status).toBe("lost");
    expect(incorrect.explodedCell).toBe(1);
    expect(incorrect.cells[2].flagged).toBe(true);
    expect(incorrect.cells[2].revealed).toBe(false);
    expect(base.cells[1].revealed).toBe(false);
    expect(base.cells[2].flagged).toBe(false);
  });

  it("blocks flood-fill on flags and makes victory depend on all safe cells", () => {
    const ready = toggleFlag(createGame(graph, 0, "empty"), 0);
    const partial = revealCell(ready, 1, 1000);
    expect(partial.status).toBe("playing");
    expect(partial.cells[0].revealed).toBe(false);
    expect(partial.cells.filter((cell) => cell.revealed)).toHaveLength(245);
    expect(chordCell(partial, 1, 2000)).toBe(partial);
    const won = revealCell(toggleFlag(partial, 0), 0, 3000);
    expect(won.status).toBe("won");
    expect(won.cells.every((cell) => cell.revealed)).toBe(true);
  });

  it("leaves every input state untouched and ignores invalid or repeated operations", () => {
    const state = placedGame(completeFour, [1], [0]);
    const snapshot = structuredClone(state);
    state.cells.forEach(Object.freeze);
    Object.freeze(state.cells);
    Object.freeze(state);
    revealCell(state, 2, 2000);
    toggleFlag(state, 1);
    chordCell(state, 0, 2000);
    expect(state).toEqual(snapshot);
    for (const invalid of [-1, 4, 1.5, NaN]) {
      expect(revealCell(state, invalid, 2000)).toBe(state);
      expect(toggleFlag(state, invalid)).toBe(state);
      expect(chordCell(state, invalid, 2000)).toBe(state);
    }
    expect(revealCell(state, 0, 2000)).toBe(state);
    expect(toggleFlag(state, 0)).toBe(state);
    expect(revealCell(state, 2, NaN)).toBe(state);
    expect(chordCell(state, 0, Infinity)).toBe(state);
    expect(elapsedSeconds(createGame(graph, 42, "ready"), 5000)).toBe(0);
    expect(elapsedSeconds(state, 500)).toBe(0);
  });

  it("counts flags before or after placement, including temporary overflagging", () => {
    let state = createGame(completeFour, 1, "counter");
    state = toggleFlag(state, 0);
    state = toggleFlag(state, 1);
    expect(countFlags(state)).toBe(2);
    expect(remainingMines(state)).toBe(-1);
    state = toggleFlag(state, 0);
    expect(remainingMines(state)).toBe(0);
    expect(state.startedAt).toBeNull();
  });

  it("rejects invalid graph incidence and impossible mine counts", () => {
    expect(() => createGame([], 0, "empty")).toThrow(RangeError);
    expect(() => createGame(completeFour, 4, "many")).toThrow(RangeError);
    expect(() => createGame(completeFour, -1, "negative")).toThrow(RangeError);
    expect(() => createGame(completeFour, 1.2, "fraction")).toThrow(RangeError);
    expect(() => createGame([[1], []], 0, "asymmetric")).toThrow(RangeError);
    expect(() => createGame([[1, 1], [0]], 0, "duplicate")).toThrow(RangeError);
    expect(() => createGame([[0]], 0, "loop")).toThrow(RangeError);
    expect(() => createGame([[2], [0]], 0, "invalid id")).toThrow(RangeError);
  });
});

describe("rules on the antipodal quotient", () => {
  const seamCell = mesh.cells.find((cell) =>
    cell.neighbors.some((id) => dot(cell.center, mesh.cells[id].center) < 0),
  )!;
  const seamNeighbor = seamCell.neighbors.find(
    (id) => dot(seamCell.center, mesh.cells[id].center) < 0,
  )!;

  it("counts and flags a mine across an identified edge", () => {
    expect(dot(seamCell.center, mesh.cells[seamNeighbor].center)).toBeLessThan(
      0,
    );
    const revealed = revealCell(
      placedGame(graph, [seamNeighbor]),
      seamCell.id,
      2000,
    );
    expect(revealed.cells[seamCell.id].adjacentMines).toBe(1);
    const flagged = toggleFlag(revealed, seamNeighbor);
    expect(flagged.cells[seamNeighbor].flagged).toBe(true);
    expect(remainingMines(flagged)).toBe(0);
  });

  it("expands blank cells across actual antipodal quotient adjacency", () => {
    const outside = mesh.cells.find(
      (cell) =>
        cell.id !== seamCell.id &&
        cell.id !== seamNeighbor &&
        !seamCell.neighbors.includes(cell.id) &&
        !graph[seamNeighbor].includes(cell.id),
    )!.id;
    const before = placedGame(graph, [outside]);
    expect(before.cells[seamCell.id].adjacentMines).toBe(0);
    expect(before.cells[seamNeighbor].adjacentMines).toBe(0);
    const opened = revealCell(before, seamCell.id, 2000);
    expect(opened.cells[seamNeighbor].revealed).toBe(true);
  });

  it("shares flags and reveals across every visible fragment of a logical cell", () => {
    const fragments = projectBoard(mesh, IDENTITY_ROTATION);
    const splitId = fragments.find(
      (fragment) =>
        fragments.filter((other) => other.cellId === fragment.cellId).length >
        1,
    )!.cellId;
    const parts = fragments.filter((fragment) => fragment.cellId === splitId);
    expect(parts.length).toBeGreaterThan(1);
    let state = toggleFlag(createGame(graph, 42, "split"), parts[0].cellId);
    expect(parts.every((part) => state.cells[part.cellId].flagged)).toBe(true);
    state = revealCell(
      toggleFlag(state, parts[1].cellId),
      parts[1].cellId,
      1000,
    );
    expect(parts.every((part) => state.cells[part.cellId].revealed)).toBe(true);
    expect(parts.map((part) => state.cells[part.cellId])).toEqual(
      parts.map(() => state.cells[splitId]),
    );
  });

  it("keeps mine locations, graph, and cell states unchanged under 3D view rotation", () => {
    const state = revealCell(createGame(graph, 42, "rotation"), 0, 1000);
    const before = JSON.stringify(state);
    const graphBefore = JSON.stringify(
      mesh.cells.map((cell) => cell.neighbors),
    );
    const original = projectBoard(mesh, IDENTITY_ROTATION);
    const rotated = projectBoard(
      mesh,
      dragRotation(IDENTITY_ROTATION, 183, -129),
    );
    expect(rotated.map((fragment) => fragment.path)).not.toEqual(
      original.map((fragment) => fragment.path),
    );
    expect(new Set(rotated.map((fragment) => fragment.cellId)).size).toBe(246);
    expect(JSON.stringify(state)).toBe(before);
    expect(JSON.stringify(mesh.cells.map((cell) => cell.neighbors))).toBe(
      graphBefore,
    );
  });
});
