export type GamePhase =
  | "connecting"
  | "lobby"
  | "deploying"
  | "creating"
  | "waiting_opponent"
  | "joining"
  | "playing"
  | "proving"
  | "game_over";

export type PlayerRole = "white" | "black";

// Piece type IDs from the fog_of_war_chess Noir contract (src/piece.nr)
export const PIECE_IDS = {
  EMPTY: 0,
  WHITE_PAWN: 1,
  BLACK_PAWN: 2,
  KNIGHT: 3,
  BISHOP: 4,
  ROOK: 5,
  QUEEN: 6,
  KING: 7,
} as const;

export const WHITE_PLAYER = 0;
export const BLACK_PLAYER = 1;

export interface BoardSquare {
  piece: string | null; // piece letter: "P", "N", "B", "R", "Q", "K"
  pieceColor: "white" | "black" | null;
  visible: boolean;
  potentiallyVisible: boolean; // client-side vision says yes, but waiting for opponent's MPC response
  isSelected: boolean;
}
