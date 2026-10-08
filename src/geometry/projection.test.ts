import { describe, expect, it } from "vitest";
import { createProjectiveMesh } from "./topology";
import {
  dragRotation,
  IDENTITY_ROTATION,
  multiplyQuaternion,
  pointInFragment,
  projectBoard,
  rotateVector,
} from "./projection";
import type { CellFragment, Quaternion, Vec2, Vec3 } from "./types";

function radius(point: Vec2): number {
  return Math.hypot(...point);
}

function splitGroups(fragments: CellFragment[]): CellFragment[][] {
  const groups = new Map<number, CellFragment[]>();
  for (const fragment of fragments)
    groups.set(fragment.cellId, [
      ...(groups.get(fragment.cellId) ?? []),
      fragment,
    ]);
  return [...groups.values()].filter((group) => group.length === 2);
}

describe("spherical rotations", () => {
  it("preserves lengths and commutes with the antipodal identification", () => {
    const rotation = dragRotation(IDENTITY_ROTATION, 147, -83);
    const point: Vec3 = [0.6, 0, 0.8];
    const rotated = rotateVector(point, rotation);
    const antipode = rotateVector([-point[0], -point[1], -point[2]], rotation);
    expect(Math.hypot(...rotated)).toBeCloseTo(1, 12);
    for (let axis = 0; axis < 3; axis += 1)
      expect(antipode[axis]).toBeCloseTo(-rotated[axis], 12);
  });

  it("implements the quaternion composition order and remains normalized after repeated dragging", () => {
    const a = dragRotation(IDENTITY_ROTATION, 70, 0);
    const b = dragRotation(IDENTITY_ROTATION, 0, 80);
    const point: Vec3 = [0, 0, 1];
    const composed = rotateVector(point, multiplyQuaternion(a, b));
    const sequential = rotateVector(rotateVector(point, b), a);
    for (let axis = 0; axis < 3; axis += 1)
      expect(composed[axis]).toBeCloseTo(sequential[axis], 12);
    let rotation: Quaternion = IDENTITY_ROTATION;
    for (let index = 0; index < 2000; index += 1)
      rotation = dragRotation(rotation, 2.3, -0.7);
    expect(Math.hypot(...rotation)).toBeCloseTo(1, 12);
    expect(Math.hypot(...rotateVector(point, rotation))).toBeCloseTo(1, 12);
  });
});

describe("the antipodally identified disk", () => {
  const mesh = createProjectiveMesh(7);
  const rotations = [
    IDENTITY_ROTATION,
    dragRotation(IDENTITY_ROTATION, 123, -81),
    dragRotation(IDENTITY_ROTATION, -313, 201),
  ];

  it.each(rotations.map((rotation) => ({ rotation })))(
    "covers the whole disk, with every logical cell visible, for rotation $rotation",
    ({ rotation }) => {
      const fragments = projectBoard(mesh, rotation);
      expect(new Set(fragments.map((fragment) => fragment.cellId)).size).toBe(
        246,
      );
      expect(
        Math.abs(
          fragments.reduce((sum, fragment) => sum + fragment.area, 0) - Math.PI,
        ),
      ).toBeLessThan(0.00015);
      for (const fragment of fragments) {
        for (const point of fragment.points)
          expect(radius(point)).toBeLessThanOrEqual(1 + 1e-12);
        expect(pointInFragment(fragment.label, fragment)).toBe(true);
        expect(fragment.path.endsWith(" Z")).toBe(true);
      }
      // A deterministic distribution of interior probes detects holes and overlaps.
      // Avoid the perimeter's subpixel tessellation error by staying inside r = .99.
      for (let sample = 0; sample < 180; sample += 1) {
        const angle = sample * Math.PI * (3 - Math.sqrt(5));
        const r = 0.99 * Math.sqrt((sample + 0.5) / 180);
        const point: Vec2 = [Math.cos(angle) * r, Math.sin(angle) * r];
        expect(
          fragments.filter((fragment) => pointInFragment(point, fragment)),
        ).toHaveLength(1);
      }
    },
  );

  it("renders both parts of a seam cell with precisely antipodal boundary arcs", () => {
    const groups = splitGroups(projectBoard(mesh, rotations[1]));
    expect(groups.length).toBeGreaterThan(10);
    for (const [a, b] of groups) {
      expect(a.cellId).toBe(b.cellId);
      expect(a.crossesBoundary).toBe(true);
      expect(b.crossesBoundary).toBe(true);
      const boundaryA = a.points.filter(
        (point) => Math.abs(radius(point) - 1) < 1e-10,
      );
      const boundaryB = b.points.filter(
        (point) => Math.abs(radius(point) - 1) < 1e-10,
      );
      expect(boundaryA.length).toBeGreaterThanOrEqual(2);
      expect(boundaryA.length).toBe(boundaryB.length);
      for (const point of boundaryA) {
        expect(
          boundaryB.some(
            (other) =>
              Math.hypot(point[0] + other[0], point[1] + other[1]) < 1e-10,
          ),
        ).toBe(true);
      }
    }
  });

  it("keeps the logical cell IDs and topology stable during rotation", () => {
    const originalTopology = JSON.stringify(mesh);
    for (const rotation of rotations) {
      const fragments = projectBoard(mesh, rotation);
      for (const [a, b] of splitGroups(fragments))
        expect(a.cellId).toBe(b.cellId);
      for (const fragment of fragments) {
        expect(mesh.cells[fragment.cellId].neighbors).toHaveLength(
          mesh.cells[fragment.cellId].polygon.length,
        );
        for (const neighbor of mesh.cells[fragment.cellId].neighbors)
          expect(mesh.cells[neighbor].neighbors).toContain(fragment.cellId);
      }
    }
    expect(JSON.stringify(mesh)).toBe(originalTopology);
  });

  it("preserves topology for adjacent cells whose displayed centers are on opposite sides of the disk", () => {
    const fragments = projectBoard(mesh, rotations[1]);
    const largest = new Map<number, CellFragment>();
    for (const fragment of fragments)
      if (
        !largest.has(fragment.cellId) ||
        largest.get(fragment.cellId)!.area < fragment.area
      )
        largest.set(fragment.cellId, fragment);
    const seamEdges = mesh.edges.filter((edge) => {
      const a = largest.get(edge.cells[0])!.label;
      const b = largest.get(edge.cells[1])!.label;
      return Math.hypot(a[0] - b[0], a[1] - b[1]) > 1.5;
    });
    expect(seamEdges.length).toBeGreaterThan(0);
    for (const edge of seamEdges) {
      expect(mesh.cells[edge.cells[0]].neighbors).toContain(edge.cells[1]);
      expect(mesh.cells[edge.cells[1]].neighbors).toContain(edge.cells[0]);
    }
  });
});
