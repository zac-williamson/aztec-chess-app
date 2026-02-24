import { describe, it, expect } from "vitest";
import {
  PIECE_SYMBOLS,
  noirIndexToRowCol,
  rowColToNoirXY,
  computeClientVision,
  isOwnPiece,
  validateMovePattern,
  getValidMoves,
  FILE_LABELS,
  RANK_LABELS,
} from "./chessUtils";
import { PIECE_IDS, WHITE_PLAYER, type BoardSquare } from "./types";

// ─── Helpers ─────────────────────────────────────────────

/** Create an empty 64-square game state (matching contract format). */
function emptyGameState() {
  return Array.from({ length: 64 }, () => ({
    id: BigInt(PIECE_IDS.EMPTY),
    player_id: 0n,
  }));
}

/** Place a piece on the game state at Noir coords (x, y). */
function placePiece(
  gs: ReturnType<typeof emptyGameState>,
  x: number,
  y: number,
  pieceId: number,
  playerId: number
) {
  gs[x + y * 8] = { id: BigInt(pieceId), player_id: BigInt(playerId) };
}

/** Build a minimal 8x8 BoardSquare array for move validation tests. */
function emptyBoard(): BoardSquare[][] {
  return Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({
      piece: null,
      pieceColor: null,
      visible: true,
      potentiallyVisible: false,
      isSelected: false,
    }))
  );
}

function placeOnBoard(
  board: BoardSquare[][],
  row: number,
  col: number,
  piece: string,
  color: "white" | "black"
) {
  board[row][col] = {
    piece,
    pieceColor: color,
    visible: true,
    potentiallyVisible: false,
    isSelected: false,
  };
}

// ─── PIECE_SYMBOLS ───────────────────────────────────────

describe("PIECE_SYMBOLS", () => {
  it("has entries for all six piece types", () => {
    expect(Object.keys(PIECE_SYMBOLS).sort()).toEqual(
      ["B", "K", "N", "P", "Q", "R"]
    );
  });

  it("maps to filled Unicode chess symbols", () => {
    expect(PIECE_SYMBOLS["K"]).toBe("\u265A");
    expect(PIECE_SYMBOLS["Q"]).toBe("\u265B");
    expect(PIECE_SYMBOLS["P"]).toBe("\u265F");
  });
});

// ─── Coordinate helpers ──────────────────────────────────

describe("noirIndexToRowCol", () => {
  it("converts index 0 (a1) to bottom-left for white perspective", () => {
    // Noir: x=0, y=0 → White perspective: row=7, col=0
    expect(noirIndexToRowCol(0, "white")).toEqual({ row: 7, col: 0 });
  });

  it("converts index 63 (h8) to top-right for white perspective", () => {
    // Noir: x=7, y=7 → White perspective: row=0, col=7
    expect(noirIndexToRowCol(63, "white")).toEqual({ row: 0, col: 7 });
  });

  it("converts index 0 (a1) to top-right for black perspective", () => {
    // Noir: x=0, y=0 → Black perspective: row=0, col=7
    expect(noirIndexToRowCol(0, "black")).toEqual({ row: 0, col: 7 });
  });

  it("converts index 63 (h8) to bottom-left for black perspective", () => {
    // Noir: x=7, y=7 → Black perspective: row=7, col=0
    expect(noirIndexToRowCol(63, "black")).toEqual({ row: 7, col: 0 });
  });
});

describe("rowColToNoirXY", () => {
  it("is the inverse of noirIndexToRowCol for white", () => {
    for (let i = 0; i < 64; i++) {
      const { row, col } = noirIndexToRowCol(i, "white");
      const { x, y } = rowColToNoirXY(row, col, "white");
      expect(x + y * 8).toBe(i);
    }
  });

  it("is the inverse of noirIndexToRowCol for black", () => {
    for (let i = 0; i < 64; i++) {
      const { row, col } = noirIndexToRowCol(i, "black");
      const { x, y } = rowColToNoirXY(row, col, "black");
      expect(x + y * 8).toBe(i);
    }
  });
});

// ─── FILE_LABELS / RANK_LABELS ───────────────────────────

describe("labels", () => {
  it("FILE_LABELS has a-h", () => {
    expect(FILE_LABELS).toEqual(["a", "b", "c", "d", "e", "f", "g", "h"]);
  });
  it("RANK_LABELS has 1-8", () => {
    expect(RANK_LABELS).toEqual(["1", "2", "3", "4", "5", "6", "7", "8"]);
  });
});

// ─── computeClientVision ─────────────────────────────────

describe("computeClientVision", () => {
  it("returns all false for an empty board", () => {
    const gs = emptyGameState();
    const vision = computeClientVision(gs, WHITE_PLAYER);
    expect(vision.every((v) => v === false)).toBe(true);
  });

  it("marks a knight's square and L-shape squares visible", () => {
    const gs = emptyGameState();
    // Place a white knight at d4 (x=3, y=3)
    placePiece(gs, 3, 3, PIECE_IDS.KNIGHT, WHITE_PLAYER);
    const vision = computeClientVision(gs, WHITE_PLAYER);

    // Own square
    expect(vision[3 + 3 * 8]).toBe(true);

    // All 8 L-shape destinations
    const knightMoves = [
      [5, 4], [4, 5], [2, 5], [1, 4],
      [5, 2], [4, 1], [2, 1], [1, 2],
    ];
    for (const [nx, ny] of knightMoves) {
      expect(vision[nx + ny * 8]).toBe(true);
    }
  });

  it("king sees all 8 adjacent squares", () => {
    const gs = emptyGameState();
    // White king at e4 (x=4, y=3)
    placePiece(gs, 4, 3, PIECE_IDS.KING, WHITE_PLAYER);
    const vision = computeClientVision(gs, WHITE_PLAYER);

    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nx = 4 + dx;
        const ny = 3 + dy;
        expect(vision[nx + ny * 8]).toBe(true);
      }
    }
  });

  it("rook vision is blocked by a piece", () => {
    const gs = emptyGameState();
    // White rook at a1 (x=0, y=0)
    placePiece(gs, 0, 0, PIECE_IDS.ROOK, WHITE_PLAYER);
    // Blocking piece at a4 (x=0, y=3)
    placePiece(gs, 0, 3, PIECE_IDS.ROOK, 1); // opponent piece

    const vision = computeClientVision(gs, WHITE_PLAYER);

    // Rook sees along the file up to and including the blocker
    expect(vision[0 + 1 * 8]).toBe(true); // a2
    expect(vision[0 + 2 * 8]).toBe(true); // a3
    expect(vision[0 + 3 * 8]).toBe(true); // a4 (blocker itself is visible)
    expect(vision[0 + 4 * 8]).toBe(false); // a5 blocked
  });

  it("white pawn sees forward and diagonal squares", () => {
    const gs = emptyGameState();
    // White pawn at e2 (x=4, y=1)
    placePiece(gs, 4, 1, PIECE_IDS.WHITE_PAWN, WHITE_PLAYER);
    const vision = computeClientVision(gs, WHITE_PLAYER);

    // Own square
    expect(vision[4 + 1 * 8]).toBe(true);
    // One forward (e3)
    expect(vision[4 + 2 * 8]).toBe(true);
    // Two forward from starting rank (e4) - only if e3 empty (it is)
    expect(vision[4 + 3 * 8]).toBe(true);
    // Diagonals (d3, f3)
    expect(vision[3 + 2 * 8]).toBe(true);
    expect(vision[5 + 2 * 8]).toBe(true);
  });

  it("does not show opponent's pieces' vision", () => {
    const gs = emptyGameState();
    // Only opponent pieces on the board
    placePiece(gs, 4, 4, PIECE_IDS.QUEEN, 1); // black queen
    const vision = computeClientVision(gs, WHITE_PLAYER);
    expect(vision.every((v) => v === false)).toBe(true);
  });
});

// ─── isOwnPiece ──────────────────────────────────────────

describe("isOwnPiece", () => {
  it("returns true for own color", () => {
    const sq: BoardSquare = {
      piece: "K",
      pieceColor: "white",
      visible: true,
      potentiallyVisible: false,
      isSelected: false,
    };
    expect(isOwnPiece(sq, "white")).toBe(true);
    expect(isOwnPiece(sq, "black")).toBe(false);
  });

  it("returns false for empty square", () => {
    const sq: BoardSquare = {
      piece: null,
      pieceColor: null,
      visible: true,
      potentiallyVisible: false,
      isSelected: false,
    };
    expect(isOwnPiece(sq, "white")).toBe(false);
  });
});

// ─── validateMovePattern ─────────────────────────────────

describe("validateMovePattern", () => {
  it("rejects moving from empty square", () => {
    const board = emptyBoard();
    expect(validateMovePattern(board, 4, 4, 5, 5, "white")).toBe(
      "No piece on source square"
    );
  });

  it("rejects moving opponent's piece", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "P", "black");
    expect(validateMovePattern(board, 4, 4, 3, 4, "white")).toBe(
      "Not your piece"
    );
  });

  it("rejects capturing own piece", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "R", "white");
    placeOnBoard(board, 4, 6, "P", "white");
    expect(validateMovePattern(board, 4, 4, 4, 6, "white")).toBe(
      "Cannot capture your own piece"
    );
  });

  it("allows valid knight L-move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "N", "white");
    expect(validateMovePattern(board, 4, 4, 2, 5, "white")).toBeNull();
  });

  it("rejects non-L knight move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "N", "white");
    expect(validateMovePattern(board, 4, 4, 4, 5, "white")).toBe(
      "Knights move in an L-shape (2+1 squares)"
    );
  });

  it("allows single pawn forward move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 5, 3, "P", "white"); // row 5 = not starting row
    expect(validateMovePattern(board, 5, 3, 4, 3, "white")).toBeNull();
  });

  it("allows double pawn move from starting row", () => {
    const board = emptyBoard();
    placeOnBoard(board, 6, 3, "P", "white"); // row 6 = starting row
    expect(validateMovePattern(board, 6, 3, 4, 3, "white")).toBeNull();
  });

  it("rejects double pawn move from non-starting row", () => {
    const board = emptyBoard();
    placeOnBoard(board, 5, 3, "P", "white");
    expect(validateMovePattern(board, 5, 3, 3, 3, "white")).toBe(
      "Pawns can only move two squares from their starting position"
    );
  });

  it("allows pawn diagonal capture", () => {
    const board = emptyBoard();
    placeOnBoard(board, 5, 3, "P", "white");
    placeOnBoard(board, 4, 4, "P", "black");
    expect(validateMovePattern(board, 5, 3, 4, 4, "white")).toBeNull();
  });

  it("allows bishop diagonal move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "B", "white");
    expect(validateMovePattern(board, 4, 4, 1, 7, "white")).toBeNull();
  });

  it("rejects non-diagonal bishop move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "B", "white");
    expect(validateMovePattern(board, 4, 4, 4, 6, "white")).toBe(
      "Bishops move diagonally"
    );
  });

  it("allows rook horizontal move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "R", "white");
    expect(validateMovePattern(board, 4, 4, 4, 7, "white")).toBeNull();
  });

  it("rejects rook diagonal move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "R", "white");
    expect(validateMovePattern(board, 4, 4, 5, 5, "white")).toBe(
      "Rooks move horizontally or vertically"
    );
  });

  it("allows queen in any straight line", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "Q", "white");
    expect(validateMovePattern(board, 4, 4, 4, 0, "white")).toBeNull(); // horizontal
    expect(validateMovePattern(board, 4, 4, 0, 4, "white")).toBeNull(); // vertical
    expect(validateMovePattern(board, 4, 4, 7, 7, "white")).toBeNull(); // diagonal
  });

  it("allows king one-square move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "K", "white");
    expect(validateMovePattern(board, 4, 4, 3, 4, "white")).toBeNull();
  });

  it("rejects king multi-square move", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "K", "white");
    expect(validateMovePattern(board, 4, 4, 2, 4, "white")).toBe(
      "Kings move one square in any direction"
    );
  });
});

// ─── getValidMoves ───────────────────────────────────────

describe("getValidMoves", () => {
  it("returns empty for empty square", () => {
    const board = emptyBoard();
    expect(getValidMoves(board, 4, 4, "white")).toEqual([]);
  });

  it("returns correct moves for a knight in the center", () => {
    const board = emptyBoard();
    placeOnBoard(board, 4, 4, "N", "white");
    const moves = getValidMoves(board, 4, 4, "white");
    expect(moves.length).toBe(8); // center knight has 8 possible moves
  });

  it("returns fewer moves for a knight in the corner", () => {
    const board = emptyBoard();
    placeOnBoard(board, 0, 0, "N", "white");
    const moves = getValidMoves(board, 0, 0, "white");
    expect(moves.length).toBe(2); // corner knight: (1,2) and (2,1)
  });

  it("sliding piece is blocked by own piece", () => {
    const board = emptyBoard();
    placeOnBoard(board, 7, 0, "R", "white");
    placeOnBoard(board, 7, 3, "P", "white"); // blocks horizontal
    placeOnBoard(board, 5, 0, "P", "white"); // blocks vertical
    const moves = getValidMoves(board, 7, 0, "white");
    // Can move to (7,1), (7,2) horizontally and (6,0) vertically = 3 moves
    expect(moves.length).toBe(3);
  });
});
