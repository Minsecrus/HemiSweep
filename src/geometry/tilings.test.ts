import { describe, expect, it } from "vitest";
import { createGame, revealCell, toggleFlag } from "../game/engine";
import type { GameState } from "../game/types";
import {
  dragRotation,
  IDENTITY_ROTATION,
  pointInFragment,
  projectBoard,
} from "./projection";
import { cellCount, createBoardMesh } from "./tilings";
import { createProjectiveMesh } from "./topology";
import type { BoardMesh, CellFragment, GridKind, Vec2 } from "./types";
import { cross, dot, length } from "./vector";

const kinds: GridKind[] = ["dual", "triangular", "quadrilateral"];
const frequencies = [2, 5, 7, 9, 12];
const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;
const rotations = [
  IDENTITY_ROTATION,
  dragRotation(IDENTITY_ROTATION, 123, -81),
  dragRotation(IDENTITY_ROTATION, -313, 201),
];

interface Incidence {
  cell: number;
  direction: number;
}

/** Reconstruct the cell complex independently from its ordered polygons. */
function polygonIncidences(mesh: BoardMesh): Map<string, Incidence[]> {
  const result = new Map<string, Incidence[]>();
  for (const cell of mesh.cells) {
    for (let index = 0; index < cell.vertexIds.length; index += 1) {
      const a = cell.vertexIds[index];
      const b = cell.vertexIds[(index + 1) % cell.vertexIds.length];
      const key = edgeKey(a, b);
      const pair = result.get(key) ?? [];
      pair.push({ cell: cell.id, direction: a < b ? 1 : -1 });
      result.set(key, pair);
    }
  }
  return result;
}

function expectedCounts(frequency: number, kind: GridKind) {
  const square = frequency ** 2;
  if (kind === "triangular")
    return { cells: 10 * square, edges: 15 * square, vertices: 5 * square + 1 };
  if (kind === "quadrilateral")
    return {
      cells: 15 * square,
      edges: 30 * square,
      vertices: 15 * square + 1,
    };
  return { cells: 5 * square + 1, edges: 15 * square, vertices: 10 * square };
}

/** Around each vertex, an incident polygon joins its two incident edges. */
function vertexLinks(mesh: BoardMesh): Map<string, string[]>[] {
  const links = mesh.vertices.map(() => new Map<string, string[]>());
  for (const cell of mesh.cells) {
    const count = cell.vertexIds.length;
    for (let index = 0; index < count; index += 1) {
      const vertex = cell.vertexIds[index];
      const before = edgeKey(
        cell.vertexIds[(index + count - 1) % count],
        vertex,
      );
      const after = edgeKey(vertex, cell.vertexIds[(index + 1) % count]);
      const link = links[vertex];
      link.set(before, [...(link.get(before) ?? []), after]);
      link.set(after, [...(link.get(after) ?? []), before]);
    }
  }
  return links;
}

function fragmentGroups(
  fragments: CellFragment[],
): Map<number, CellFragment[]> {
  const groups = new Map<number, CellFragment[]>();
  for (const fragment of fragments) {
    groups.set(fragment.cellId, [
      ...(groups.get(fragment.cellId) ?? []),
      fragment,
    ]);
  }
  return groups;
}

function placedGame(mesh: BoardMesh, mineIds: number[]): GameState {
  const neighbors = mesh.cells.map((cell) => cell.neighbors);
  const mineSet = new Set(mineIds);
  const ready = createGame(neighbors, mineIds.length, "tiling-fixture");
  return {
    ...ready,
    status: "playing",
    startedAt: 1000,
    cells: ready.cells.map((cell, id) => ({
      ...cell,
      mine: mineSet.has(id),
      adjacentMines: neighbors[id].filter((neighbor) => mineSet.has(neighbor))
        .length,
    })),
  };
}

describe.each(kinds)("%s projective tiling", (kind) => {
  describe.each(frequencies)("frequency %i", (frequency) => {
    const mesh = createBoardMesh(frequency, kind);
    const counts = expectedCounts(frequency, kind);
    const incidences = polygonIncidences(mesh);

    it("has exact quotient counts and Euler characteristic one", () => {
      expect(mesh.frequency).toBe(frequency);
      expect(mesh.cells).toHaveLength(counts.cells);
      expect(cellCount(frequency, kind)).toBe(counts.cells);
      expect(mesh.edges).toHaveLength(counts.edges);
      expect(mesh.vertices).toHaveLength(counts.vertices);
      expect(mesh.vertices.length - mesh.edges.length + mesh.cells.length).toBe(
        1,
      );
      expect(mesh.cells.map((cell) => cell.id)).toEqual(
        mesh.cells.map((_, id) => id),
      );
      expect(mesh.edges.map((edge) => edge.id)).toEqual(
        mesh.edges.map((_, id) => id),
      );
      if (kind === "dual") {
        expect(
          mesh.cells.filter((cell) => cell.polygon.length === 5),
        ).toHaveLength(6);
        expect(
          mesh.cells.filter((cell) => cell.polygon.length === 6),
        ).toHaveLength(counts.cells - 6);
      } else {
        const sides = kind === "triangular" ? 3 : 4;
        expect(mesh.cells.every((cell) => cell.polygon.length === sides)).toBe(
          true,
        );
        expect(
          mesh.cells.every((cell) => cell.neighbors.length === sides),
        ).toBe(true);
      }
    });

    it("derives its reciprocal neighbors from exactly two polygon incidences per edge", () => {
      expect(incidences.size).toBe(mesh.edges.length);
      const edgeKeys = new Set(
        mesh.edges.map((edge) => edgeKey(...edge.vertices)),
      );
      expect(edgeKeys.size).toBe(mesh.edges.length);
      const expectedNeighbors = mesh.cells.map(() => new Set<number>());
      for (const edge of mesh.edges) {
        expect(edge.vertices[0]).not.toBe(edge.vertices[1]);
        expect(edge.cells[0]).not.toBe(edge.cells[1]);
        const pair = incidences.get(edgeKey(...edge.vertices));
        expect(pair).toHaveLength(2);
        expect(new Set(pair!.map((incidence) => incidence.cell))).toEqual(
          new Set(edge.cells),
        );
        const [first, second] = pair!.map(
          (incidence) => mesh.cells[incidence.cell],
        );
        const liftSigns = edge.vertices.map((vertex) =>
          dot(
            first.polygon[first.vertexIds.indexOf(vertex)],
            second.polygon[second.vertexIds.indexOf(vertex)],
          ),
        );
        // Both ends use the same lift sign, so neighboring cells share an actual
        // minor great-circle arc rather than only sharing abstract vertex IDs.
        expect(liftSigns[0] * liftSigns[1]).toBeCloseTo(1, 12);
        expectedNeighbors[edge.cells[0]].add(edge.cells[1]);
        expectedNeighbors[edge.cells[1]].add(edge.cells[0]);
      }
      for (const cell of mesh.cells) {
        expect(cell.vertexIds).toHaveLength(cell.polygon.length);
        expect(new Set(cell.vertexIds).size).toBe(cell.vertexIds.length);
        expect(new Set(cell.neighbors).size).toBe(cell.neighbors.length);
        expect(cell.neighbors).toHaveLength(cell.polygon.length);
        expect(new Set(cell.neighbors)).toEqual(expectedNeighbors[cell.id]);
        expect(cell.neighbors).not.toContain(cell.id);
        for (const neighbor of cell.neighbors)
          expect(mesh.cells[neighbor].neighbors).toContain(cell.id);
      }
    });

    it("has a single circular local link at every vertex, without boundaries or singularities", () => {
      const links = vertexLinks(mesh);
      const valences = new Map<number, number>();
      for (const link of links) {
        valences.set(link.size, (valences.get(link.size) ?? 0) + 1);
        expect(link.size).toBeGreaterThanOrEqual(3);
        for (const [edge, adjacent] of link) {
          expect(adjacent).toHaveLength(2);
          expect(new Set(adjacent).size).toBe(2);
          expect(adjacent).not.toContain(edge);
        }
        const start = link.keys().next().value!;
        const visited = new Set([start]);
        const queue = [start];
        for (let index = 0; index < queue.length; index += 1) {
          for (const neighbor of link.get(queue[index])!) {
            if (!visited.has(neighbor)) {
              visited.add(neighbor);
              queue.push(neighbor);
            }
          }
        }
        expect(visited.size).toBe(link.size);
      }
      if (kind === "dual")
        expect(valences).toEqual(new Map([[3, counts.vertices]]));
      if (kind === "triangular") {
        expect(valences).toEqual(
          new Map([
            [5, 6],
            [6, 5 * frequency ** 2 - 5],
          ]),
        );
      }
      if (kind === "quadrilateral") {
        expect(valences).toEqual(
          new Map([
            [3, 10 * frequency ** 2],
            [5, 6],
            [6, 5 * frequency ** 2 - 5],
          ]),
        );
      }
    });

    it("is connected and has an obstruction to any consistent global orientation", () => {
      const graph = mesh.cells.map(
        () => [] as { neighbor: number; factor: number }[],
      );
      for (const pair of incidences.values()) {
        expect(pair).toHaveLength(2);
        const [a, b] = pair;
        const factor = -a.direction * b.direction;
        graph[a.cell].push({ neighbor: b.cell, factor });
        graph[b.cell].push({ neighbor: a.cell, factor });
      }
      const orientations = new Map([[0, 1]]);
      const queue = [0];
      let obstruction = false;
      for (let index = 0; index < queue.length; index += 1) {
        for (const { neighbor, factor } of graph[queue[index]]) {
          const next = orientations.get(queue[index])! * factor;
          const previous = orientations.get(neighbor);
          if (previous === undefined) {
            orientations.set(neighbor, next);
            queue.push(neighbor);
          } else if (previous !== next) obstruction = true;
        }
      }
      expect(orientations.size).toBe(mesh.cells.length);
      expect(obstruction).toBe(true);
    });

    it("uses unit antipodal vertex representatives and positively tiles spherical area 2π", () => {
      for (const vertex of mesh.vertices)
        expect(length(vertex)).toBeCloseTo(1, 12);
      let area = 0;
      for (const cell of mesh.cells) {
        expect(length(cell.center)).toBeCloseTo(1, 12);
        for (let index = 0; index < cell.polygon.length; index += 1) {
          const a = cell.polygon[index];
          const b = cell.polygon[(index + 1) % cell.polygon.length];
          expect(length(a)).toBeCloseTo(1, 12);
          expect(
            Math.abs(dot(a, mesh.vertices[cell.vertexIds[index]])),
          ).toBeCloseTo(1, 12);
          const numerator = dot(cell.center, cross(a, b));
          expect(numerator).toBeGreaterThan(0);
          const denominator =
            1 + dot(cell.center, a) + dot(a, b) + dot(b, cell.center);
          const triangleArea = 2 * Math.atan2(numerator, denominator);
          expect(triangleArea).toBeGreaterThan(0);
          area += triangleArea;
        }
      }
      expect(area).toBeCloseTo(2 * Math.PI, 10);
    });

    it("covers the disk in three rotated views and retains exactly one logical cell per interior probe", () => {
      const original = JSON.stringify(mesh);
      for (const rotation of rotations) {
        const fragments = projectBoard(mesh, rotation);
        expect(new Set(fragments.map((fragment) => fragment.cellId)).size).toBe(
          counts.cells,
        );
        expect(
          Math.abs(
            fragments.reduce((sum, fragment) => sum + fragment.area, 0) -
              Math.PI,
          ),
        ).toBeLessThan(0.00015);
        for (const fragment of fragments) {
          expect(pointInFragment(fragment.label, fragment)).toBe(true);
          expect(
            fragment.points.every((point) => Math.hypot(...point) <= 1 + 1e-12),
          ).toBe(true);
          expect(fragment.path.endsWith(" Z")).toBe(true);
        }
        const samples = frequency === 12 ? 12 : 36;
        for (let sample = 0; sample < samples; sample += 1) {
          const angle = (sample + 0.173) * Math.PI * (3 - Math.sqrt(5));
          const radius = 0.985 * Math.sqrt((sample + 0.5) / samples);
          const point: Vec2 = [
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
          ];
          expect(
            fragments.filter((fragment) => pointInFragment(point, fragment)),
          ).toHaveLength(1);
        }
      }
      expect(JSON.stringify(mesh)).toBe(original);
    });
  });

  describe("gameplay on identified edges", () => {
    const mesh = createBoardMesh(5, kind);
    const graph = mesh.cells.map((cell) => cell.neighbors);
    const seam = mesh.edges.find(
      (edge) =>
        dot(
          mesh.cells[edge.cells[0]].center,
          mesh.cells[edge.cells[1]].center,
        ) < 0,
    )!;
    const [a, b] = seam.cells;

    it("pairs every split fragment with the exact antipodal equatorial arc", () => {
      const groups = fragmentGroups(projectBoard(mesh, rotations[1]));
      const split = [...groups.values()].filter((group) => group.length === 2);
      expect(split.length).toBeGreaterThan(0);
      for (const [first, second] of split) {
        const boundaryA = first.points.filter(
          (point) => Math.abs(Math.hypot(...point) - 1) < 1e-10,
        );
        const boundaryB = second.points.filter(
          (point) => Math.abs(Math.hypot(...point) - 1) < 1e-10,
        );
        expect(boundaryA.length).toBeGreaterThanOrEqual(2);
        expect(boundaryB).toHaveLength(boundaryA.length);
        for (const point of boundaryA) {
          expect(
            boundaryB.some(
              (other) =>
                Math.hypot(point[0] + other[0], point[1] + other[1]) < 1e-10,
            ),
          ).toBe(true);
        }
      }
    });

    it("counts a mine and floods empty cells through actual antipodal seam adjacency", () => {
      expect(dot(mesh.cells[a].center, mesh.cells[b].center)).toBeLessThan(0);
      const numbered = revealCell(placedGame(mesh, [b]), a, 2000);
      expect(numbered.cells[a].adjacentMines).toBe(1);
      expect(toggleFlag(numbered, b).cells[b].flagged).toBe(true);
      const outside = mesh.cells.find(
        (cell) => ![a, b, ...graph[a], ...graph[b]].includes(cell.id),
      )!.id;
      const before = placedGame(mesh, [outside]);
      expect(before.cells[a].adjacentMines).toBe(0);
      expect(before.cells[b].adjacentMines).toBe(0);
      const flooded = revealCell(before, a, 3000);
      expect(flooded.cells[a].revealed).toBe(true);
      expect(flooded.cells[b].revealed).toBe(true);
    });

    it("shares flags and reveals between seam fragments while rotation preserves all game state", () => {
      const groups = fragmentGroups(projectBoard(mesh, rotations[1]));
      const parts = [...groups.values()].find((group) => group.length === 2)!;
      expect(parts).toHaveLength(2);
      expect(parts.every((part) => part.crossesBoundary)).toBe(true);
      let state = toggleFlag(
        createGame(
          graph,
          Math.floor(mesh.cells.length * 0.16),
          `split-${kind}`,
        ),
        parts[0].cellId,
      );
      for (const part of parts)
        expect(state.cells[part.cellId].flagged).toBe(true);
      state = revealCell(
        toggleFlag(state, parts[1].cellId),
        parts[1].cellId,
        1000,
      );
      for (const part of parts) {
        expect(state.cells[part.cellId]).toBe(state.cells[parts[0].cellId]);
        expect(state.cells[part.cellId].revealed).toBe(true);
      }
      const snapshot = JSON.stringify(state);
      const originalPaths = projectBoard(mesh, rotations[0]).map(
        (fragment) => fragment.path,
      );
      const rotated = projectBoard(mesh, rotations[2]);
      expect(rotated.map((fragment) => fragment.path)).not.toEqual(
        originalPaths,
      );
      expect(new Set(rotated.map((fragment) => fragment.cellId)).size).toBe(
        mesh.cells.length,
      );
      expect(JSON.stringify(state)).toBe(snapshot);
      expect(state.neighbors).toEqual(graph);
    });

    it("supports first-click protection, victory and defeat on this neighbor degree", () => {
      const mineCount = Math.floor(mesh.cells.length * 0.16);
      const playing = revealCell(
        createGame(graph, mineCount, `rules-${kind}`),
        a,
        1000,
      );
      for (const safe of [a, ...graph[a]])
        expect(playing.cells[safe].mine).toBe(false);
      expect(playing.cells[a].adjacentMines).toBe(0);
      expect(playing.cells.filter((cell) => cell.mine)).toHaveLength(mineCount);
      const firstMine = playing.cells.findIndex((cell) => cell.mine);
      expect(revealCell(playing, firstMine, 2000).status).toBe("lost");
      let won = playing;
      for (let id = 0; id < won.cells.length; id += 1) {
        if (!won.cells[id].mine) won = revealCell(won, id, 3000);
      }
      expect(won.status).toBe("won");
      expect(won.cells.every((cell) => cell.mine || cell.revealed)).toBe(true);
    });
  });
});

describe("tiling selection and frequencies", () => {
  it.each(kinds)("returns the documented cell-count formula for %s", (kind) => {
    for (const frequency of [1, 2, 5, 7, 9, 12, 19]) {
      expect(cellCount(frequency, kind)).toBe(
        expectedCounts(frequency, kind).cells,
      );
    }
  });

  it("retains the existing exact dual complex", () => {
    const board = createBoardMesh(5, "dual");
    const original = createProjectiveMesh(5);
    expect(board.cells).toEqual(original.cells);
    expect(board.vertices).toEqual(original.vertices);
    expect(board.edges).toEqual(original.edges);
  });

  it.each(kinds)(
    "rejects noninteger and nonpositive frequencies for %s",
    (kind) => {
      for (const invalid of [0, -1, 2.5, NaN, Infinity]) {
        expect(() => cellCount(invalid, kind)).toThrow(RangeError);
        expect(() => createBoardMesh(invalid, kind)).toThrow(RangeError);
      }
    },
  );

  it("rejects unknown tiling kinds at the runtime boundary", () => {
    const invalid = "square" as GridKind;
    expect(() => cellCount(5, invalid)).toThrow();
    expect(() => createBoardMesh(5, invalid)).toThrow();
  });
});
