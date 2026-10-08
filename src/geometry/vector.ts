import type { Vec3 } from "./types";

export const add = (a: Vec3, b: Vec3): Vec3 => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];
export const subtract = (a: Vec3, b: Vec3): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
export const scale = (a: Vec3, factor: number): Vec3 => [
  a[0] * factor,
  a[1] * factor,
  a[2] * factor,
];
export const dot = (a: Vec3, b: Vec3): number =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const negate = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize(a: Vec3): Vec3 {
  const magnitude = length(a);
  if (magnitude === 0) throw new Error("Cannot normalize the zero vector.");
  return scale(a, 1 / magnitude);
}
