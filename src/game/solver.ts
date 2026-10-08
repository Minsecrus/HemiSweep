/**
 * A sound minesweeper solver used to certify that a layout needs no guessing.
 * It knows the true layout only to report the number shown on each cell that a
 * player could reveal; every reveal follows from logic over visible numbers.
 */

const UNKNOWN = 0;
const REVEALED = 1;
const MINE = 2;

/** Largest set of unknown cells enumerated together. */
const WINDOW_LIMIT = 18;
/** Backtracking nodes allowed per window before giving up on it. */
const ENUMERATION_BUDGET = 4_000;

export interface SolveResult {
  /** True when every safe cell was revealed by deduction alone. */
  solved: boolean;
  /** Cells revealed by the solver, including the starting cell. */
  revealed: number;
  /** Unrevealed cells that the solver could not classify, if it got stuck. */
  stuck: number[];
}

/**
 * Starting from a click on `start`, reveal cells exactly as a perfect logical
 * player would: trivial counts, two-constraint overlaps, the global mine
 * count, and exhaustive enumeration of local frontier windows.
 */
export function solveFrom(
  neighbors: readonly (readonly number[])[],
  mines: readonly boolean[],
  start: number,
): SolveResult {
  const n = neighbors.length;
  const totalMines = mines.reduce((count, mine) => count + Number(mine), 0);
  const counts = neighbors.map((row) =>
    row.reduce((count, other) => count + Number(mines[other]), 0),
  );
  const state = new Uint8Array(n);
  const pending: number[] = [];
  const queued = new Uint8Array(n);
  let revealedCount = 0;
  let knownMines = 0;

  const enqueue = (id: number) => {
    if (state[id] === REVEALED && !queued[id]) {
      queued[id] = 1;
      pending.push(id);
    }
  };
  const touch = (id: number) => {
    enqueue(id);
    for (const other of neighbors[id]) enqueue(other);
  };
  const markSafe = (id: number) => {
    if (state[id] !== UNKNOWN) return;
    if (mines[id]) throw new Error("The solver deduced a mine to be safe.");
    state[id] = REVEALED;
    revealedCount += 1;
    touch(id);
  };
  const markMine = (id: number) => {
    if (state[id] !== UNKNOWN) return;
    if (!mines[id]) throw new Error("The solver deduced a safe cell as mine.");
    state[id] = MINE;
    knownMines += 1;
    touch(id);
  };

  /** Unknown neighbors and still-unaccounted mines around a revealed cell. */
  const constraint = (id: number): { cells: number[]; mines: number } => {
    const cells: number[] = [];
    let remaining = counts[id];
    for (const other of neighbors[id]) {
      if (state[other] === UNKNOWN) cells.push(other);
      else if (state[other] === MINE) remaining -= 1;
    }
    return { cells, mines: remaining };
  };

  /** Apply single-cell rules until nothing changes. */
  function propagate(): void {
    for (let cursor = 0; cursor < pending.length; cursor += 1) {
      const id = pending[cursor];
      queued[id] = 0;
      const { cells, mines: remaining } = constraint(id);
      if (!cells.length) continue;
      if (remaining === 0) cells.forEach(markSafe);
      else if (remaining === cells.length) cells.forEach(markMine);
    }
    pending.length = 0;
  }

  const frontierConstraints = (): number[] => {
    const result: number[] = [];
    for (let id = 0; id < n; id += 1) {
      if (state[id] !== REVEALED) continue;
      if (neighbors[id].some((other) => state[other] === UNKNOWN))
        result.push(id);
    }
    return result;
  };

  /**
   * For two overlapping constraints A and B, bound the mines in A∩B and
   * classify A\B or B\A when the bound forces them. Subsets are a special case.
   */
  function pairRule(): boolean {
    const mark = new Int32Array(n).fill(-1);
    for (const a of frontierConstraints()) {
      const A = constraint(a);
      for (const cell of A.cells) mark[cell] = a;
      const partners = new Set<number>();
      for (const cell of A.cells)
        for (const other of neighbors[cell])
          if (other !== a && state[other] === REVEALED) partners.add(other);
      for (const b of partners) {
        const B = constraint(b);
        const shared = B.cells.filter((cell) => mark[cell] === a).length;
        const onlyA = A.cells.length - shared;
        const onlyB = B.cells.length - shared;
        const low = Math.max(0, A.mines - onlyA, B.mines - onlyB);
        const high = Math.min(shared, A.mines, B.mines);
        const onlyBCells = () => B.cells.filter((cell) => mark[cell] !== a);
        const onlyACells = () => {
          const inB = new Set(B.cells);
          return A.cells.filter((cell) => !inB.has(cell));
        };
        if (onlyA && A.mines - low === 0) {
          onlyACells().forEach(markSafe);
          return true;
        }
        if (onlyA && A.mines - high === onlyA) {
          onlyACells().forEach(markMine);
          return true;
        }
        if (onlyB && B.mines - low === 0) {
          onlyBCells().forEach(markSafe);
          return true;
        }
        if (onlyB && B.mines - high === onlyB) {
          onlyBCells().forEach(markMine);
          return true;
        }
      }
    }
    return false;
  }

  function globalRule(): boolean {
    const unknown: number[] = [];
    for (let id = 0; id < n; id += 1)
      if (state[id] === UNKNOWN) unknown.push(id);
    const remaining = totalMines - knownMines;
    if (!unknown.length) return false;
    if (remaining === 0) unknown.forEach(markSafe);
    else if (remaining === unknown.length) unknown.forEach(markMine);
    else return false;
    return true;
  }

  /** Frontier unknowns linked to `root` through shared constraints, in BFS order. */
  function linkedUnknowns(root: number, limit: number): number[] {
    const cells = [root];
    const seen = new Set(cells);
    for (let cursor = 0; cursor < cells.length; cursor += 1) {
      for (const clue of neighbors[cells[cursor]]) {
        if (state[clue] !== REVEALED) continue;
        for (const other of neighbors[clue]) {
          if (state[other] !== UNKNOWN || seen.has(other)) continue;
          if (cells.length >= limit) return cells;
          seen.add(other);
          cells.push(other);
        }
      }
    }
    return cells;
  }

  /**
   * Enumerate assignments of `window` consistent with every visible clue.
   * Clue cells outside the window are free, which only relaxes the clues, so
   * a value shared by all assignments is forced. Null if over budget.
   */
  function enumerate(
    window: readonly number[],
    unknownTotal: number,
    remainingMines: number,
  ): { canBeMine: Uint8Array; canBeSafe: Uint8Array } | null {
    const index = new Map(window.map((cell, i) => [cell, i]));
    const clues = new Set<number>();
    for (const cell of window)
      for (const other of neighbors[cell])
        if (state[other] === REVEALED) clues.add(other);
    const rules = [...clues].map((id) => {
      const { cells: scope, mines: need } = constraint(id);
      const inside = scope.filter((cell) => index.has(cell));
      return {
        open: inside.length,
        need,
        outside: scope.length - inside.length,
      };
    });
    const rulesOf: number[][] = window.map(() => []);
    [...clues].forEach((id, r) => {
      for (const other of neighbors[id]) {
        const i = index.get(other);
        if (i !== undefined) rulesOf[i].push(r);
      }
    });
    const placed = rules.map(() => 0);
    const assignment = new Uint8Array(window.length);
    const canBeMine = new Uint8Array(window.length);
    const canBeSafe = new Uint8Array(window.length);
    const others = unknownTotal - window.length;
    let nodes = 0;
    let mineTotal = 0;

    const assign = (cell: number, value: number): boolean => {
      assignment[cell] = value;
      mineTotal += value;
      let ok = true;
      for (const r of rulesOf[cell]) {
        const rule = rules[r];
        placed[r] += value;
        rule.open -= 1;
        if (
          placed[r] > rule.need ||
          placed[r] + rule.open + rule.outside < rule.need
        )
          ok = false;
      }
      return ok;
    };
    const unassign = (cell: number, value: number) => {
      mineTotal -= value;
      for (const r of rulesOf[cell]) {
        placed[r] -= value;
        rules[r].open += 1;
      }
    };
    const search = (depth: number): boolean => {
      if ((nodes += 1) > ENUMERATION_BUDGET) return false;
      if (mineTotal > remainingMines) return true;
      if (depth === window.length) {
        // Cells outside the window must absorb the remaining mines.
        if (remainingMines - mineTotal > others) return true;
        for (let i = 0; i < window.length; i += 1) {
          if (assignment[i]) canBeMine[i] = 1;
          else canBeSafe[i] = 1;
        }
        return true;
      }
      for (const value of [0, 1]) {
        const ok = assign(depth, value) ? search(depth + 1) : true;
        unassign(depth, value);
        if (!ok) return false;
      }
      return true;
    };
    return search(0) ? { canBeMine, canBeSafe } : null;
  }

  /**
   * Enumerate local windows around each frontier unknown, growing them up to
   * WINDOW_LIMIT cells. Whole small components are covered exactly.
   */
  function enumerationRule(): boolean {
    let unknownTotal = 0;
    for (let id = 0; id < n; id += 1)
      unknownTotal += Number(state[id] === UNKNOWN);
    const remainingMines = totalMines - knownMines;
    const covered = new Uint8Array(n);
    for (const clue of frontierConstraints()) {
      for (const root of neighbors[clue]) {
        if (state[root] !== UNKNOWN || covered[root]) continue;
        const window = linkedUnknowns(root, WINDOW_LIMIT);
        // A window that closed before the limit is a whole component.
        if (window.length < WINDOW_LIMIT)
          for (const cell of window) covered[cell] = 1;
        const result = enumerate(window, unknownTotal, remainingMines);
        if (!result) continue;
        let progressed = false;
        window.forEach((cell, i) => {
          if (!result.canBeMine[i]) {
            markSafe(cell);
            progressed = true;
          } else if (!result.canBeSafe[i]) {
            markMine(cell);
            progressed = true;
          }
        });
        if (progressed) return true;
      }
    }
    return false;
  }

  markSafe(start);
  for (;;) {
    propagate();
    if (revealedCount + totalMines === n) break;
    if (pairRule() || globalRule() || enumerationRule()) continue;
    break;
  }
  const solved = revealedCount + totalMines === n;
  const stuck: number[] = [];
  if (!solved)
    for (let id = 0; id < n; id += 1) if (state[id] === UNKNOWN) stuck.push(id);
  return { solved, revealed: revealedCount, stuck };
}
