import { expect, it } from "vitest";
import { createGame, revealCell } from "../game/engine";
import { createHighDegreeMesh } from "./highDegree";
import {
  dragRotation,
  IDENTITY_ROTATION,
  pointInFragment,
  projectBoard,
} from "./projection";
import { faceKey } from "./complex";
import type { ProjectiveMesh, Triangle, Vec2 } from "./types";
import { add, cross, dot, length, normalize } from "./vector";

const kinds = ["heptagonal", "octagonal"] as const;
type Kind = (typeof kinds)[number];
const cache = new Map<string, ProjectiveMesh>();
function meshFor(frequency: number, kind: Kind): ProjectiveMesh {
  const key = `${frequency}:${kind}`;
  if (!cache.has(key)) cache.set(key, createHighDegreeMesh(frequency, kind));
  return cache.get(key)!;
}
const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

it("builds actual seven/eight-sided closed RP² cells with unique reciprocal edge-neighbors", () => {
  for (const frequency of [2, 5, 7, 9, 12])
    for (const kind of kinds) {
      const mesh = meshFor(frequency, kind);
      const target = kind === "heptagonal" ? 7 : 8;
      expect(mesh.cells).toHaveLength(5 * frequency ** 2 + 1);
      expect(mesh.vertices).toHaveLength(10 * frequency ** 2);
      expect(mesh.edges).toHaveLength(15 * frequency ** 2);
      expect(mesh.vertices.length - mesh.edges.length + mesh.cells.length).toBe(
        1,
      );
      const degrees = mesh.cells.map((cell) => cell.polygon.length);
      expect(Math.min(...degrees)).toBeGreaterThanOrEqual(5);
      expect(Math.max(...degrees)).toBe(target);
      expect(
        degrees.filter((degree) => degree === 5).length -
          degrees.filter((degree) => degree === 7).length -
          2 * degrees.filter((degree) => degree === 8).length,
      ).toBe(6);
      const incidences = new Map<string, number[]>();
      const localCells = mesh.vertices.map(() => new Set<number>());
      const localEdges = mesh.vertices.map(() => new Set<string>());
      for (const cell of mesh.cells) {
        expect(new Set(cell.neighbors).size).toBe(cell.polygon.length);
        expect(cell.neighbors).toHaveLength(cell.vertexIds.length);
        expect(new Set(cell.vertexIds).size).toBe(cell.vertexIds.length);
        for (const neighbor of cell.neighbors)
          expect(mesh.cells[neighbor].neighbors).toContain(cell.id);
        cell.vertexIds.forEach((a, index) => {
          localCells[a].add(cell.id);
          const key = edgeKey(
            a,
            cell.vertexIds[(index + 1) % cell.vertexIds.length],
          );
          incidences.set(key, [...(incidences.get(key) ?? []), cell.id]);
        });
      }
      expect(incidences.size).toBe(mesh.edges.length);
      for (const edge of mesh.edges) {
        expect(new Set(incidences.get(edgeKey(...edge.vertices)))).toEqual(
          new Set(edge.cells),
        );
        expect(incidences.get(edgeKey(...edge.vertices))).toHaveLength(2);
        for (const vertex of edge.vertices)
          localEdges[vertex].add(edgeKey(...edge.cells));
      }
      for (let vertex = 0; vertex < mesh.vertices.length; vertex += 1) {
        const cells = [...localCells[vertex]];
        expect(cells).toHaveLength(3);
        expect(localEdges[vertex]).toEqual(
          new Set([
            edgeKey(cells[0], cells[1]),
            edgeKey(cells[1], cells[2]),
            edgeKey(cells[2], cells[0]),
          ]),
        );
      }
    }
});

it("preserves exact antipodal incidence and globally convex positive-area spherical polygons", () => {
  for (const frequency of [5, 7, 9])
    for (const kind of kinds) {
      const mesh = meshFor(frequency, kind);
      const { sphere } = mesh;
      sphere.vertices.forEach((position, id) => {
        const opposite = sphere.vertexAntipodes[id];
        expect(opposite).not.toBe(id);
        expect(sphere.vertexAntipodes[opposite]).toBe(id);
        expect(length(add(position, sphere.vertices[opposite]))).toBeLessThan(
          1e-12,
        );
        expect(mesh.sphereVertexToCell[id]).toBe(
          mesh.sphereVertexToCell[opposite],
        );
      });
      sphere.faces.forEach((face, id) => {
        const opposite = sphere.faceAntipodes[id];
        const mapped = face.map(
          (vertex) => sphere.vertexAntipodes[vertex],
        ) as unknown as Triangle;
        expect(opposite).not.toBe(id);
        expect(sphere.faceAntipodes[opposite]).toBe(id);
        expect(faceKey(mapped)).toBe(faceKey(sphere.faces[opposite]));
        expect(mesh.sphereFaceToVertex[id]).toBe(
          mesh.sphereFaceToVertex[opposite],
        );
      });
      let area = 0;
      for (const cell of mesh.cells) {
        for (let index = 0; index < cell.polygon.length; index += 1) {
          const a = cell.polygon[index];
          const b = cell.polygon[(index + 1) % cell.polygon.length];
          const normal = normalize(cross(a, b));
          expect(
            Math.abs(dot(a, mesh.vertices[cell.vertexIds[index]])),
          ).toBeCloseTo(1, 12);
          expect(dot(normal, cell.center)).toBeGreaterThan(0);
          expect(dot(a, cell.center)).toBeGreaterThan(0);
          // Checking every vertex against every edge distinguishes true convexity
          // from merely having a center inside a concave/star-shaped polygon.
          for (const vertex of cell.polygon)
            expect(dot(normal, vertex)).toBeGreaterThanOrEqual(-1e-10);
          const signedArea =
            2 *
            Math.atan2(
              dot(cell.center, cross(a, b)),
              1 + dot(cell.center, a) + dot(a, b) + dot(b, cell.center),
            );
          expect(signedArea).toBeGreaterThan(0);
          area += signedArea;
        }
      }
      expect(area).toBeCloseTo(2 * Math.PI, 10);
    }
});

it("covers the entire disk without holes or overlap in three rotated views", () => {
  const rotations = [
    IDENTITY_ROTATION,
    dragRotation(IDENTITY_ROTATION, 123, -81),
    dragRotation(IDENTITY_ROTATION, -313, 201),
  ];
  for (const frequency of [5, 7, 9])
    for (const kind of kinds) {
      const mesh = meshFor(frequency, kind);
      for (const rotation of rotations) {
        const fragments = projectBoard(mesh, rotation);
        expect(new Set(fragments.map((fragment) => fragment.cellId)).size).toBe(
          mesh.cells.length,
        );
        expect(
          Math.abs(
            fragments.reduce((sum, fragment) => sum + fragment.area, 0) -
              Math.PI,
          ),
        ).toBeLessThan(0.00015);
        for (const fragment of fragments)
          expect(pointInFragment(fragment.label, fragment)).toBe(true);
        for (let sample = 0; sample < 24; sample += 1) {
          const angle = (sample + 0.173) * Math.PI * (3 - Math.sqrt(5));
          const radius = 0.985 * Math.sqrt((sample + 0.5) / 24);
          const point: Vec2 = [
            Math.cos(angle) * radius,
            Math.sin(angle) * radius,
          ];
          expect(
            fragments.filter((fragment) => pointInFragment(point, fragment)),
          ).toHaveLength(1);
        }
      }
    }
});

it("reproduces a fixed mesh independently of mine seeds and uses its genuine extra neighbors", () => {
  for (const kind of kinds) {
    const mesh = meshFor(7, kind);
    const snapshot = JSON.stringify(mesh);
    expect(JSON.stringify(createHighDegreeMesh(7, kind))).toBe(snapshot);
    const target = kind === "heptagonal" ? 7 : 8;
    const highCell = mesh.cells.find(
      (cell) => cell.neighbors.length === target,
    )!;
    const graph = mesh.cells.map((cell) => cell.neighbors);
    for (const seed of ["seven-eight-a", "seven-eight-b"]) {
      const state = revealCell(createGame(graph, 40, seed), highCell.id, 1000);
      expect(state.cells[highCell.id].adjacentMines).toBe(0);
      for (const neighbor of highCell.neighbors)
        expect(state.cells[neighbor].mine).toBe(false);
      state.cells.forEach((cell, id) => {
        expect(cell.adjacentMines).toBe(
          graph[id].filter((neighbor) => state.cells[neighbor].mine).length,
        );
      });
    }
    projectBoard(mesh, dragRotation(IDENTITY_ROTATION, 100, 70));
    expect(JSON.stringify(mesh)).toBe(snapshot);
  }
});

it("rejects invalid input instead of fabricating a high-degree board", () => {
  for (const invalid of [0, -1, 2.5, NaN, Infinity]) {
    expect(() => createHighDegreeMesh(invalid, "heptagonal")).toThrow();
  }
  expect(() => createHighDegreeMesh(7, "hexagonal" as Kind)).toThrow();
});
