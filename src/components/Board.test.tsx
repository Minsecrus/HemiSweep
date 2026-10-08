import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createGame, revealCell, toggleFlag } from "../game/engine";
import type { GameState } from "../game/types";
import {
  dragRotation,
  IDENTITY_ROTATION,
  pointInFragment,
  projectBoard,
} from "../geometry/projection";
import { createRegularMesh, REGULAR_SYMBOLS } from "../geometry/regular";
import { createBoardMesh } from "../geometry/tilings";
import { createProjectiveMesh } from "../geometry/topology";
import { createAdjacencyGraph } from "../geometry/adjacency";
import type { BoardMesh, CellFragment, Quaternion } from "../geometry/types";
import Board from "./Board";

interface RenderedCell {
  id: number;
  openingTag: string;
  markup: string;
}

const noop = () => undefined;

function render(
  mesh: BoardMesh,
  game: GameState,
  rotation: Quaternion,
): string {
  return renderToStaticMarkup(
    <Board
      mesh={mesh}
      game={game}
      rotation={rotation}
      setRotation={noop}
      topology={true}
      reveal={noop}
      flag={noop}
      chord={noop}
    />,
  );
}

/** Read complete nested SVG groups, rather than matching through child labels. */
function renderedCells(markup: string): RenderedCell[] {
  const cells: RenderedCell[] = [];
  const stack: { index: number; id: number | null; openingTag: string }[] = [];
  for (const match of markup.matchAll(/<\/?g\b[^>]*>/g)) {
    const tag = match[0];
    if (!tag.startsWith("</")) {
      const id = tag.match(/\bdata-cell="(\d+)"/);
      stack.push({
        index: match.index,
        id: id ? Number(id[1]) : null,
        openingTag: tag,
      });
    } else {
      const opening = stack.pop();
      if (opening?.id !== null && opening !== undefined) {
        cells.push({
          id: opening.id,
          openingTag: opening.openingTag,
          markup: markup.slice(opening.index, match.index + tag.length),
        });
      }
    }
  }
  return cells;
}

function classes(cell: RenderedCell): string[] {
  const firstPath = cell.markup.match(/<path\b[^>]*class="([^"]*)"[^>]*>/);
  expect(firstPath, "every rendered cell has a styled polygon").not.toBeNull();
  return firstPath![1].split(/\s+/).filter(Boolean);
}

function seamCell(
  fragments: CellFragment[],
  predicate: (id: number) => boolean = () => true,
): number {
  const groups = new Map<number, CellFragment[]>();
  for (const fragment of fragments)
    groups.set(fragment.cellId, [
      ...(groups.get(fragment.cellId) ?? []),
      fragment,
    ]);
  const match = [...groups].find(
    ([id, parts]) =>
      predicate(id) &&
      parts.length === 2 &&
      parts.every((part) => part.area > 0.001),
  );
  expect(
    match,
    "fixture contains two readable fragments of the same logical cell",
  ).toBeDefined();
  return match![0];
}

describe("SVG board displays the quotient game state", () => {
  const mesh = createProjectiveMesh(7);
  const graph = mesh.cells.map((cell) => cell.neighbors);
  const rotation = dragRotation(IDENTITY_ROTATION, 123, -81);
  const fragments = projectBoard(mesh, rotation);

  it("renders a flag on both antipodal seam fragments from one actual game state", () => {
    const id = seamCell(fragments);
    const game = toggleFlag(createGame(graph, 36, "svg-seam-flag"), id);
    const parts = renderedCells(render(mesh, game, rotation)).filter(
      (cell) => cell.id === id,
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.openingTag).toContain('data-flagged="true"');
      expect(part.openingTag).toContain('data-revealed="false"');
      expect(part.openingTag).toContain('data-split="true"');
      expect(classes(part)).toContain("flagged");
      expect(classes(part)).toContain("seam");
      expect(part.markup).toContain("lucide-flag");
    }
    const removed = renderedCells(
      render(mesh, toggleFlag(game, id), rotation),
    ).filter((cell) => cell.id === id);
    expect(removed).toHaveLength(2);
    for (const part of removed) {
      expect(part.openingTag).toContain('data-flagged="false"');
      expect(classes(part)).not.toContain("flagged");
      expect(part.markup).not.toContain("lucide-flag");
    }
  });

  it("reveals both visible pieces after the safe first click on a seam cell", () => {
    const id = seamCell(fragments);
    const game = revealCell(createGame(graph, 36, "svg-seam-reveal"), id, 1000);
    expect(game.cells[id].mine).toBe(false);
    const parts = renderedCells(render(mesh, game, rotation)).filter(
      (cell) => cell.id === id,
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.openingTag).toContain('data-revealed="true"');
      expect(classes(part)).toContain("revealed");
      expect(classes(part)).not.toContain("hidden");
      expect(classes(part)).not.toContain("mine");
      expect(part.markup).not.toContain("lucide-bomb");
    }
  });

  it("shows the same exploded mine and bomb icon on every piece after a real loss", () => {
    const started = revealCell(createGame(graph, 36, "svg-seam-loss"), 0, 1000);
    const mineId = seamCell(fragments, (id) => started.cells[id].mine);
    const lost = revealCell(started, mineId, 2000);
    expect(lost.status).toBe("lost");
    expect(lost.explodedCell).toBe(mineId);
    const parts = renderedCells(render(mesh, lost, rotation)).filter(
      (cell) => cell.id === mineId,
    );
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(part.openingTag).toContain('data-revealed="true"');
      expect(classes(part)).toContain("mine");
      expect(classes(part)).toContain("exploded");
      expect(part.markup).toContain("lucide-bomb");
    }
  });

  it("changes paths during rotation while retaining every rendered flag and reveal status", () => {
    const flaggedId = seamCell(fragments);
    const flagged = toggleFlag(
      createGame(graph, 36, "svg-rotation"),
      flaggedId,
    );
    const game = revealCell(flagged, graph[flaggedId][0], 1000);
    const before = JSON.stringify(game);
    const markupA = render(mesh, game, rotation);
    const markupB = render(mesh, game, dragRotation(rotation, -171, 117));
    expect(markupB).not.toBe(markupA);
    expect(JSON.stringify(game)).toBe(before);
    for (const markup of [markupA, markupB]) {
      const cells = renderedCells(markup);
      expect(new Set(cells.map((cell) => cell.id)).size).toBe(246);
      for (const cell of cells) {
        expect(cell.openingTag).toContain(
          `data-flagged="${game.cells[cell.id].flagged}"`,
        );
        expect(cell.openingTag).toContain(
          `data-revealed="${game.cells[cell.id].revealed}"`,
        );
        expect(classes(cell).includes("flagged")).toBe(
          game.cells[cell.id].flagged,
        );
        expect(classes(cell).includes("revealed")).toBe(
          game.cells[cell.id].revealed,
        );
      }
    }
  });
});

describe("SVG board supports the other genuine quotient tilings", () => {
  const tilings: { name: string; mesh: BoardMesh }[] = [
    { name: "triangular", mesh: createBoardMesh(5, "triangular") },
    { name: "quadrilateral", mesh: createBoardMesh(5, "quadrilateral") },
    ...REGULAR_SYMBOLS.map((symbol) => ({
      name: `{${symbol.a},${symbol.b}}`,
      mesh: createRegularMesh(symbol.a, symbol.b),
    })),
  ];

  it("shows 9–12 mines clearly on both fragments of a vertex-adjacent cell", () => {
    const mesh = createBoardMesh(5, "triangular");
    const graph = createAdjacencyGraph(mesh, "vertex");
    const rotation = dragRotation(IDENTITY_ROTATION, 123, -81);
    const id = seamCell(
      projectBoard(mesh, rotation),
      (id) => graph[id].length === 12,
    );
    for (const count of [9, 10, 11, 12]) {
      const mines = new Set(graph[id].slice(0, count));
      const ready = createGame(graph, count, "svg-vertex-numbers");
      const game: GameState = {
        ...ready,
        status: "playing",
        startedAt: 1000,
        cells: ready.cells.map((cell, other) => ({
          ...cell,
          mine: mines.has(other),
          adjacentMines: graph[other].filter((neighbor) => mines.has(neighbor))
            .length,
          revealed: other === id,
        })),
      };
      const parts = renderedCells(render(mesh, game, rotation)).filter(
        (cell) => cell.id === id,
      );
      expect(parts).toHaveLength(2);
      for (const part of parts) {
        const number = part.markup.match(
          /<text\b[^>]*font-size="([^"]+)"[^>]*class="number number-(\d+)"[^>]*>(\d+)<\/text>/,
        );
        expect(number).not.toBeNull();
        expect(Number(number![2])).toBe(count);
        expect(Number(number![3])).toBe(count);
        expect(Number(number![1])).toBeCloseTo(
          (0.86 / Math.sqrt(mesh.cells.length)) * (count >= 10 ? 0.78 : 1),
        );
      }
    }
  });

  it.each(tilings)(
    "renders valid paths and internal label positions for $name",
    ({ mesh }) => {
      const game = createGame(
        mesh.cells.map((cell) => cell.neighbors),
        1,
        "svg-tilings",
      );
      for (const rotation of [
        IDENTITY_ROTATION,
        dragRotation(IDENTITY_ROTATION, 213, -111),
      ]) {
        const fragments = projectBoard(mesh, rotation);
        const markup = render(mesh, game, rotation);
        const cells = renderedCells(markup);
        expect(new Set(cells.map((cell) => cell.id)).size).toBe(
          mesh.cells.length,
        );
        expect(cells).toHaveLength(fragments.length);
        expect(markup).not.toMatch(/NaN|Infinity/);
        for (let index = 0; index < fragments.length; index += 1) {
          const fragment = fragments[index];
          const cell = cells[index];
          expect(cell.id).toBe(fragment.cellId);
          expect(cell.markup).toContain(`d="${fragment.path}"`);
          expect(pointInFragment(fragment.label, fragment)).toBe(true);
        }
      }
    },
  );
});
