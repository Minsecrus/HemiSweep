import { createSphereMesh } from "./sphere";
import type { BoardCell, BoardMesh, ProjectiveEdge, Vec3 } from "./types";
import {
  antipodalClasses,
  antipodalEdgeOrbits,
  centroid,
  collectEdges,
  faceAntipodes,
  outwardOrientation,
  vertexLinks,
} from "./complex";

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

function withFaceAntipodes(
  vertices: Vec3[],
  faces: number[][],
  vertexAntipodes: number[],
): SphericalPolyhedron {
  return {
    vertices,
    faces,
    vertexAntipodes,
    faceAntipodes: faceAntipodes(faces, vertexAntipodes),
  };
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
        if (outwardOrientation(vertices[x], vertices[y], vertices[z]) < 0)
          face.reverse();
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
  const faces = vertexLinks(sphere.vertices.length, sphere.faces);
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
  const vertexClasses = antipodalClasses(sphere.vertexAntipodes);
  const cellClasses = antipodalClasses(sphere.faceAntipodes);
  const vertexToQuotient = vertexClasses.toClass;
  const faceToCell = cellClasses.toClass;
  const cells: BoardCell[] = cellClasses.representatives.map((face, id) => {
    const polygon = sphere.faces[face].map((vertex) => sphere.vertices[vertex]);
    return {
      id,
      center: centroid(polygon),
      polygon,
      vertexIds: sphere.faces[face].map((vertex) => vertexToQuotient[vertex]),
      neighbors: [],
    };
  });
  const edges: ProjectiveEdge[] = [];
  for (const edge of antipodalEdgeOrbits(
    collectEdges(sphere.faces),
    sphere.vertexAntipodes,
  )) {
    const [a, b] = edge.endpoints;
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
  return {
    frequency: 1,
    vertices: vertexClasses.representatives.map((id) => sphere.vertices[id]),
    cells,
    edges,
  };
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
