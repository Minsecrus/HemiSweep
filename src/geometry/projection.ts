import type { BoardMesh, CellFragment, Quaternion, Vec2, Vec3 } from "./types";

export const IDENTITY_ROTATION: Quaternion = [0, 0, 0, 1];

const EPSILON = 1e-12;
// A spherical edge has the same number of samples in either direction. Adjacent
// polygons therefore render the same curve, including the equatorial seam.
const MAX_ARC_STEP = 0.012;
const HALF_PI = Math.PI / 2;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(...v);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function negate(v: Vec3): Vec3 {
  return [-v[0], -v[1], -v[2]];
}

/** Hamilton product: the rotation b is applied before the rotation a. */
export function multiplyQuaternion(a: Quaternion, b: Quaternion): Quaternion {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  const product: Quaternion = [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
  const length = Math.hypot(...product);
  return [
    product[0] / length,
    product[1] / length,
    product[2] / length,
    product[3] / length,
  ];
}

/** Rotate a point on S²; no screen-space translation is involved. */
export function rotateVector(v: Vec3, q: Quaternion): Vec3 {
  const [x, y, z, w] = q;
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + y * tz - z * ty,
    v[1] + w * ty + z * tx - x * tz,
    v[2] + w * tz + x * ty - y * tx,
  ];
}

/** Rotate around camera axes so dragging can bring any seam cell to the center. */
export function dragRotation(
  q: Quaternion,
  dx: number,
  dy: number,
): Quaternion {
  const yaw = dx * 0.005;
  const pitch = dy * 0.005;
  const aroundY: Quaternion = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const aroundX: Quaternion = [Math.sin(pitch / 2), 0, 0, Math.cos(pitch / 2)];
  return multiplyQuaternion(multiplyQuaternion(aroundX, aroundY), q);
}

/**
 * Exact equatorial intersection of a minor great-circle arc. A point on the
 * minor arc is a normalized positive linear combination of its endpoints;
 * choosing the combination with z = 0 gives the plane intersection exactly.
 */
function equatorIntersection(a: Vec3, b: Vec3): Vec3 {
  const t = a[2] / (a[2] - b[2]);
  const x = a[0] + t * (b[0] - a[0]);
  const y = a[1] + t * (b[1] - a[1]);
  const length = Math.hypot(x, y);
  return [x / length, y / length, 0];
}

function snapEquator(v: Vec3): Vec3 {
  return Math.abs(v[2]) <= EPSILON ? normalize([v[0], v[1], 0]) : v;
}

function samePoint(a: Vec3, b: Vec3): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < EPSILON;
}

/** Spherical Sutherland–Hodgman clipping against the closed northern hemisphere. */
function clipHemisphere(polygon: Vec3[]): Vec3[] {
  const output: Vec3[] = [];
  const append = (point: Vec3) => {
    if (!output.length || !samePoint(output[output.length - 1], point))
      output.push(point);
  };
  for (let index = 0; index < polygon.length; index += 1) {
    const a = snapEquator(polygon[index]);
    const b = snapEquator(polygon[(index + 1) % polygon.length]);
    const insideA = a[2] >= 0;
    const insideB = b[2] >= 0;
    if (insideA !== insideB) append(equatorIntersection(a, b));
    if (insideB) append(b);
  }
  if (output.length > 1 && samePoint(output[0], output[output.length - 1]))
    output.pop();
  return output;
}

/** Azimuthal equidistant hemisphere projection: equator radius 1, pole radius 0. */
export function projectVector(v: Vec3): Vec2 {
  const radial = Math.hypot(v[0], v[1]);
  if (radial < EPSILON) return [0, 0];
  const rho = Math.atan2(radial, Math.max(0, v[2])) / HALF_PI;
  // SVG's vertical coordinate is downward, while the spherical camera's is up.
  return [(v[0] / radial) * rho, (-v[1] / radial) * rho];
}

function sampleArc(a: Vec3, b: Vec3): Vec3[] {
  const angle = Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
  const count = Math.max(1, Math.ceil(angle / MAX_ARC_STEP));
  if (count === 1) return [a];
  const sine = Math.sin(angle);
  const points: Vec3[] = [a];
  for (let index = 1; index < count; index += 1) {
    const t = index / count;
    const wa = Math.sin((1 - t) * angle) / sine;
    const wb = Math.sin(t * angle) / sine;
    points.push(
      normalize([
        wa * a[0] + wb * b[0],
        wa * a[1] + wb * b[1],
        wa * a[2] + wb * b[2],
      ]),
    );
  }
  return points;
}

function polygonMetrics(points: Vec2[]): { area: number; label: Vec2 } {
  let doubleArea = 0;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const cross = a[0] * b[1] - b[0] * a[1];
    doubleArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  return {
    area: Math.abs(doubleArea) / 2,
    label:
      Math.abs(doubleArea) > EPSILON
        ? [cx / (3 * doubleArea), cy / (3 * doubleArea)]
        : points[0],
  };
}

/**
 * Render the quotient S² / ± as a complete closed disk with antipodal boundary
 * identification. Each logical polygon is represented by its two antipodal
 * lifts, each clipped independently. A seam split changes only display geometry.
 */
export function projectBoard(
  mesh: BoardMesh,
  rotation: Quaternion,
): CellFragment[] {
  const fragments: CellFragment[] = [];
  for (const cell of mesh.cells) {
    const rotated = cell.polygon.map((point) =>
      snapEquator(rotateVector(point, rotation)),
    );
    for (const lift of [0, 1] as const) {
      const polygon = lift === 0 ? rotated : rotated.map(negate);
      const clipped = clipHemisphere(polygon);
      if (clipped.length < 3) continue;
      const points: Vec2[] = [];
      for (let index = 0; index < clipped.length; index += 1) {
        // The new closing segment is the short great-circle arc on the equator,
        // and must also be sampled. A straight disk chord would leave a gap.
        const arc = sampleArc(
          clipped[index],
          clipped[(index + 1) % clipped.length],
        );
        points.push(...arc.map(projectVector));
      }
      const metrics = polygonMetrics(points);
      const { area } = metrics;
      if (area < 1e-11) continue;
      // An azimuthal projection can make a thin spherical polygon's planar
      // centroid fall outside its curved boundary. A positive combination of
      // the convex spherical polygon's vertices stays in its spherical interior.
      const label = pointInPolygon(metrics.label, points)
        ? metrics.label
        : projectVector(
            normalize([
              clipped.reduce((sum, point) => sum + point[0], 0),
              clipped.reduce((sum, point) => sum + point[1], 0),
              clipped.reduce((sum, point) => sum + point[2], 0),
            ]),
          );
      const path = `${points.map((point, index) => `${index === 0 ? "M" : "L"}${point[0].toFixed(8)},${point[1].toFixed(8)}`).join(" ")} Z`;
      fragments.push({
        cellId: cell.id,
        key: `${cell.id}:${lift}`,
        path,
        points,
        label,
        area,
        crossesBoundary: polygon.some((point) => point[2] < 0),
      });
    }
  }
  return fragments;
}

/** Hit testing uses rendered fragments only; gameplay neighbors come from topology. */
function pointInPolygon(point: Vec2, points: readonly Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j];
    const b = points[i];
    const cross =
      (point[0] - a[0]) * (b[1] - a[1]) - (point[1] - a[1]) * (b[0] - a[0]);
    if (
      Math.abs(cross) < 1e-10 &&
      point[0] >= Math.min(a[0], b[0]) - EPSILON &&
      point[0] <= Math.max(a[0], b[0]) + EPSILON &&
      point[1] >= Math.min(a[1], b[1]) - EPSILON &&
      point[1] <= Math.max(a[1], b[1]) + EPSILON
    )
      return true;
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
}

export function pointInFragment(point: Vec2, fragment: CellFragment): boolean {
  return pointInPolygon(point, fragment.points);
}
