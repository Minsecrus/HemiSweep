import type {
  ProjectiveCell,
  ProjectiveEdge,
  ProjectiveMesh,
  SphereMesh,
  Vec3,
} from "./types";
import { createSphereMesh } from "./sphere";
import { add, normalize } from "./vector";

interface SphereEdge {
  endpoints: readonly [number, number];
  faces: number[];
}

const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

/** The ordered oriented link is determined only by triangle incidence. */
function vertexLinks(sphere: SphereMesh): number[][] {
  const links = sphere.vertices.map(
    () => new Map<number, { next: number; face: number }>(),
  );
  sphere.faces.forEach((face, faceId) => {
    for (let index = 0; index < 3; index += 1) {
      const center = face[index];
      const from = face[(index + 1) % 3];
      const next = face[(index + 2) % 3];
      if (links[center].has(from))
        throw new Error("Invalid oriented vertex link.");
      links[center].set(from, { next, face: faceId });
    }
  });
  return links.map((link) => {
    const start = link.keys().next().value as number;
    const faces: number[] = [];
    let current = start;
    do {
      const step = link.get(current);
      if (!step || faces.length >= link.size)
        throw new Error("A vertex link must be a single closed cycle.");
      faces.push(step.face);
      current = step.next;
    } while (current !== start);
    if (faces.length !== link.size)
      throw new Error("Disconnected spherical vertex link.");
    return faces;
  });
}

/**
 * Build the dual cell complex of S², then quotient every vertex, edge and face
 * by the free antipodal involution. Screen coordinates never define adjacency.
 */
export function createProjectiveMesh(frequency: number): ProjectiveMesh {
  return createProjectiveMeshFromSphere(createSphereMesh(frequency));
}

/** Take the antipodal dual quotient of any valid outward spherical triangulation. */
export function createProjectiveMeshFromSphere(sphere: SphereMesh): ProjectiveMesh {
  const frequency = sphere.frequency;
  const faceCenters = sphere.faces.map(([a, b, c]) =>
    normalize(
      add(add(sphere.vertices[a], sphere.vertices[b]), sphere.vertices[c]),
    ),
  );
  const sphereVertexToCell: number[] = Array(sphere.vertices.length).fill(-1);
  const sphereFaceToVertex: number[] = Array(sphere.faces.length).fill(-1);
  const vertices: Vec3[] = [];
  const representatives: number[] = [];

  sphere.vertices.forEach((_, id) => {
    if (sphereVertexToCell[id] !== -1) return;
    const cellId = representatives.length;
    representatives.push(id);
    sphereVertexToCell[id] = cellId;
    sphereVertexToCell[sphere.vertexAntipodes[id]] = cellId;
  });
  sphere.faces.forEach((_, id) => {
    if (sphereFaceToVertex[id] !== -1) return;
    const vertexId = vertices.length;
    vertices.push(faceCenters[id]);
    sphereFaceToVertex[id] = vertexId;
    sphereFaceToVertex[sphere.faceAntipodes[id]] = vertexId;
  });

  const links = vertexLinks(sphere);
  const cells: ProjectiveCell[] = representatives.map((representative, id) => ({
    id,
    center: sphere.vertices[representative],
    polygon: links[representative].map((face) => faceCenters[face]),
    sphereVertexIds: [representative, sphere.vertexAntipodes[representative]],
    neighbors: [],
    vertexIds: links[representative].map((face) => sphereFaceToVertex[face]),
  }));

  const sphereEdges = new Map<string, SphereEdge>();
  sphere.faces.forEach((face, faceId) => {
    for (let index = 0; index < 3; index += 1) {
      const a = face[index];
      const b = face[(index + 1) % 3];
      const key = edgeKey(a, b);
      const edge = sphereEdges.get(key);
      if (edge) edge.faces.push(faceId);
      else
        sphereEdges.set(key, {
          endpoints: a < b ? [a, b] : [b, a],
          faces: [faceId],
        });
    }
  });

  const edges: ProjectiveEdge[] = [];
  const seen = new Set<string>();
  for (const [key, edge] of sphereEdges) {
    if (seen.has(key)) continue;
    const [a, b] = edge.endpoints;
    const oppositeKey = edgeKey(
      sphere.vertexAntipodes[a],
      sphere.vertexAntipodes[b],
    );
    const opposite = sphereEdges.get(oppositeKey);
    if (
      !opposite ||
      edge.faces.length !== 2 ||
      opposite.faces.length !== 2 ||
      oppositeKey === key
    ) {
      throw new Error(
        "The antipodal quotient must have two-sided edges and a free action.",
      );
    }
    seen.add(key);
    seen.add(oppositeKey);
    const cellA = sphereVertexToCell[a];
    const cellB = sphereVertexToCell[b];
    if (cellA === cellB)
      throw new Error("A quotient dual edge cannot be a loop.");
    const dualA = sphereFaceToVertex[edge.faces[0]];
    const dualB = sphereFaceToVertex[edge.faces[1]];
    edges.push({
      id: edges.length,
      cells: [cellA, cellB],
      vertices: [dualA, dualB],
    });
    cells[cellA].neighbors.push(cellB);
    cells[cellB].neighbors.push(cellA);
  }
  for (const cell of cells) cell.neighbors.sort((a, b) => a - b);

  return {
    frequency,
    cells,
    vertices,
    edges,
    sphere,
    sphereVertexToCell,
    sphereFaceToVertex,
  };
}
