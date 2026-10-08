import type {
  ProjectiveCell,
  ProjectiveEdge,
  ProjectiveMesh,
  SphereMesh,
} from "./types";
import {
  antipodalClasses,
  antipodalEdgeOrbits,
  centroid,
  collectEdges,
  vertexLinks,
} from "./complex";
import { createSphereMesh } from "./sphere";

/**
 * Build the dual cell complex of S², then quotient every vertex, edge and face
 * by the free antipodal involution. Screen coordinates never define adjacency.
 */
export function createProjectiveMesh(frequency: number): ProjectiveMesh {
  return createProjectiveMeshFromSphere(createSphereMesh(frequency));
}

/** Take the antipodal dual quotient of any valid outward spherical triangulation. */
export function createProjectiveMeshFromSphere(
  sphere: SphereMesh,
): ProjectiveMesh {
  const faceCenters = sphere.faces.map((face) =>
    centroid(face.map((vertex) => sphere.vertices[vertex])),
  );
  const cellClasses = antipodalClasses(sphere.vertexAntipodes);
  const vertexClasses = antipodalClasses(sphere.faceAntipodes);
  const sphereVertexToCell = cellClasses.toClass;
  const sphereFaceToVertex = vertexClasses.toClass;

  const links = vertexLinks(sphere.vertices.length, sphere.faces);
  const cells: ProjectiveCell[] = cellClasses.representatives.map(
    (representative, id) => ({
      id,
      center: sphere.vertices[representative],
      polygon: links[representative].map((face) => faceCenters[face]),
      sphereVertexIds: [representative, sphere.vertexAntipodes[representative]],
      neighbors: [],
      vertexIds: links[representative].map((face) => sphereFaceToVertex[face]),
    }),
  );

  const edges: ProjectiveEdge[] = [];
  for (const edge of antipodalEdgeOrbits(
    collectEdges(sphere.faces),
    sphere.vertexAntipodes,
  )) {
    const [a, b] = edge.endpoints;
    const cellA = sphereVertexToCell[a];
    const cellB = sphereVertexToCell[b];
    if (cellA === cellB)
      throw new Error("A quotient dual edge cannot be a loop.");
    edges.push({
      id: edges.length,
      cells: [cellA, cellB],
      vertices: [
        sphereFaceToVertex[edge.faces[0]],
        sphereFaceToVertex[edge.faces[1]],
      ],
    });
    cells[cellA].neighbors.push(cellB);
    cells[cellB].neighbors.push(cellA);
  }
  for (const cell of cells) cell.neighbors.sort((a, b) => a - b);

  return {
    frequency: sphere.frequency,
    cells,
    vertices: vertexClasses.representatives.map((face) => faceCenters[face]),
    edges,
    sphere,
    sphereVertexToCell,
    sphereFaceToVertex,
  };
}
