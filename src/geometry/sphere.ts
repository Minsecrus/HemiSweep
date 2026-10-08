import type { SphereMesh, Triangle, Vec3 } from "./types";
import { add, cross, dot, normalize, scale, subtract } from "./vector";

const phi = (1 + Math.sqrt(5)) / 2;

// These labels, not floating-point positions, define the base complex.
const BASE_VERTICES: Vec3[] = (
  [
    [-1, phi, 0],
    [1, phi, 0],
    [-1, -phi, 0],
    [1, -phi, 0],
    [0, -1, phi],
    [0, 1, phi],
    [0, -1, -phi],
    [0, 1, -phi],
    [phi, 0, -1],
    [phi, 0, 1],
    [-phi, 0, -1],
    [-phi, 0, 1],
  ] satisfies Vec3[]
).map(normalize);

const BASE_ANTIPODES = [3, 2, 1, 0, 7, 6, 5, 4, 11, 10, 9, 8];

const BASE_FACES: Triangle[] = [
  [0, 11, 5],
  [0, 5, 1],
  [0, 1, 7],
  [0, 7, 10],
  [0, 10, 11],
  [1, 5, 9],
  [5, 11, 4],
  [11, 10, 2],
  [10, 7, 6],
  [7, 1, 8],
  [3, 9, 4],
  [3, 4, 2],
  [3, 2, 6],
  [3, 6, 8],
  [3, 8, 9],
  [4, 9, 5],
  [2, 4, 11],
  [6, 2, 10],
  [8, 6, 7],
  [9, 8, 1],
];

type Weight = readonly [baseVertex: number, numerator: number];

function barycentricKey(weights: readonly Weight[]): string {
  return weights
    .filter(([, weight]) => weight !== 0)
    .sort(([a], [b]) => a - b)
    .map(([vertex, weight]) => `${vertex}:${weight}`)
    .join("/");
}

export function triangleKey(face: Triangle): string {
  return [...face].sort((a, b) => a - b).join(":");
}

/**
 * Subdivide the oriented icosahedral complex, then radially project to S².
 * A vertex is an exact sparse integer barycentric combination of base labels.
 * Thus shared edges and antipodes are glued combinatorially before rendering.
 */
export function createSphereMesh(frequency: number): SphereMesh {
  if (!Number.isInteger(frequency) || frequency < 1) {
    throw new RangeError("Subdivision frequency must be a positive integer.");
  }

  const vertices: Vec3[] = [];
  const faces: Triangle[] = [];
  const weightsByVertex: Weight[][] = [];
  const vertexByKey = new Map<string, number>();

  function vertexFor(weights: Weight[]): number {
    const key = barycentricKey(weights);
    const previous = vertexByKey.get(key);
    if (previous !== undefined) return previous;
    const id = vertices.length;
    let position: Vec3 = [0, 0, 0];
    for (const [base, weight] of weights) {
      position = add(position, scale(BASE_VERTICES[base], weight));
    }
    vertices.push(normalize(position));
    weightsByVertex.push(weights);
    vertexByKey.set(key, id);
    return id;
  }

  for (const [a, b, c] of BASE_FACES) {
    const lattice: number[][] = [];
    for (let i = 0; i <= frequency; i += 1) {
      lattice[i] = [];
      for (let j = 0; j <= frequency - i; j += 1) {
        lattice[i][j] = vertexFor([
          [a, frequency - i - j],
          [b, i],
          [c, j],
        ]);
      }
    }
    for (let i = 0; i < frequency; i += 1) {
      for (let j = 0; j < frequency - i; j += 1) {
        faces.push([lattice[i][j], lattice[i + 1][j], lattice[i][j + 1]]);
        if (i + j + 2 <= frequency) {
          faces.push([
            lattice[i + 1][j],
            lattice[i + 1][j + 1],
            lattice[i][j + 1],
          ]);
        }
      }
    }
  }

  // Assert the orientation inherited from the explicit base complex.
  for (const [a, b, c] of faces) {
    if (
      dot(
        vertices[a],
        cross(
          subtract(vertices[b], vertices[a]),
          subtract(vertices[c], vertices[a]),
        ),
      ) <= 0
    ) {
      throw new Error("The spherical triangulation must be oriented outwards.");
    }
  }

  const vertexAntipodes = weightsByVertex.map((weights) => {
    const oppositeWeights = weights.map(([base, weight]): Weight => [
      BASE_ANTIPODES[base],
      weight,
    ]);
    const opposite = vertexByKey.get(barycentricKey(oppositeWeights));
    if (opposite === undefined)
      throw new Error("Missing antipodal subdivision vertex.");
    return opposite;
  });
  const faceByKey = new Map(faces.map((face, id) => [triangleKey(face), id]));
  const faceAntipodes = faces.map(([a, b, c]) => {
    const opposite = faceByKey.get(
      triangleKey([vertexAntipodes[a], vertexAntipodes[b], vertexAntipodes[c]]),
    );
    if (opposite === undefined)
      throw new Error("Missing antipodal subdivision face.");
    return opposite;
  });

  return { frequency, vertices, faces, vertexAntipodes, faceAntipodes };
}
