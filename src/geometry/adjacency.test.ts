import { describe, expect, it } from "vitest";
import { chordCell, createGame, revealCell, toggleFlag } from "../game/engine";
import type { GameState } from "../game/types";
import { createAdjacencyGraph } from "./adjacency";
import { createBoardMesh } from "./tilings";
import type { BoardMesh, GridKind } from "./types";
import { dot } from "./vector";

const triangular = createBoardMesh(7, "triangular");
const quadrilateral = createBoardMesh(7, "quadrilateral");
const cornerBoards = [triangular, quadrilateral];

function placedGame(
  neighbors: number[][],
  mineIds: number[],
  revealedIds: number[] = [],
  flaggedIds: number[] = [],
): GameState {
  const mines = new Set(mineIds);
  const revealed = new Set(revealedIds);
  const flagged = new Set(flaggedIds);
  const ready = createGame(
    neighbors,
    mineIds.length,
    "controlled-corner-fixture",
  );
  return {
    ...ready,
    status: "playing",
    startedAt: 1000,
    firstCell: revealedIds[0] ?? null,
    cells: ready.cells.map((cell, id) => ({
      ...cell,
      mine: mines.has(id),
      adjacentMines: neighbors[id].filter((neighbor) => mines.has(neighbor))
        .length,
      revealed: revealed.has(id),
      flagged: flagged.has(id),
    })),
  };
}

function cornerOnly(mesh: BoardMesh, id: number): number[] {
  const cell = mesh.cells[id];
  return mesh.cells
    .filter(
      (other) =>
        other.id !== id &&
        !cell.neighbors.includes(other.id) &&
        cell.vertexIds.some((vertex) => other.vertexIds.includes(vertex)),
    )
    .map((other) => other.id);
}

describe("edge and quotient-vertex adjacency rules", () => {
  it("has the exact 11/12 triangle and 9/10 quadrilateral point-neighbor counts at k=7", () => {
    const triangleGraph = createAdjacencyGraph(triangular, "vertex");
    expect(triangleGraph.filter((row) => row.length === 11)).toHaveLength(30);
    expect(triangleGraph.filter((row) => row.length === 12)).toHaveLength(460);
    const quadGraph = createAdjacencyGraph(quadrilateral, "vertex");
    expect(quadGraph.filter((row) => row.length === 9)).toHaveLength(30);
    expect(quadGraph.filter((row) => row.length === 10)).toHaveLength(705);
    expect(
      createAdjacencyGraph(triangular, "edge").every((row) => row.length === 3),
    ).toBe(true);
    expect(
      createAdjacencyGraph(quadrilateral, "edge").every(
        (row) => row.length === 4,
      ),
    ).toBe(true);
  });

  it("keeps the rules equal for dual and genuine seven/eight-sided tilings whose vertices have valence three", () => {
    for (const kind of ["dual", "heptagonal", "octagonal"] as GridKind[]) {
      const mesh = createBoardMesh(7, kind);
      expect(createAdjacencyGraph(mesh, "vertex")).toEqual(
        createAdjacencyGraph(mesh, "edge"),
      );
    }
  });

  it("uses exact shared quotient vertices once per logical neighbor, symmetrically across antipodal representatives", () => {
    for (const mesh of cornerBoards) {
      const graph = createAdjacencyGraph(mesh, "vertex");
      let antipodalCornerPairs = 0;
      for (const cell of mesh.cells) {
        const expected = mesh.cells
          .filter(
            (other) =>
              other.id !== cell.id &&
              cell.vertexIds.some((vertex) => other.vertexIds.includes(vertex)),
          )
          .map((other) => other.id);
        expect(graph[cell.id]).toEqual(expected);
        expect(new Set(graph[cell.id]).size).toBe(graph[cell.id].length);
        expect(graph[cell.id]).not.toContain(cell.id);
        for (const neighbor of graph[cell.id])
          expect(graph[neighbor]).toContain(cell.id);
        // An edge-neighbor shares two vertex IDs, but still contributes one mine.
        for (const neighbor of cell.neighbors) {
          expect(
            cell.vertexIds.filter((vertex) =>
              mesh.cells[neighbor].vertexIds.includes(vertex),
            ),
          ).toHaveLength(2);
          expect(graph[cell.id].filter((id) => id === neighbor)).toHaveLength(
            1,
          );
        }
        antipodalCornerPairs += cornerOnly(mesh, cell.id).filter(
          (neighbor) => dot(cell.center, mesh.cells[neighbor].center) < 0,
        ).length;
      }
      expect(antipodalCornerPairs).toBeGreaterThan(0);
    }
  });

  it("returns independent graph rows and leaves a frozen geometric mesh untouched", () => {
    const mesh = structuredClone(triangular);
    const snapshot = JSON.stringify(mesh);
    for (const cell of mesh.cells) {
      Object.freeze(cell.neighbors);
      Object.freeze(cell.vertexIds);
      Object.freeze(cell.polygon);
      Object.freeze(cell);
    }
    Object.freeze(mesh.cells);
    Object.freeze(mesh);
    const edge = createAdjacencyGraph(mesh, "edge");
    const vertex = createAdjacencyGraph(mesh, "vertex");
    const again = createAdjacencyGraph(mesh, "vertex");
    const originalVertexRow = [...vertex[0]];
    for (let id = 0; id < mesh.cells.length; id += 1) {
      expect(edge[id]).not.toBe(mesh.cells[id].neighbors);
      expect(vertex[id]).not.toBe(mesh.cells[id].neighbors);
      expect(vertex[id]).not.toBe(again[id]);
    }
    edge[0].pop();
    vertex[0].pop();
    expect(again[0]).toEqual(originalVertexRow);
    expect(JSON.stringify(mesh)).toBe(snapshot);
  });

  it("counts corner-only mines and protects the complete chosen vertex-neighbor ring on the first click", () => {
    for (const mesh of cornerBoards) {
      const edge = createAdjacencyGraph(mesh, "edge");
      const vertex = createAdjacencyGraph(mesh, "vertex");
      const a = 0;
      const mine = cornerOnly(mesh, a)[0];
      const pointGame = placedGame(vertex, [mine]);
      const edgeGame = placedGame(edge, [mine]);
      expect(pointGame.cells[a].adjacentMines).toBe(1);
      expect(edgeGame.cells[a].adjacentMines).toBe(0);
      const opened = revealCell(
        createGame(
          vertex,
          Math.floor(mesh.cells.length * 0.16),
          "full-point-safe-ring",
        ),
        a,
        1000,
      );
      expect(opened.cells[a].adjacentMines).toBe(0);
      for (const protectedId of [a, ...vertex[a]])
        expect(opened.cells[protectedId].mine).toBe(false);
      for (let id = 0; id < opened.cells.length; id += 1) {
        expect(opened.cells[id].adjacentMines).toBe(
          vertex[id].filter((neighbor) => opened.cells[neighbor].mine).length,
        );
      }
    }
  });

  it("crosses a corner-only relation during zero expansion when all edge exits are flagged", () => {
    for (const mesh of cornerBoards) {
      const edge = createAdjacencyGraph(mesh, "edge");
      const vertex = createAdjacencyGraph(mesh, "vertex");
      const a = 0;
      const b = cornerOnly(mesh, a)[0];
      const start = (graph: number[][]) => {
        let state = createGame(graph, 0, "corner-flood");
        for (const blocked of edge[a]) state = toggleFlag(state, blocked);
        return revealCell(state, a, 1000);
      };
      const pointFlood = start(vertex);
      const edgeFlood = start(edge);
      expect(pointFlood.cells[a].adjacentMines).toBe(0);
      expect(edgeFlood.cells[a].adjacentMines).toBe(0);
      expect(pointFlood.cells[b].revealed).toBe(true);
      expect(edgeFlood.cells[b].revealed).toBe(false);
      for (const blocked of edge[a])
        expect(pointFlood.cells[blocked].revealed).toBe(false);
    }
  });

  it("uses corner-only flags and targets when chording, including a mine exposed by an incorrect flag", () => {
    for (const mesh of cornerBoards) {
      const edge = createAdjacencyGraph(mesh, "edge");
      const vertex = createAdjacencyGraph(mesh, "vertex");
      const a = 0;
      const [mine, safe] = cornerOnly(mesh, a);
      expect(safe).toBeDefined();
      const pointBefore = placedGame(vertex, [mine], [a], [mine]);
      const edgeBefore = placedGame(edge, [mine], [a], [mine]);
      expect(pointBefore.cells[a].adjacentMines).toBe(1);
      expect(edgeBefore.cells[a].adjacentMines).toBe(0);
      expect(pointBefore.cells[safe].revealed).toBe(false);
      const opened = chordCell(pointBefore, a, 2000);
      expect(opened.cells[safe].revealed).toBe(true);
      expect(opened.cells[mine].revealed).toBe(false);
      expect(chordCell(edgeBefore, a, 2000)).toBe(edgeBefore);
      const incorrect = chordCell(
        placedGame(vertex, [mine], [a], [safe]),
        a,
        3000,
      );
      expect(incorrect.status).toBe("lost");
      expect(incorrect.explodedCell).toBe(mine);
    }
  });
});
