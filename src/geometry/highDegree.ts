import { createSphereMesh, triangleKey } from './sphere';
import { createProjectiveMeshFromSphere } from './topology';
import type { ProjectiveMesh, SphereMesh, Triangle, Vec3 } from './types';
import { add, cross, dot, length, normalize, subtract } from './vector';

type HighDegreeKind = 'heptagonal' | 'octagonal';
interface EdgeSide { face: number; a: number; b: number; opposite: number }
interface Candidate { sides: EdgeSide[]; score: number; order: number }

const edgeKey = (a: number, b: number): string => a < b ? `${a}:${b}` : `${b}:${a}`;
const CONVEX_EPSILON = 1e-10;

function edgesOf(sphere: SphereMesh): Map<string, EdgeSide[]> {
  const edges = new Map<string, EdgeSide[]>();
  sphere.faces.forEach((face, faceId) => face.forEach((a, index) => {
    const b = face[(index + 1) % 3];
    const key = edgeKey(a, b);
    const sides = edges.get(key) ?? [];
    sides.push({ face: faceId, a, b, opposite: face[(index + 2) % 3] });
    edges.set(key, sides);
  }));
  return edges;
}

function faceCenter(sphere: SphereMesh, face: Triangle): Vec3 {
  return normalize(add(add(sphere.vertices[face[0]], sphere.vertices[face[1]]), sphere.vertices[face[2]]));
}

/** All vertices must lie in every inward edge hemisphere, not only the center. */
export function isStrictlyConvexSphericalPolygon(polygon: readonly Vec3[], center: Vec3): boolean {
  if (polygon.length < 3 || polygon.some(point => dot(center, point) <= CONVEX_EPSILON)) return false;
  for (let index = 0; index < polygon.length; index += 1) {
    const next = (index + 1) % polygon.length;
    const normal = cross(polygon[index], polygon[next]);
    if (length(normal) <= CONVEX_EPSILON) return false;
    const inward = normalize(normal);
    if (dot(inward, center) <= CONVEX_EPSILON) return false;
    for (let other = 0; other < polygon.length; other += 1) {
      if (other !== index && other !== next && dot(inward, polygon[other]) <= CONVEX_EPSILON) return false;
    }
  }
  return true;
}

function orderHash(a: number, b: number, frequency: number, target: number): number {
  let value = (Math.imul(Math.min(a, b), 73856093) ^ Math.imul(Math.max(a, b), 19349663)
    ^ Math.imul(frequency, 83492791) ^ target) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

/**
 * Change real edges of the antipodal spherical triangulation in paired flips,
 * then take its dual quotient. Every accepted move preserves a closed manifold
 * and verifies strict spherical convexity of all changed dual polygons.
 */
export function createHighDegreeMesh(frequency: number, kind: HighDegreeKind): ProjectiveMesh {
  if (kind !== 'heptagonal' && kind !== 'octagonal') throw new RangeError('Unknown high-degree tiling.');
  const sphere = createSphereMesh(frequency);
  if (frequency < 2) throw new RangeError('Seven- and eight-sided tilings need subdivision frequency at least two.');
  const target = kind === 'heptagonal' ? 7 : 8;
  const desired = Math.max(1, Math.round((5 * frequency ** 2 + 1) * 0.07));
  const centers = sphere.faces.map(face => faceCenter(sphere, face));
  const vertexFaces = sphere.vertices.map(() => new Set<number>());
  sphere.faces.forEach((face, id) => face.forEach(vertex => vertexFaces[vertex].add(id)));

  const polygonAt = (vertex: number): Vec3[] => {
    const link = new Map<number, { next: number; face: number }>();
    for (const faceId of vertexFaces[vertex]) {
      const face = sphere.faces[faceId];
      const index = face.indexOf(vertex);
      const from = face[(index + 1) % 3];
      if (link.has(from)) throw new Error('A flipped vertex link is not a manifold.');
      link.set(from, { next: face[(index + 2) % 3], face: faceId });
    }
    const first = link.keys().next().value!;
    let current = first;
    const polygon: Vec3[] = [];
    do {
      const entry = link.get(current);
      if (!entry || polygon.length >= link.size) throw new Error('A flipped vertex link is not a circular link.');
      polygon.push(centers[entry.face]);
      current = entry.next;
    } while (current !== first);
    if (polygon.length !== link.size) throw new Error('A flipped vertex link is disconnected.');
    return polygon;
  };

  const replaceFaces = (ids: number[], replacements: Triangle[]): void => {
    ids.forEach(id => sphere.faces[id].forEach(vertex => vertexFaces[vertex].delete(id)));
    ids.forEach((id, index) => {
      sphere.faces[id] = replacements[index];
      centers[id] = faceCenter(sphere, replacements[index]);
      replacements[index].forEach(vertex => vertexFaces[vertex].add(id));
    });
  };

  let highCount = 0;
  // Every accepted move increases the sum of positive degree excess; this also
  // bounds preparatory flips that create sevens before producing eights.
  const moveLimit = Math.max(8, desired * 4);
  for (let move = 0; move < moveLimit && highCount < desired; move += 1) {
    const edges = edgesOf(sphere);
    const degree = vertexFaces.map(faces => faces.size);
    const candidates: Candidate[] = [];
    for (const [key, sides] of edges) {
      if (sides.length !== 2) throw new Error('A spherical triangulation must have two faces at every edge.');
      const { a, b, opposite: c } = sides[0];
      const d = sides[1].opposite;
      const anti = sphere.vertexAntipodes;
      if (key > edgeKey(anti[a], anti[b])) continue;
      if (new Set([a, b, c, d, anti[a], anti[b], anti[c], anti[d]]).size !== 8) continue;
      if (degree[a] !== 6 || degree[b] !== 6 || degree[c] >= target || degree[d] >= target) continue;
      if (Math.max(degree[c], degree[d]) < 6 || edges.has(edgeKey(c, d))) continue;
      const gains = Number(degree[c] + 1 === target) + Number(degree[d] + 1 === target);
      const score = gains * 100 + Number(degree[c] === 6) * 10 + Number(degree[d] === 6) * 10;
      candidates.push({ sides, score, order: orderHash(a, b, frequency, target) });
    }
    candidates.sort((a, b) => b.score - a.score || a.order - b.order);
    let accepted = false;
    for (const { sides } of candidates) {
      const { a, b, opposite: c, face: f } = sides[0];
      const { opposite: d, face: g } = sides[1];
      const first: Triangle = [c, d, b];
      const second: Triangle = [d, c, a];
      const outward = ([x, y, z]: Triangle): number => dot(sphere.vertices[x], cross(
        subtract(sphere.vertices[y], sphere.vertices[x]), subtract(sphere.vertices[z], sphere.vertices[x]),
      ));
      if (outward(first) <= CONVEX_EPSILON || outward(second) <= CONVEX_EPSILON) continue;
      const anti = sphere.vertexAntipodes;
      const antipodal = ([x, y, z]: Triangle): Triangle => [anti[x], anti[z], anti[y]];
      const ids = [f, g, sphere.faceAntipodes[f], sphere.faceAntipodes[g]];
      if (new Set(ids).size !== 4) continue;
      const old = ids.map(id => sphere.faces[id]);
      replaceFaces(ids, [first, second, antipodal(first), antipodal(second)]);
      const changed = [a, b, c, d, anti[a], anti[b], anti[c], anti[d]];
      if (changed.every(vertex => isStrictlyConvexSphericalPolygon(polygonAt(vertex), sphere.vertices[vertex]))) {
        highCount = vertexFaces.filter(faces => faces.size === target).length / 2;
        accepted = true;
        break;
      }
      replaceFaces(ids, old);
    }
    if (!accepted) break;
  }

  // Face IDs survive the paired moves; recompute their involution from exact
  // vertex labels so callers can inspect the updated antipodal triangulation.
  const faceByKey = new Map(sphere.faces.map((face, id) => [triangleKey(face), id]));
  sphere.faceAntipodes = sphere.faces.map(face => {
    const mapped = face.map(vertex => sphere.vertexAntipodes[vertex]) as unknown as Triangle;
    const opposite = faceByKey.get(triangleKey(mapped));
    if (opposite === undefined) throw new Error('A paired flip lost its antipodal face.');
    return opposite;
  });
  const mesh = createProjectiveMeshFromSphere(sphere);
  if (!mesh.cells.some(cell => cell.polygon.length === target)) {
    throw new Error(`No strictly convex ${target}-sided projective cell could be constructed at frequency ${frequency}.`);
  }
  for (const cell of mesh.cells) {
    if (cell.polygon.length < 5 || cell.polygon.length > target
      || cell.neighbors.length !== cell.polygon.length
      || new Set(cell.neighbors).size !== cell.polygon.length
      || !isStrictlyConvexSphericalPolygon(cell.polygon, cell.center)) {
      throw new Error('High-degree cells must be convex and have one distinct logical neighbor per side.');
    }
  }
  if (mesh.cells.length !== 5 * frequency ** 2 + 1
    || mesh.vertices.length - mesh.edges.length + mesh.cells.length !== 1) {
    throw new Error('High-degree flips changed the projective topology.');
  }
  return mesh;
}
