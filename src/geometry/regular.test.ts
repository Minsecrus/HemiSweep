import { describe, expect, it } from "vitest";
import { createRegularMesh, REGULAR_SYMBOLS } from "./regular";
import {
  dragRotation,
  IDENTITY_ROTATION,
  pointInFragment,
  projectBoard,
} from "./projection";
import type { BoardMesh, ProjectiveEdge, Vec2 } from "./types";
import { cross, dot } from "./vector";

const maps = [
  { a: 3, b: 4, vertices: 3, edges: 6, faces: 4, neighbors: 3 },
  { a: 4, b: 3, vertices: 4, edges: 6, faces: 3, neighbors: 2 },
  { a: 3, b: 5, vertices: 6, edges: 15, faces: 10, neighbors: 3 },
  { a: 5, b: 3, vertices: 10, edges: 15, faces: 6, neighbors: 5 },
];

function boundaryDirection(
  mesh: BoardMesh,
  cellId: number,
  edge: ProjectiveEdge,
): number {
  const vertices = mesh.cells[cellId].vertexIds;
  for (let side = 0; side < vertices.length; side += 1) {
    const a = vertices[side];
    const b = vertices[(side + 1) % vertices.length];
    if (a === edge.vertices[0] && b === edge.vertices[1]) return 1;
    if (b === edge.vertices[0] && a === edge.vertices[1]) return -1;
  }
  throw new Error("An edge does not occur in its incident face boundary.");
}

/** A consistent orientation would make every common edge oppositely traversed. */
function isOrientable(mesh: BoardMesh): boolean {
  const orientations = Array<number>(mesh.cells.length).fill(0);
  for (const root of mesh.cells) {
    if (orientations[root.id]) continue;
    orientations[root.id] = 1;
    const queue = [root.id];
    while (queue.length) {
      const current = queue.shift()!;
      for (const edge of mesh.edges.filter((edge) =>
        edge.cells.includes(current),
      )) {
        const neighbor =
          edge.cells[0] === current ? edge.cells[1] : edge.cells[0];
        const required =
          -orientations[current] *
          boundaryDirection(mesh, current, edge) *
          boundaryDirection(mesh, neighbor, edge);
        if (orientations[neighbor] !== 0 && orientations[neighbor] !== required)
          return false;
        if (orientations[neighbor] === 0) {
          orientations[neighbor] = required;
          queue.push(neighbor);
        }
      }
    }
  }
  return true;
}

describe("regular convex antipodal quotients on RP²", () => {
  it("exposes the four supported Schläfli symbols and their actual face counts", () => {
    expect(REGULAR_SYMBOLS.map(({ a, b, faces }) => ({ a, b, faces }))).toEqual(
      maps.map(({ a, b, faces }) => ({ a, b, faces })),
    );
  });

  it.each(maps)(
    "constructs {$a,$b} with V=$vertices, E=$edges and F=$faces",
    ({ a, b, vertices, edges, faces, neighbors }) => {
      const mesh = createRegularMesh(a, b);
      expect(mesh.frequency).toBe(1);
      expect(mesh.vertices).toHaveLength(vertices);
      expect(mesh.edges).toHaveLength(edges);
      expect(mesh.cells).toHaveLength(faces);
      expect(vertices - edges + faces).toBe(1);
      expect(a * faces).toBe(2 * edges);
      expect(b * vertices).toBe(2 * edges);
      for (const cell of mesh.cells) {
        expect(cell.polygon).toHaveLength(a);
        expect(new Set(cell.vertexIds).size).toBe(a);
        expect(cell.neighbors).toHaveLength(neighbors);
        expect(new Set(cell.neighbors).size).toBe(neighbors);
        expect(cell.neighbors).not.toContain(cell.id);
        expect(
          mesh.edges.filter((edge) => edge.cells.includes(cell.id)),
        ).toHaveLength(a);
        for (const neighbor of cell.neighbors)
          expect(mesh.cells[neighbor].neighbors).toContain(cell.id);
        for (let side = 0; side < a; side += 1) {
          const v = cell.vertexIds[side];
          const w = cell.vertexIds[(side + 1) % a];
          const matching = mesh.edges.filter(
            (edge) =>
              edge.cells.includes(cell.id) &&
              edge.vertices.includes(v) &&
              edge.vertices.includes(w),
          );
          expect(matching).toHaveLength(1);
          expect(
            dot(
              cell.center,
              cross(cell.polygon[side], cell.polygon[(side + 1) % a]),
            ),
          ).toBeGreaterThan(0);
          // Polygon lift vertices coincide exactly with one of the two antipodes.
          const representative = mesh.vertices[v];
          const point = cell.polygon[side];
          expect(Math.abs(dot(point, representative))).toBeCloseTo(1, 12);
        }
      }
      for (let vertex = 0; vertex < vertices; vertex += 1) {
        expect(
          mesh.edges.filter((edge) => edge.vertices.includes(vertex)),
        ).toHaveLength(b);
        expect(
          mesh.cells.filter((cell) => cell.vertexIds.includes(vertex)),
        ).toHaveLength(b);
      }
      for (const edge of mesh.edges) {
        expect(edge.cells[0]).not.toBe(edge.cells[1]);
        expect(edge.vertices[0]).not.toBe(edge.vertices[1]);
        for (const incident of edge.cells)
          expect(mesh.cells[incident].vertexIds).toEqual(
            expect.arrayContaining([...edge.vertices]),
          );
      }
      expect(isOrientable(mesh)).toBe(false);
      // Every logical face is reachable, so this is one closed nonorientable surface.
      const visited = new Set([0]);
      const queue = [0];
      while (queue.length)
        for (const neighbor of mesh.cells[queue.shift()!].neighbors) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      expect(visited.size).toBe(faces);
    },
  );

  it("keeps parallel quotient edges instead of collapsing them by endpoint distance or IDs", () => {
    const octahedron = createRegularMesh(3, 4);
    const endpointPairs = octahedron.edges.map((edge) =>
      [...edge.vertices].sort().join(":"),
    );
    expect(new Set(endpointPairs).size).toBe(3);
    expect(endpointPairs).toHaveLength(6);
    const cube = createRegularMesh(4, 3);
    const facePairs = cube.edges.map((edge) =>
      [...edge.cells].sort().join(":"),
    );
    expect(new Set(facePairs).size).toBe(3);
    expect(facePairs).toHaveLength(6);
    for (const cell of cube.cells) {
      expect(cell.polygon).toHaveLength(4);
      expect(cell.neighbors).toHaveLength(2);
    }
  });

  it.each([
    [3, 4],
    [3, 5],
  ])("has the combinatorial dual {%i,%i} with V and F swapped", (a, b) => {
    const primal = createRegularMesh(a, b);
    const dual = createRegularMesh(b, a);
    expect(primal.cells.length).toBe(dual.vertices.length);
    expect(primal.vertices.length).toBe(dual.cells.length);
    expect(primal.edges.length).toBe(dual.edges.length);
    // Dual cell centers are the primal vertex orbits, and conversely.
    for (const cell of dual.cells)
      expect(
        primal.vertices.some(
          (vertex) => Math.abs(dot(vertex, cell.center)) > 1 - 1e-12,
        ),
      ).toBe(true);
    for (const cell of primal.cells)
      expect(
        dual.vertices.some(
          (vertex) => Math.abs(dot(vertex, cell.center)) > 1 - 1e-12,
        ),
      ).toBe(true);
  });

  it.each([
    [3, 3],
    [4, 4],
    [3, 6],
    [6, 3],
    [5, 5],
    [2, 5],
    [3.5, 4],
    [NaN, 3],
  ])(
    "rejects unsupported or invalid {%i,%i} without fabricating a grid",
    (a, b) => {
      expect(() => createRegularMesh(a, b)).toThrow(RangeError);
    },
  );
});

describe("regular maps in the antipodal disk", () => {
  const rotations = [
    IDENTITY_ROTATION,
    dragRotation(IDENTITY_ROTATION, 113, -71),
    dragRotation(IDENTITY_ROTATION, -287, 199),
  ];

  it.each(maps)(
    "covers the disk with every logical face of {$a,$b} after arbitrary rotations",
    ({ a, b, faces }) => {
      const mesh = createRegularMesh(a, b);
      const original = JSON.stringify(mesh);
      for (const rotation of rotations) {
        const fragments = projectBoard(mesh, rotation);
        expect(new Set(fragments.map((fragment) => fragment.cellId)).size).toBe(
          faces,
        );
        expect(
          Math.abs(
            fragments.reduce((sum, fragment) => sum + fragment.area, 0) -
              Math.PI,
          ),
        ).toBeLessThan(0.00015);
        for (const fragment of fragments) {
          expect(
            pointInFragment(fragment.label, fragment),
            JSON.stringify({
              a,
              b,
              rotation,
              key: fragment.key,
              label: fragment.label,
            }),
          ).toBe(true);
          expect(mesh.cells[fragment.cellId]).toBeDefined();
          for (const point of fragment.points)
            expect(Math.hypot(...point)).toBeLessThanOrEqual(1 + 1e-12);
        }
        for (let sample = 0; sample < 180; sample += 1) {
          const angle = 0.371 + sample * Math.PI * (3 - Math.sqrt(5));
          const r = 0.99 * Math.sqrt((sample + 0.5) / 180);
          const point: Vec2 = [Math.cos(angle) * r, Math.sin(angle) * r];
          expect(
            fragments.filter((fragment) => pointInFragment(point, fragment)),
          ).toHaveLength(1);
        }
      }
      expect(JSON.stringify(mesh)).toBe(original);
    },
  );

  it.each(maps)(
    "identifies split boundary fragments as the same logical face for {$a,$b}",
    ({ a, b }) => {
      const mesh = createRegularMesh(a, b);
      const fragments = projectBoard(mesh, rotations[1]);
      const groups = mesh.cells.map((cell) =>
        fragments.filter((fragment) => fragment.cellId === cell.id),
      );
      expect(groups.some((group) => group.length === 2)).toBe(true);
      for (const group of groups.filter((group) => group.length === 2)) {
        const [first, second] = group;
        expect(first.cellId).toBe(second.cellId);
        expect(first.crossesBoundary).toBe(true);
        expect(second.crossesBoundary).toBe(true);
        const perimeterA = first.points.filter(
          (point) => Math.abs(Math.hypot(...point) - 1) < 1e-10,
        );
        const perimeterB = second.points.filter(
          (point) => Math.abs(Math.hypot(...point) - 1) < 1e-10,
        );
        expect(perimeterA.length).toBeGreaterThanOrEqual(2);
        expect(perimeterB).toHaveLength(perimeterA.length);
        for (const point of perimeterA)
          expect(
            perimeterB.some(
              (other) =>
                Math.hypot(point[0] + other[0], point[1] + other[1]) < 1e-10,
            ),
          ).toBe(true);
      }
    },
  );
});
