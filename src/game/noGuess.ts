import { seededRandom, seededShuffle } from "./random";
import { solveFrom } from "./solver";

/** Repair moves allowed per board before giving up on the guarantee. */
const REPAIR_LIMIT_PER_MINE = 6;
const MIN_REPAIR_LIMIT = 200;

export interface NoGuessLayout {
  mines: boolean[];
  /** False when the repair budget ran out and the layout may need a guess. */
  guaranteed: boolean;
}

function pick<T>(values: readonly T[], random: () => number): T {
  return values[Math.floor(random() * values.length)];
}

/**
 * Place mines so that a logical player can clear the board from `first`.
 * Start from the plain shuffled layout; while the solver is stuck, move a mine
 * out of the unresolved region, preferring cells deep inside it, then
 * re-solve from scratch. This is the repair strategy of Simon Tatham's Mines.
 */
export function placeNoGuessMines(
  neighbors: readonly (readonly number[])[],
  mineCount: number,
  available: readonly number[],
  first: number,
  seed: string,
): NoGuessLayout {
  const n = neighbors.length;
  const mines = Array<boolean>(n).fill(false);
  for (const id of seededShuffle(available, seed).slice(0, mineCount))
    mines[id] = true;
  const movable = new Set(available);
  const random = seededRandom(`${seed}/no-guess`);
  const limit = Math.max(MIN_REPAIR_LIMIT, mineCount * REPAIR_LIMIT_PER_MINE);

  for (let move = 0; move <= limit; move += 1) {
    const { solved, stuck } = solveFrom(neighbors, mines, first);
    if (solved) return { mines, guaranteed: true };
    if (move === limit) break;

    const unresolved = new Set(stuck);
    const borders = (id: number) =>
      neighbors[id].some((other) => !unresolved.has(other));
    const stuckMines = stuck.filter((id) => mines[id] && movable.has(id));
    // A mine on the edge of the unknown region is what blocks progress.
    const sources = stuckMines.filter(borders);
    const source = pick(sources.length ? sources : stuckMines, random);
    // Move it out of sight, or failing that, into the solved region.
    const interior = stuck.filter(
      (id) => !mines[id] && movable.has(id) && !borders(id),
    );
    const outside = available.filter((id) => !mines[id] && !unresolved.has(id));
    const targets = interior.length ? interior : outside;
    if (source === undefined || !targets.length) break;
    mines[source] = false;
    mines[pick(targets, random)] = true;
  }

  // The partly repaired layout still needs fewer guesses than the original.
  return { mines, guaranteed: false };
}
