import { describe, expect, it } from "vitest";
import { createAdjacencyGraph } from "../geometry/adjacency";
import { createBoardMesh } from "../geometry/tilings";
import { createGame, revealCell } from "./engine";
import { solveFrom } from "./solver";

describe("no-guess solver", () => {
  it("clears a board that follows from the clues", () => {
    const path = [[1], [0, 2], [1]];
    expect(solveFrom(path, [false, false, true], 0)).toMatchObject({
      solved: true,
      revealed: 2,
    });
  });

  it("reports a genuine fifty-fifty as stuck", () => {
    const fork = [[1, 2], [0], [0]];
    expect(solveFrom(fork, [false, true, false], 0)).toEqual({
      solved: false,
      revealed: 1,
      stuck: [1, 2],
    });
  });

  it("uses the global mine count", () => {
    // Cell 2 touches no clue; it is safe only because the one mine is found.
    const graph = [[1], [0], []];
    expect(solveFrom(graph, [false, true, false], 0)).toMatchObject({
      solved: true,
      revealed: 2,
    });
  });
});

describe("no-guess generation", () => {
  const graph = createAdjacencyGraph(createBoardMesh(5, "dual"), "edge");
  const mineCount = Math.ceil(graph.length * 0.25);

  it.each(["a", "b", "c", "d", "e"])(
    "produces a board solvable from the first click (seed %s)",
    (seed) => {
      const ready = createGame(graph, mineCount, seed, { noGuess: true });
      const game = revealCell(ready, 17, 1000);
      expect(game.noGuess).toBe(true);
      const mines = game.cells.map((cell) => cell.mine);
      expect(mines.filter(Boolean)).toHaveLength(mineCount);
      expect(solveFrom(graph, mines, 17).solved).toBe(true);
    },
  );

  it("is reproducible for a seed and first cell", () => {
    const layout = () =>
      revealCell(
        createGame(graph, mineCount, "repeat", { noGuess: true }),
        40,
        0,
      ).cells.map((cell) => cell.mine);
    expect(layout()).toEqual(layout());
  });

  it("leaves plain boards unchanged when disabled", () => {
    const plain = revealCell(createGame(graph, mineCount, "off"), 40, 0);
    expect(plain.noGuess).toBe(false);
  });
});
