import type { BoardMesh } from "./types";

export type AdjacencyRule = "edge" | "vertex";

/**
 * Choose the game relation without changing the geometric cell complex.
 * Vertex IDs already name antipodal classes in RP²; screen fragments and sphere
 * representatives never enter this calculation. Multiple shared vertices or
 * parallel edges still contribute each neighboring logical cell only once.
 */
export function createAdjacencyGraph(
  mesh: BoardMesh,
  rule: AdjacencyRule,
): number[][] {
  if (rule === "edge") return mesh.cells.map((cell) => [...cell.neighbors]);
  if (rule !== "vertex")
    throw new RangeError(`Unknown adjacency rule: ${String(rule)}`);

  const cellsAtVertex = new Map<number, Set<number>>();
  for (const cell of mesh.cells) {
    for (const vertexId of cell.vertexIds) {
      let incident = cellsAtVertex.get(vertexId);
      if (!incident) {
        incident = new Set<number>();
        cellsAtVertex.set(vertexId, incident);
      }
      incident.add(cell.id);
    }
  }

  return mesh.cells.map((cell) => {
    const neighbors = new Set<number>();
    for (const vertexId of cell.vertexIds) {
      for (const incident of cellsAtVertex.get(vertexId)!) {
        if (incident !== cell.id) neighbors.add(incident);
      }
    }
    return [...neighbors].sort((a, b) => a - b);
  });
}
