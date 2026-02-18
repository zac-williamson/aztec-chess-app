/**
 * Legal move generator for fog-of-war chess on the Noir board format.
 *
 * Key differences from standard chess:
 * - No check/checkmate — king capture ends the game
 * - Moving into "check" is allowed (you can't see the threat)
 * - No castling in v1
 * - Pawns auto-promote to queen on reaching the back rank
 */

import { PIECE_IDS, WHITE_PLAYER } from "./types";

export interface SimplePiece {
  id: number;
  player_id: number;
  has_moved: number;
}

export interface Move {
  fromIndex: number;
  toIndex: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  capturedPieceId: number; // PIECE_IDS.EMPTY if no capture
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

/** Convert Noir board piece to SimplePiece with numeric fields. */
function toPiece(p: any): SimplePiece {
  return {
    id: Number(p.id),
    player_id: Number(p.player_id),
    has_moved: Number(p.has_moved),
  };
}

/**
 * Generate all legal moves for the given player on a Noir-format board.
 * Board is a 64-element array where index = x + y*8, y=0 is White's back rank.
 */
export function generateAllLegalMoves(board: any[], playerId: number): Move[] {
  const moves: Move[] = [];

  for (let i = 0; i < 64; i++) {
    const piece = toPiece(board[i]);
    if (piece.id === PIECE_IDS.EMPTY || piece.player_id !== playerId) continue;

    const x = i % 8;
    const y = Math.floor(i / 8);

    switch (piece.id) {
      case PIECE_IDS.WHITE_PAWN:
        addPawnMoves(moves, board, x, y, playerId, 1); // white pawns move +y
        break;
      case PIECE_IDS.BLACK_PAWN:
        addPawnMoves(moves, board, x, y, playerId, -1); // black pawns move -y
        break;
      case PIECE_IDS.KNIGHT:
        addKnightMoves(moves, board, x, y, playerId);
        break;
      case PIECE_IDS.BISHOP:
        addSlidingMoves(moves, board, x, y, playerId, DIAGONAL_DIRS);
        break;
      case PIECE_IDS.ROOK:
        addSlidingMoves(moves, board, x, y, playerId, CARDINAL_DIRS);
        break;
      case PIECE_IDS.QUEEN:
        addSlidingMoves(moves, board, x, y, playerId, ALL_DIRS);
        break;
      case PIECE_IDS.KING:
        addKingMoves(moves, board, x, y, playerId);
        break;
    }
  }

  return moves;
}

const DIAGONAL_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const CARDINAL_DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const ALL_DIRS: [number, number][] = [...DIAGONAL_DIRS, ...CARDINAL_DIRS];

function canMoveTo(board: any[], toIndex: number, playerId: number): boolean {
  const target = toPiece(board[toIndex]);
  // Can move to empty squares or squares with opponent's pieces
  return target.id === PIECE_IDS.EMPTY || target.player_id !== playerId;
}

function addMove(moves: Move[], board: any[], fromX: number, fromY: number, toX: number, toY: number): void {
  const fromIndex = fromX + fromY * 8;
  const toIndex = toX + toY * 8;
  const target = toPiece(board[toIndex]);
  moves.push({
    fromIndex,
    toIndex,
    fromX,
    fromY,
    toX,
    toY,
    capturedPieceId: target.id,
  });
}

function addPawnMoves(
  moves: Move[],
  board: any[],
  x: number,
  y: number,
  playerId: number,
  forward: number // +1 for white, -1 for black
): void {
  // One square forward
  const ny1 = y + forward;
  if (!inBounds(x, ny1)) return;

  const fwdIndex = x + ny1 * 8;
  const fwdPiece = toPiece(board[fwdIndex]);
  if (fwdPiece.id === PIECE_IDS.EMPTY) {
    addMove(moves, board, x, y, x, ny1);

    // Two squares forward from starting rank
    const startY = forward === 1 ? 1 : 6;
    if (y === startY) {
      const ny2 = y + forward * 2;
      const fwd2Index = x + ny2 * 8;
      const fwd2Piece = toPiece(board[fwd2Index]);
      if (fwd2Piece.id === PIECE_IDS.EMPTY) {
        addMove(moves, board, x, y, x, ny2);
      }
    }
  }

  // Diagonal captures
  for (const dx of [-1, 1]) {
    const nx = x + dx;
    if (!inBounds(nx, ny1)) continue;
    const diagIndex = nx + ny1 * 8;
    const diagPiece = toPiece(board[diagIndex]);
    if (diagPiece.id !== PIECE_IDS.EMPTY && diagPiece.player_id !== playerId) {
      addMove(moves, board, x, y, nx, ny1);
    }
  }
}

function addKnightMoves(
  moves: Move[],
  board: any[],
  x: number,
  y: number,
  playerId: number
): void {
  const offsets: [number, number][] = [
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [2, -1], [1, -2], [-1, -2], [-2, -1],
  ];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (!inBounds(nx, ny)) continue;
    if (canMoveTo(board, nx + ny * 8, playerId)) {
      addMove(moves, board, x, y, nx, ny);
    }
  }
}

function addSlidingMoves(
  moves: Move[],
  board: any[],
  x: number,
  y: number,
  playerId: number,
  directions: [number, number][]
): void {
  for (const [dx, dy] of directions) {
    for (let dist = 1; dist <= 7; dist++) {
      const nx = x + dx * dist;
      const ny = y + dy * dist;
      if (!inBounds(nx, ny)) break;

      const idx = nx + ny * 8;
      const target = toPiece(board[idx]);

      if (target.id === PIECE_IDS.EMPTY) {
        addMove(moves, board, x, y, nx, ny);
      } else if (target.player_id !== playerId) {
        // Capture opponent piece, then stop
        addMove(moves, board, x, y, nx, ny);
        break;
      } else {
        // Own piece blocks
        break;
      }
    }
  }
}

function addKingMoves(
  moves: Move[],
  board: any[],
  x: number,
  y: number,
  playerId: number
): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(nx, ny)) continue;
      if (canMoveTo(board, nx + ny * 8, playerId)) {
        addMove(moves, board, x, y, nx, ny);
      }
    }
  }
}

/**
 * Apply a move to a board (mutates a copy). Returns a new board array.
 * Handles pawn auto-promotion to queen.
 */
export function applyMove(board: any[], move: Move, playerId: number): any[] {
  const newBoard = board.map((p: any) => ({ ...p }));

  const piece = newBoard[move.fromIndex];
  const pieceId = Number(piece.id);

  // Move piece to destination
  newBoard[move.toIndex] = { ...piece, has_moved: 1 };

  // Clear source square
  newBoard[move.fromIndex] = { id: 0, player_id: 0, has_moved: 0 };

  // Auto-promote pawns
  if (pieceId === PIECE_IDS.WHITE_PAWN && move.toY === 7) {
    newBoard[move.toIndex].id = PIECE_IDS.QUEEN;
  } else if (pieceId === PIECE_IDS.BLACK_PAWN && move.toY === 0) {
    newBoard[move.toIndex].id = PIECE_IDS.QUEEN;
  }

  return newBoard;
}
