import { describe, expect, it } from "vitest";
import { faceKey } from "./complex";
import { createProjectiveMesh } from "./topology";
import type { ProjectiveMesh, Triangle } from "./types";
import { cross, dot, length, add, subtract } from "./vector";

const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

interface Incidence {
  cell: number;
  direction: number;
}

function polygonIncidences(mesh: ProjectiveMesh): Map<string, Incidence[]> {
  const incidences = new Map<string, Incidence[]>();
  for (const cell of mesh.cells) {
    cell.vertexIds.forEach((a, index) => {
      const b = cell.vertexIds[(index + 1) % cell.vertexIds.length];
      const key = edgeKey(a, b);
      const incidence = { cell: cell.id, direction: a < b ? 1 : -1 };
      const previous = incidences.get(key);
      if (previous) previous.push(incidence);
      else incidences.set(key, [incidence]);
    });
  }
  return incidences;
}

function isCyclicEqual(a: Triangle, b: Triangle): boolean {
  return a.some((_, offset) =>
    a.every((vertex, index) => vertex === b[(index + offset) % 3]),
  );
}

describe.each([1, 2, 5, 7, 9])(
  "antipodal icosahedral dual, frequency %i",
  (frequency) => {
    const mesh = createProjectiveMesh(frequency);
    const { sphere } = mesh;
    const incidences = polygonIncidences(mesh);

    it("has the exact closed projective-plane counts and Euler characteristic", () => {
      expect(sphere.vertices).toHaveLength(10 * frequency ** 2 + 2);
      expect(sphere.faces).toHaveLength(20 * frequency ** 2);
      expect(mesh.cells).toHaveLength(5 * frequency ** 2 + 1);
      expect(mesh.vertices).toHaveLength(10 * frequency ** 2);
      expect(mesh.edges).toHaveLength(15 * frequency ** 2);
      expect(mesh.vertices.length - mesh.edges.length + mesh.cells.length).toBe(
        1,
      );
      expect(
        mesh.cells.filter((cell) => cell.polygon.length === 5),
      ).toHaveLength(6);
      expect(
        mesh.cells.filter((cell) => cell.polygon.length === 6),
      ).toHaveLength(mesh.cells.length - 6);
    });

    it("identifies vertices and faces by a free, incidence-preserving antipodal involution", () => {
      sphere.vertices.forEach((position, id) => {
        const opposite = sphere.vertexAntipodes[id];
        expect(opposite).not.toBe(id);
        expect(sphere.vertexAntipodes[opposite]).toBe(id);
        expect(length(add(position, sphere.vertices[opposite]))).toBeLessThan(
          1e-12,
        );
        expect(length(position)).toBeCloseTo(1, 12);
        expect(mesh.sphereVertexToCell[opposite]).toBe(
          mesh.sphereVertexToCell[id],
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
        const reversed: Triangle = [mapped[0], mapped[2], mapped[1]];
        expect(isCyclicEqual(reversed, sphere.faces[opposite])).toBe(true);
        expect(mesh.sphereFaceToVertex[opposite]).toBe(
          mesh.sphereFaceToVertex[id],
        );
        const [a, b, c] = face.map((vertex) => sphere.vertices[vertex]);
        expect(dot(a, cross(subtract(b, a), subtract(c, a)))).toBeGreaterThan(
          0,
        );
      });
    });

    it("glues every sphere edge with exactly one antipodal edge and two incident faces", () => {
      const sphereEdges = new Map<
        string,
        { endpoints: [number, number]; faces: number[] }
      >();
      sphere.faces.forEach((face, faceId) => {
        face.forEach((a, index) => {
          const b = face[(index + 1) % 3];
          const key = edgeKey(a, b);
          const previous = sphereEdges.get(key);
          if (previous) previous.faces.push(faceId);
          else sphereEdges.set(key, { endpoints: [a, b], faces: [faceId] });
        });
      });
      expect(sphereEdges.size).toBe(30 * frequency ** 2);
      expect(
        sphere.vertices.length - sphereEdges.size + sphere.faces.length,
      ).toBe(2);
      for (const [key, edge] of sphereEdges) {
        expect(edge.faces).toHaveLength(2);
        const [a, b] = edge.endpoints;
        const antipodalKey = edgeKey(
          sphere.vertexAntipodes[a],
          sphere.vertexAntipodes[b],
        );
        expect(antipodalKey).not.toBe(key);
        const opposite = sphereEdges.get(antipodalKey);
        expect(opposite).toBeDefined();
        expect(new Set(opposite!.faces)).toEqual(
          new Set(edge.faces.map((face) => sphere.faceAntipodes[face])),
        );
      }
    });

    it("derives reciprocal adjacency from the actual closed polygon edge incidences", () => {
      expect(incidences.size).toBe(mesh.edges.length);
      const edgesByCells = new Map(
        mesh.edges.map((edge) => [edgeKey(...edge.cells), edge]),
      );
      expect(edgesByCells.size).toBe(mesh.edges.length);
      for (const edge of mesh.edges) {
        const incidencesForEdge = incidences.get(edgeKey(...edge.vertices));
        expect(incidencesForEdge).toHaveLength(2);
        expect(
          new Set(incidencesForEdge!.map((incidence) => incidence.cell)),
        ).toEqual(new Set(edge.cells));
      }
      for (const cell of mesh.cells) {
        expect([5, 6]).toContain(cell.neighbors.length);
        expect(cell.neighbors.length).toBe(cell.polygon.length);
        expect(new Set(cell.neighbors).size).toBe(cell.neighbors.length);
        expect(new Set(cell.vertexIds).size).toBe(cell.vertexIds.length);
        expect(cell.neighbors).not.toContain(cell.id);
        for (const neighbor of cell.neighbors) {
          expect(mesh.cells[neighbor].neighbors).toContain(cell.id);
          expect(edgesByCells.has(edgeKey(cell.id, neighbor))).toBe(true);
        }
        cell.vertexIds.forEach((_, index) => {
          const normal = cross(
            cell.polygon[index],
            cell.polygon[(index + 1) % cell.polygon.length],
          );
          expect(dot(normal, cell.center)).toBeGreaterThan(0);
        });
      }
    });

    it("has a single circular local link at every quotient dual vertex", () => {
      const localCells = mesh.vertices.map(() => new Set<number>());
      for (const cell of mesh.cells) {
        for (const vertex of cell.vertexIds) localCells[vertex].add(cell.id);
      }
      const localEdges = mesh.vertices.map(() => new Set<string>());
      for (const edge of mesh.edges) {
        for (const vertex of edge.vertices)
          localEdges[vertex].add(edgeKey(...edge.cells));
      }
      localCells.forEach((cells, vertex) => {
        expect(cells.size).toBe(3);
        expect(localEdges[vertex].size).toBe(3);
        const cellArray = [...cells];
        expect(localEdges[vertex]).toEqual(
          new Set([
            edgeKey(cellArray[0], cellArray[1]),
            edgeKey(cellArray[1], cellArray[2]),
            edgeKey(cellArray[2], cellArray[0]),
          ]),
        );
      });
    });

    it("matches quotient vertex representatives and tiles exactly one hemisphere of area", () => {
      let area = 0;
      for (const cell of mesh.cells) {
        cell.polygon.forEach((a, index) => {
          const representative = mesh.vertices[cell.vertexIds[index]];
          expect(Math.abs(dot(a, representative))).toBeCloseTo(1, 12);
          const b = cell.polygon[(index + 1) % cell.polygon.length];
          // Exact spherical triangle solid angle, with unit sphere area 4π.
          const numerator = dot(cell.center, cross(a, b));
          const denominator =
            1 + dot(cell.center, a) + dot(a, b) + dot(b, cell.center);
          const triangleArea = 2 * Math.atan2(numerator, denominator);
          expect(triangleArea).toBeGreaterThan(0);
          area += triangleArea;
        });
      }
      expect(area).toBeCloseTo(2 * Math.PI, 11);
    });

    it("is connected and has the orientation obstruction of RP²", () => {
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
      const orientations = new Map<number, number>([[0, 1]]);
      const queue = [0];
      let obstruction = false;
      for (let index = 0; index < queue.length; index += 1) {
        const cell = queue[index];
        for (const { neighbor, factor } of graph[cell]) {
          const orientation = orientations.get(cell)! * factor;
          const previous = orientations.get(neighbor);
          if (previous === undefined) {
            orientations.set(neighbor, orientation);
            queue.push(neighbor);
          } else if (previous !== orientation) obstruction = true;
        }
      }
      expect(orientations.size).toBe(mesh.cells.length);
      expect(obstruction).toBe(true);
    });

    it("retains true neighbors whose chosen sphere representatives lie on opposite sides", () => {
      const antipodallyJoinedEdges = mesh.edges.filter(
        (edge) =>
          dot(
            mesh.cells[edge.cells[0]].center,
            mesh.cells[edge.cells[1]].center,
          ) < 0,
      );
      expect(antipodallyJoinedEdges.length).toBeGreaterThan(0);
      for (const {
        cells: [a, b],
      } of antipodallyJoinedEdges) {
        expect(mesh.cells[a].neighbors).toContain(b);
        expect(mesh.cells[b].neighbors).toContain(a);
        // The closest spherical representatives are antipodes, yet incidence is unchanged.
        expect(dot(mesh.cells[a].center, mesh.cells[b].center)).toBeLessThan(0);
      }
    });
  },
);

it("rejects noninteger and nonpositive subdivision frequencies", () => {
  for (const invalid of [0, -1, 2.5, NaN, Infinity]) {
    expect(() => createProjectiveMesh(invalid)).toThrow(RangeError);
  }
});
