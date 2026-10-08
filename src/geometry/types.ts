export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];
export type Triangle = readonly [number, number, number];

export interface SphereMesh {
  frequency: number;
  vertices: Vec3[];
  faces: Triangle[];
  vertexAntipodes: number[];
  faceAntipodes: number[];
}

export type GridKind =
  "dual" | "triangular" | "quadrilateral" | "heptagonal" | "octagonal";

export interface BoardCell {
  id: number;
  /** A representative on S². Its negative is the same logical cell. */
  center: Vec3;
  /** Ordered spherical polygon; great-circle arcs connect consecutive vertices. */
  polygon: Vec3[];
  /** Logical cells sharing an actual quotient edge. */
  neighbors: number[];
  /** Ordered quotient vertex IDs, matching polygon vertices. */
  vertexIds: number[];
}

export interface ProjectiveCell extends BoardCell {
  sphereVertexIds: readonly [number, number];
}

export interface ProjectiveEdge {
  id: number;
  cells: readonly [number, number];
  vertices: readonly [number, number];
}

export interface BoardMesh {
  frequency: number;
  cells: BoardCell[];
  vertices: Vec3[];
  edges: ProjectiveEdge[];
}

export interface ProjectiveMesh extends BoardMesh {
  cells: ProjectiveCell[];
  sphere: SphereMesh;
  sphereVertexToCell: number[];
  sphereFaceToVertex: number[];
}

/** A unit quaternion [x,y,z,w] rotates S² before the hemisphere cut. */
export type Quaternion = readonly [number, number, number, number];

export interface CellFragment {
  cellId: number;
  key: string;
  /** SVG path in the unit disk. */
  path: string;
  points: Vec2[];
  label: Vec2;
  area: number;
  /** True when this polygon was cut by the chosen equator. */
  crossesBoundary: boolean;
}
