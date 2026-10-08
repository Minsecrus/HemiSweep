import { createSphereMesh } from "./sphere";
import type { BoardCell, BoardMesh, ProjectiveEdge, Vec3 } from "./types";
import { add, cross, dot, normalize, subtract } from "./vector";

/** {a,b}: each face has a sides; b faces meet at each vertex. */
export type RegularSymbol = readonly [a: number, b: number];

export const REGULAR_SYMBOLS = [
  { a: 3, b: 4, name: "半八面体", faces: 4 },
  { a: 4, b: 3, name: "半立方体", faces: 3 },
  { a: 3, b: 5, name: "半二十面体", faces: 10 },
  { a: 5, b: 3, name: "半十二面体", faces: 6 },
] as const;

interface SphericalPolyhedron {
  vertices: Vec3[];
  /** The sphere's faces have consistently outward oriented boundary cycles. */
  faces: number[][];
  vertexAntipodes: number[];
  faceAntipodes: number[];
}

interface SphericalEdge {
  endpoints: readonly [number, number];
  faces: number[];
}

const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;
const faceKey = (vertices: number[]): string =>
  [...vertices].sort((a, b) => a - b).join(":");
const centroid = (vertices: Vec3[]): Vec3 =>
  normalize(vertices.reduce(add, [0, 0, 0]));

function withFaceAntipodes(
  vertices: Vec3[],
  faces: number[][],
  vertexAntipodes: number[],
): SphericalPolyhedron {
  const faceByKey = new Map(faces.map((face, id) => [faceKey(face), id]));
  const faceAntipodes = faces.map((face) => {
    const opposite = faceByKey.get(
      faceKey(face.map((vertex) => vertexAntipodes[vertex])),
    );
    if (opposite === undefined)
      throw new Error("A regular spherical face has no antipodal partner.");
    return opposite;
  });
  return { vertices, faces, vertexAntipodes, faceAntipodes };
}

function octahedron(): SphericalPolyhedron {
  const vertices: Vec3[] = [
    [1, 0, 0],
    [-1, 0, 0],
    [0, 1, 0],
    [0, -1, 0],
    [0, 0, 1],
    [0, 0, -1],
  ];
  const faces: number[][] = [];
  // One face for each combination of signs, with combinatorial axis labels.
  for (const x of [0, 1])
    for (const y of [2, 3])
      for (const z of [4, 5]) {
        const face = [x, y, z];
        if (
          dot(
            vertices[x],
            cross(
              subtract(vertices[y], vertices[x]),
              subtract(vertices[z], vertices[x]),
            ),
          ) < 0
        ) {
          face.reverse();
        }
        faces.push(face);
      }
  return withFaceAntipodes(vertices, faces, [1, 0, 3, 2, 5, 4]);
}

function icosahedron(): SphericalPolyhedron {
  const sphere = createSphereMesh(1);
  return { ...sphere, faces: sphere.faces.map((face) => [...face]) };
}

/** Construct oriented dual face cycles by walking incidence, never distances. */
function dual(sphere: SphericalPolyhedron): SphericalPolyhedron {
  const vertices = sphere.faces.map((face) =>
    centroid(face.map((vertex) => sphere.vertices[vertex])),
  );
  const links = sphere.vertices.map(
    () => new Map<number, { next: number; face: number }>(),
  );
  sphere.faces.forEach((face, faceId) => {
    face.forEach((vertex, index) => {
      const from = face[(index + 1) % face.length];
      const next = face[(index + face.length - 1) % face.length];
      if (links[vertex].has(from))
        throw new Error("The spherical vertex link is not a manifold.");
      links[vertex].set(from, { next, face: faceId });
    });
  });
  const faces = links.map((link) => {
    const start = link.keys().next().value;
    if (start === undefined)
      throw new Error("A regular polyhedron has an isolated vertex.");
    let current = start;
    const face: number[] = [];
    do {
      const step = link.get(current);
      if (!step || face.length >= link.size)
        throw new Error("The spherical vertex link must be a single cycle.");
      face.push(step.face);
      current = step.next;
    } while (current !== start);
    if (face.length !== link.size)
      throw new Error("The spherical vertex link is disconnected.");
    return face;
  });
  return {
    vertices,
    faces,
    vertexAntipodes: [...sphere.faceAntipodes],
    faceAntipodes: [...sphere.vertexAntipodes],
  };
}

/**
 * Quotient the complete oriented sphere complex by its free antipodal action.
 * Edges keep their sphere-edge orbits, including genuine parallel quotient
 * edges. In particular, the hemi-cube's four sides reach two distinct cells.
 */
function quotient(sphere: SphericalPolyhedron): BoardMesh {
  const vertexToQuotient = Array<number>(sphere.vertices.length).fill(-1);
  const faceToCell = Array<number>(sphere.faces.length).fill(-1);
  const vertices: Vec3[] = [];
  sphere.vertices.forEach((point, id) => {
    if (vertexToQuotient[id] !== -1) return;
    const opposite = sphere.vertexAntipodes[id];
    if (opposite === id || sphere.vertexAntipodes[opposite] !== id)
      throw new Error("The antipodal vertex action must be free.");
    vertexToQuotient[id] = vertices.length;
    vertexToQuotient[opposite] = vertices.length;
    vertices.push(point);
  });
  const cells: BoardCell[] = [];
  sphere.faces.forEach((face, id) => {
    if (faceToCell[id] !== -1) return;
    const opposite = sphere.faceAntipodes[id];
    if (opposite === id || sphere.faceAntipodes[opposite] !== id)
      throw new Error("The antipodal face action must be free.");
    faceToCell[id] = cells.length;
    faceToCell[opposite] = cells.length;
    const polygon = face.map((vertex) => sphere.vertices[vertex]);
    cells.push({
      id: cells.length,
      center: centroid(polygon),
      polygon,
      vertexIds: face.map((vertex) => vertexToQuotient[vertex]),
      neighbors: [],
    });
  });
  const sphereEdges = new Map<string, SphericalEdge>();
  sphere.faces.forEach((face, faceId) => {
    face.forEach((a, index) => {
      const b = face[(index + 1) % face.length];
      const key = edgeKey(a, b);
      const edge = sphereEdges.get(key);
      if (edge) edge.faces.push(faceId);
      else sphereEdges.set(key, { endpoints: [a, b], faces: [faceId] });
    });
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
      key === oppositeKey ||
      edge.faces.length !== 2 ||
      opposite.faces.length !== 2
    ) {
      throw new Error(
        "Every edge must have two incident faces and a distinct antipodal partner.",
      );
    }
    seen.add(key);
    seen.add(oppositeKey);
    const cellA = faceToCell[edge.faces[0]];
    const cellB = faceToCell[edge.faces[1]];
    const vertexA = vertexToQuotient[a];
    const vertexB = vertexToQuotient[b];
    if (cellA === cellB || vertexA === vertexB)
      throw new Error(
        "A convex projective regular map cannot contain these loops.",
      );
    edges.push({
      id: edges.length,
      cells: [cellA, cellB],
      vertices: [vertexA, vertexB],
    });
    cells[cellA].neighbors.push(cellB);
    cells[cellB].neighbors.push(cellA);
  }
  cells.forEach((cell) => {
    cell.neighbors = [...new Set(cell.neighbors)].sort((a, b) => a - b);
  });
  return { frequency: 1, vertices, cells, edges };
}

/**
 * All centrally symmetric convex Platonic tilings with a,b >= 3 on RP².
 * Positive curvature alone is insufficient: the tetrahedron {3,3} has no
 * antipodal symmetry and cannot descend to this particular quotient.
 */
export function createRegularMesh(a: number, b: number): BoardMesh {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 3 || b < 3) {
    throw new RangeError("正则符号 {a,b} 的 a、b 必须是大于等于 3 的整数。");
  }
  if (a === 3 && b === 4) return quotient(octahedron());
  if (a === 4 && b === 3) return quotient(dual(octahedron()));
  if (a === 3 && b === 5) return quotient(icosahedron());
  if (a === 5 && b === 3) return quotient(dual(icosahedron()));
  if (a === 3 && b === 3)
    throw new RangeError(
      "{3,3} 四面体没有自由的对径对称，不能构成此模型的射影平面棋盘。",
    );
  if ((a - 2) * (b - 2) >= 4)
    throw new RangeError(
      "椭圆正则镶嵌需要 (a−2)(b−2)<4；该符号对应平面或双曲几何。",
    );
  throw new RangeError("此符号没有可用于自由对径商的凸正则球面镶嵌。");
}
