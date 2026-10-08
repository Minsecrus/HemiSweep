import type { Vec3 } from "./types";
import { add, cross, dot, normalize, subtract } from "./vector";

/** Combinatorial helpers shared by every cell complex on S² and its quotient. */

export interface SphereEdge {
  /** Endpoint labels in increasing order. */
  endpoints: readonly [number, number];
  faces: number[];
}

export interface AntipodalClasses {
  /** The first label seen in each orbit {x, −x}. */
  representatives: number[];
  /** Orbit index of every label. */
  toClass: number[];
}

type Link = Map<number, { next: number; face: number }>;

export const edgeKey = (a: number, b: number): string =>
  a < b ? `${a}:${b}` : `${b}:${a}`;

/** An unoriented face is determined by its vertex label set. */
export const faceKey = (vertices: readonly number[]): string =>
  [...vertices].sort((a, b) => a - b).join(":");

/** Normalized vertex sum, a point in the interior of a convex spherical polygon. */
export const centroid = (points: readonly Vec3[]): Vec3 =>
  normalize(points.reduce<Vec3>(add, [0, 0, 0]));

/** Positive when a → b → c turns counterclockwise as seen from outside S². */
export const outwardOrientation = (a: Vec3, b: Vec3, c: Vec3): number =>
  dot(a, cross(subtract(b, a), subtract(c, a)));

/** Undirected edges of polygon faces, keyed by their endpoint labels. */
export function collectEdges(
  faces: readonly (readonly number[])[],
): Map<string, SphereEdge> {
  const edges = new Map<string, SphereEdge>();
  faces.forEach((face, faceId) => {
    face.forEach((a, index) => {
      const b = face[(index + 1) % face.length];
      const key = edgeKey(a, b);
      const edge = edges.get(key);
      if (edge) edge.faces.push(faceId);
      else
        edges.set(key, {
          endpoints: a < b ? [a, b] : [b, a],
          faces: [faceId],
        });
    });
  });
  return edges;
}

/**
 * Yield one lift of every antipodal edge orbit. Both lifts must be two-sided
 * and distinct, so the involution acts freely on the closed edge set.
 */
export function* antipodalEdgeOrbits(
  edges: ReadonlyMap<string, SphereEdge>,
  vertexAntipodes: readonly number[],
): Generator<SphereEdge> {
  const seen = new Set<string>();
  for (const [key, edge] of edges) {
    if (seen.has(key)) continue;
    const [a, b] = edge.endpoints;
    const oppositeKey = edgeKey(vertexAntipodes[a], vertexAntipodes[b]);
    const opposite = edges.get(oppositeKey);
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
    yield edge;
  }
}

/** Orbits of a free involution given by exact labels, never by coordinates. */
export function antipodalClasses(
  antipodes: readonly number[],
): AntipodalClasses {
  const toClass = Array<number>(antipodes.length).fill(-1);
  const representatives: number[] = [];
  antipodes.forEach((opposite, id) => {
    if (toClass[id] !== -1) return;
    if (opposite === id || antipodes[opposite] !== id)
      throw new Error("The antipodal action must be a free involution.");
    toClass[id] = representatives.length;
    toClass[opposite] = representatives.length;
    representatives.push(id);
  });
  return { representatives, toClass };
}

/** Map every face to the face whose label set is antipodal to it. */
export function faceAntipodes(
  faces: readonly (readonly number[])[],
  vertexAntipodes: readonly number[],
): number[] {
  const faceByKey = new Map(faces.map((face, id) => [faceKey(face), id]));
  return faces.map((face) => {
    const opposite = faceByKey.get(
      faceKey(face.map((vertex) => vertexAntipodes[vertex])),
    );
    if (opposite === undefined)
      throw new Error("A spherical face has no antipodal partner.");
    return opposite;
  });
}

function linkFace(
  link: Link,
  face: readonly number[],
  index: number,
  faceId: number,
): void {
  const from = face[(index + 1) % face.length];
  const next = face[(index + face.length - 1) % face.length];
  if (link.has(from)) throw new Error("A vertex link is not a manifold.");
  link.set(from, { next, face: faceId });
}

function walkLink(link: Link): number[] {
  const start = link.keys().next().value;
  if (start === undefined) throw new Error("A vertex has no incident faces.");
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
    throw new Error("A vertex link is disconnected.");
  return faces;
}

/** The ordered oriented link is determined only by face incidence. */
export function vertexLinks(
  vertexCount: number,
  faces: readonly (readonly number[])[],
): number[][] {
  const links: Link[] = Array.from({ length: vertexCount }, () => new Map());
  faces.forEach((face, faceId) =>
    face.forEach((vertex, index) =>
      linkFace(links[vertex], face, index, faceId),
    ),
  );
  return links.map(walkLink);
}

/** The ordered link of one vertex, restricted to the given incident faces. */
export function vertexLink(
  vertex: number,
  faceIds: Iterable<number>,
  faces: readonly (readonly number[])[],
): number[] {
  const link: Link = new Map();
  for (const faceId of faceIds) {
    const face = faces[faceId];
    linkFace(link, face, face.indexOf(vertex), faceId);
  }
  return walkLink(link);
}
