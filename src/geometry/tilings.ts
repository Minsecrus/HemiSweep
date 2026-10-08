import { createSphereMesh } from "./sphere";
import { createProjectiveMesh } from "./topology";
import { createHighDegreeMesh } from "./highDegree";
import type {
  BoardCell,
  BoardMesh,
  GridKind,
  ProjectiveEdge,
  SphereMesh,
  Vec3,
} from "./types";
import { add, cross, dot, normalize } from "./vector";

export type { GridKind } from "./types";

interface SphereEdge {
  endpoints: readonly [number, number];
  faces: number[];
}

interface QuotientPoints {
  points: Vec3[];
  representatives: number[];
  sphereToQuotient: number[];
}

const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

function validateFrequency(frequency: number): void {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new RangeError("Subdivision frequency must be a positive integer.");
  }
}

/** Number of logical cells, independent of projection and observer rotation. */
export function cellCount(frequency: number, kind: GridKind): number {
  validateFrequency(frequency);
  switch (kind) {
    case "dual":
    case "heptagonal":
    case "octagonal":
      return 5 * frequency ** 2 + 1;
    case "triangular":
      return 10 * frequency ** 2;
    case "quadrilateral":
      return 15 * frequency ** 2;
    default:
      throw new RangeError(`Unknown tiling kind: ${String(kind)}`);
  }
}

/** Reuse exact combinatorial antipodes; point coordinates never define classes. */
function quotientPoints(
  points: readonly Vec3[],
  antipodes: readonly number[],
): QuotientPoints {
  const sphereToQuotient = Array<number>(points.length).fill(-1);
  const representatives: number[] = [];
  const quotient: Vec3[] = [];
  points.forEach((point, id) => {
    if (sphereToQuotient[id] !== -1) return;
    sphereToQuotient[id] = quotient.length;
    sphereToQuotient[antipodes[id]] = quotient.length;
    representatives.push(id);
    quotient.push(point);
  });
  return { points: quotient, representatives, sphereToQuotient };
}

function collectSphereEdges(sphere: SphereMesh): Map<string, SphereEdge> {
  const result = new Map<string, SphereEdge>();
  sphere.faces.forEach((face, faceId) => {
    face.forEach((a, index) => {
      const b = face[(index + 1) % 3];
      const key = edgeKey(a, b);
      const previous = result.get(key);
      if (previous) previous.faces.push(faceId);
      else
        result.set(key, {
          endpoints: a < b ? [a, b] : [b, a],
          faces: [faceId],
        });
    });
  });
  return result;
}

/**
 * Reconstruct the quotient cell complex from its polygon cycles. Only vertex
 * labels identify edges, and every edge has exactly two distinct incident cells.
 */
function buildQuotientEdges(cells: BoardCell[]): ProjectiveEdge[] {
  const incidences = new Map<
    string,
    { vertices: readonly [number, number]; cells: number[] }
  >();
  for (const cell of cells) {
    cell.vertexIds.forEach((a, index) => {
      const b = cell.vertexIds[(index + 1) % cell.vertexIds.length];
      if (a === b)
        throw new Error("A quotient polygon cannot have a collapsed edge.");
      const key = edgeKey(a, b);
      const previous = incidences.get(key);
      if (previous) previous.cells.push(cell.id);
      else incidences.set(key, { vertices: [a, b], cells: [cell.id] });
    });
  }
  const edges: ProjectiveEdge[] = [];
  for (const { vertices, cells: incident } of incidences.values()) {
    if (incident.length !== 2 || incident[0] === incident[1]) {
      throw new Error(
        "Each quotient edge must have two distinct incident cells.",
      );
    }
    const [a, b] = incident;
    edges.push({ id: edges.length, vertices, cells: [a, b] });
    cells[a].neighbors.push(b);
    cells[b].neighbors.push(a);
  }
  for (const cell of cells) {
    if (new Set(cell.neighbors).size !== cell.neighbors.length) {
      throw new Error("Two quotient cells cannot share more than one edge.");
    }
    cell.neighbors.sort((a, b) => a - b);
  }
  return edges;
}

function faceCenters(sphere: SphereMesh): Vec3[] {
  return sphere.faces.map(([a, b, c]) =>
    normalize(
      add(add(sphere.vertices[a], sphere.vertices[b]), sphere.vertices[c]),
    ),
  );
}

function triangularMesh(sphere: SphereMesh): BoardMesh {
  const vertexClasses = quotientPoints(sphere.vertices, sphere.vertexAntipodes);
  const centers = faceCenters(sphere);
  const faceClasses = quotientPoints(centers, sphere.faceAntipodes);
  const cells: BoardCell[] = faceClasses.representatives.map((faceId, id) => ({
    id,
    center: centers[faceId],
    polygon: sphere.faces[faceId].map((vertex) => sphere.vertices[vertex]),
    vertexIds: sphere.faces[faceId].map(
      (vertex) => vertexClasses.sphereToQuotient[vertex],
    ),
    neighbors: [],
  }));
  const edges = buildQuotientEdges(cells);
  return {
    frequency: sphere.frequency,
    cells,
    vertices: vertexClasses.points,
    edges,
  };
}

/**
 * In each primal triangle, join its normalized face center to its three corners.
 * Pair the resulting triangle sectors across each original edge: their union is
 * a spherical quadrilateral [corner, face center, corner, other face center].
 * The resulting quadrangulation is antipodally invariant before taking its
 * quotient. It is a distinct cell complex, not a drawing of the dual hexagons.
 */
function quadrilateralMesh(sphere: SphereMesh): BoardMesh {
  const vertexClasses = quotientPoints(sphere.vertices, sphere.vertexAntipodes);
  const centers = faceCenters(sphere);
  const faceClasses = quotientPoints(centers, sphere.faceAntipodes);
  const faceOffset = vertexClasses.points.length;
  const sphereEdges = collectSphereEdges(sphere);
  const processed = new Set<string>();
  const cells: BoardCell[] = [];

  for (const [key, edge] of sphereEdges) {
    if (processed.has(key)) continue;
    const [a, b] = edge.endpoints;
    const antipodalKey = edgeKey(
      sphere.vertexAntipodes[a],
      sphere.vertexAntipodes[b],
    );
    const opposite = sphereEdges.get(antipodalKey);
    if (
      !opposite ||
      edge.faces.length !== 2 ||
      opposite.faces.length !== 2 ||
      key === antipodalKey
    ) {
      throw new Error("The spherical edge quotient must be a free involution.");
    }
    processed.add(key);
    processed.add(antipodalKey);

    const [f, g] = edge.faces;
    const center = normalize(add(sphere.vertices[a], sphere.vertices[b]));
    const polygon = [
      sphere.vertices[a],
      centers[f],
      sphere.vertices[b],
      centers[g],
    ];
    const vertexIds = [
      vertexClasses.sphereToQuotient[a],
      faceOffset + faceClasses.sphereToQuotient[f],
      vertexClasses.sphereToQuotient[b],
      faceOffset + faceClasses.sphereToQuotient[g],
    ];
    // The endpoint labels have numeric order; orient the local lift outwards.
    if (dot(center, cross(polygon[0], polygon[1])) < 0) {
      polygon.reverse();
      vertexIds.reverse();
    }
    cells.push({ id: cells.length, center, polygon, vertexIds, neighbors: [] });
  }
  const edges = buildQuotientEdges(cells);
  return {
    frequency: sphere.frequency,
    cells,
    vertices: [...vertexClasses.points, ...faceClasses.points],
    edges,
  };
}

/** Every tiling lives on the same actual S² / ± quotient. */
export function createBoardMesh(frequency: number, kind: GridKind): BoardMesh {
  // Validate the public enum even when callers come from untyped input.
  cellCount(frequency, kind);
  if (kind === "dual") return createProjectiveMesh(frequency);
  if (kind === "heptagonal" || kind === "octagonal")
    return createHighDegreeMesh(frequency, kind);
  const sphere = createSphereMesh(frequency);
  return kind === "triangular"
    ? triangularMesh(sphere)
    : quadrilateralMesh(sphere);
}
