export type GameStatus = "ready" | "playing" | "won" | "lost";

/** One state per quotient cell, regardless of the number of visible fragments. */
export interface CellState {
  mine: boolean;
  adjacentMines: number;
  revealed: boolean;
  flagged: boolean;
}

/** The rules know only the quotient's edge-adjacency graph, never screen positions. */
export interface GameState {
  cells: CellState[];
  status: GameStatus;
  mineCount: number;
  seed: string;
  neighbors: readonly (readonly number[])[];
  startedAt: number | null;
  finishedAt: number | null;
  explodedCell: number | null;
  firstCell: number | null;
}
