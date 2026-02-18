/**
 * PIMC (Perfect Information Monte Carlo) bot engine for fog-of-war chess.
 *
 * Algorithm:
 * 1. Maintain a belief state of where unseen opponent pieces might be
 * 2. Generate N "determinized" boards by randomly placing unseen pieces
 * 3. Evaluate each legal move across all samples
 * 4. Pick the move with the best average score
 */

import { PIECE_IDS, WHITE_PLAYER } from "./types";
import type { BotDifficulty } from "./types";
import { computeClientVision } from "./chessUtils";
import { generateAllLegalMoves, applyMove, type Move, type SimplePiece } from "./moveGenerator";

// ─── Difficulty settings ─────────────────────────────────────────────

interface DifficultyConfig {
  samples: number;
  randomMovePct: number;
}

const DIFFICULTY_CONFIGS: Record<BotDifficulty, DifficultyConfig> = {
  easy: { samples: 5, randomMovePct: 0.3 },
  medium: { samples: 20, randomMovePct: 0.1 },
  hard: { samples: 50, randomMovePct: 0.02 },
};

// ─── Material values ─────────────────────────────────────────────────

const MATERIAL_VALUE: Record<number, number> = {
  [PIECE_IDS.EMPTY]: 0,
  [PIECE_IDS.WHITE_PAWN]: 100,
  [PIECE_IDS.BLACK_PAWN]: 100,
  [PIECE_IDS.KNIGHT]: 320,
  [PIECE_IDS.BISHOP]: 330,
  [PIECE_IDS.ROOK]: 500,
  [PIECE_IDS.QUEEN]: 900,
  [PIECE_IDS.KING]: 20000,
};

// ─── Piece-square tables (from white's perspective, index = x + y*8) ─

// Pawns prefer center and advancement
const PST_PAWN = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10,-20,-20, 10, 10,  5,
   5, -5,-10,  0,  0,-10, -5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5,  5, 10, 25, 25, 10,  5,  5,
  10, 10, 20, 30, 30, 20, 10, 10,
  50, 50, 50, 50, 50, 50, 50, 50,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const PST_KNIGHT = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,  0,  5,  5,  0,-20,-40,
  -30,  5, 10, 15, 15, 10,  5,-30,
  -30,  0, 15, 20, 20, 15,  0,-30,
  -30,  5, 15, 20, 20, 15,  5,-30,
  -30,  0, 10, 15, 15, 10,  0,-30,
  -40,-20,  0,  0,  0,  0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50,
];

const PST_BISHOP = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,  5,  0,  0,  0,  0,  5,-10,
  -10, 10, 10, 10, 10, 10, 10,-10,
  -10,  0, 10, 10, 10, 10,  0,-10,
  -10,  5,  5, 10, 10,  5,  5,-10,
  -10,  0,  5, 10, 10,  5,  0,-10,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -20,-10,-10,-10,-10,-10,-10,-20,
];

const PST_ROOK = [
   0,  0,  0,  5,  5,  0,  0,  0,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   5, 10, 10, 10, 10, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];

const PST_QUEEN = [
  -20,-10,-10, -5, -5,-10,-10,-20,
  -10,  0,  5,  0,  0,  0,  0,-10,
  -10,  5,  5,  5,  5,  5,  0,-10,
    0,  0,  5,  5,  5,  5,  0, -5,
   -5,  0,  5,  5,  5,  5,  0, -5,
  -10,  0,  5,  5,  5,  5,  0,-10,
  -10,  0,  0,  0,  0,  0,  0,-10,
  -20,-10,-10, -5, -5,-10,-10,-20,
];

const PST_KING = [
   20, 30, 10,  0,  0, 10, 30, 20,
   20, 20,  0,  0,  0,  0, 20, 20,
  -10,-20,-20,-20,-20,-20,-20,-10,
  -20,-30,-30,-40,-40,-30,-30,-20,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
  -30,-40,-40,-50,-50,-40,-40,-30,
];

function getPST(pieceId: number): number[] | null {
  switch (pieceId) {
    case PIECE_IDS.WHITE_PAWN:
    case PIECE_IDS.BLACK_PAWN:
      return PST_PAWN;
    case PIECE_IDS.KNIGHT: return PST_KNIGHT;
    case PIECE_IDS.BISHOP: return PST_BISHOP;
    case PIECE_IDS.ROOK: return PST_ROOK;
    case PIECE_IDS.QUEEN: return PST_QUEEN;
    case PIECE_IDS.KING: return PST_KING;
    default: return null;
  }
}

/**
 * Get the PST index for a piece. For black, mirror vertically (flip y).
 */
function pstIndex(x: number, y: number, playerId: number): number {
  const effectiveY = playerId === WHITE_PLAYER ? y : (7 - y);
  return x + effectiveY * 8;
}

// ─── Board evaluation ────────────────────────────────────────────────

/**
 * Evaluate a board position from the perspective of `playerId`.
 * Positive = good for playerId, negative = bad.
 */
export function evaluateBoard(board: any[], playerId: number): number {
  let score = 0;

  for (let i = 0; i < 64; i++) {
    const id = Number(board[i].id);
    if (id === PIECE_IDS.EMPTY) continue;

    const pid = Number(board[i].player_id);
    const x = i % 8;
    const y = Math.floor(i / 8);

    const material = MATERIAL_VALUE[id] || 0;
    const pst = getPST(id);
    const positional = pst ? pst[pstIndex(x, y, pid)] : 0;
    const value = material + positional;

    if (pid === playerId) {
      score += value;
    } else {
      score -= value;
    }
  }

  return score;
}

// ─── Belief state ────────────────────────────────────────────────────

/** Default starting pieces for a player (all 16 pieces). */
function defaultPieceSet(playerId: number): number[] {
  const pawnId = playerId === WHITE_PLAYER ? PIECE_IDS.WHITE_PAWN : PIECE_IDS.BLACK_PAWN;
  return [
    PIECE_IDS.ROOK, PIECE_IDS.KNIGHT, PIECE_IDS.BISHOP, PIECE_IDS.QUEEN,
    PIECE_IDS.KING, PIECE_IDS.BISHOP, PIECE_IDS.KNIGHT, PIECE_IDS.ROOK,
    pawnId, pawnId, pawnId, pawnId, pawnId, pawnId, pawnId, pawnId,
  ];
}

export interface BeliefState {
  /** Opponent pieces we know are still alive (decremented on observed captures). */
  remainingOpponentPieces: number[];
}

export function createInitialBeliefState(opponentPlayerId: number): BeliefState {
  return {
    remainingOpponentPieces: defaultPieceSet(opponentPlayerId),
  };
}

/**
 * Update belief state when we observe a capture of an opponent piece.
 */
export function recordCapture(belief: BeliefState, capturedPieceId: number): BeliefState {
  const remaining = [...belief.remainingOpponentPieces];
  const idx = remaining.indexOf(capturedPieceId);
  if (idx !== -1) {
    remaining.splice(idx, 1);
  }
  return { remainingOpponentPieces: remaining };
}

// ─── Board sampling (determinization) ────────────────────────────────

/** Fisher-Yates shuffle. */
function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Generate a "determinized" board by randomly placing unseen opponent
 * pieces into non-visible empty squares.
 *
 * @param botBoard  The bot's known board (from its user state game_state)
 * @param botPlayerId  The bot's player ID
 * @param belief  Current belief state
 */
export function sampleBoard(
  botBoard: any[],
  botPlayerId: number,
  belief: BeliefState
): any[] {
  const opponentPlayerId = botPlayerId === 0 ? 1 : 0;
  const vision = computeClientVision(botBoard, botPlayerId);

  // Find which opponent pieces we can see on the board
  const visibleOpponentPieceIds: number[] = [];
  for (let i = 0; i < 64; i++) {
    const id = Number(botBoard[i].id);
    const pid = Number(botBoard[i].player_id);
    if (id !== PIECE_IDS.EMPTY && pid === opponentPlayerId && vision[i]) {
      visibleOpponentPieceIds.push(id);
    }
  }

  // Missing pieces = remaining - visible
  const missingPieces = [...belief.remainingOpponentPieces];
  for (const pid of visibleOpponentPieceIds) {
    const idx = missingPieces.indexOf(pid);
    if (idx !== -1) {
      missingPieces.splice(idx, 1);
    }
  }

  // Find non-visible empty squares where we can place missing pieces
  const emptyNonVisibleIndices: number[] = [];
  for (let i = 0; i < 64; i++) {
    if (!vision[i] && Number(botBoard[i].id) === PIECE_IDS.EMPTY) {
      emptyNonVisibleIndices.push(i);
    }
  }

  // Randomly distribute missing pieces into available squares
  const shuffledSquares = shuffle(emptyNonVisibleIndices);
  const board = botBoard.map((p: any) => ({ ...p }));

  const piecesToPlace = shuffle(missingPieces);
  const placeCount = Math.min(piecesToPlace.length, shuffledSquares.length);

  for (let i = 0; i < placeCount; i++) {
    board[shuffledSquares[i]] = {
      id: piecesToPlace[i],
      player_id: opponentPlayerId,
      has_moved: 1, // assume moved since we don't know
    };
  }

  return board;
}

// ─── Move selection (PIMC) ───────────────────────────────────────────

/**
 * Select the best move for the bot using PIMC sampling.
 *
 * @param botBoard  The bot's known board
 * @param botPlayerId  The bot's player ID
 * @param belief  Current belief state about opponent pieces
 * @param difficulty  Difficulty level controlling sample count and randomness
 * @returns The selected move, or null if no legal moves exist
 */
export function selectBotMove(
  botBoard: any[],
  botPlayerId: number,
  belief: BeliefState,
  difficulty: BotDifficulty
): Move | null {
  const config = DIFFICULTY_CONFIGS[difficulty];

  // Random move chance
  if (Math.random() < config.randomMovePct) {
    const legalMoves = generateAllLegalMoves(botBoard, botPlayerId);
    if (legalMoves.length === 0) return null;
    return legalMoves[Math.floor(Math.random() * legalMoves.length)];
  }

  // Generate legal moves on the bot's known board
  const legalMoves = generateAllLegalMoves(botBoard, botPlayerId);
  if (legalMoves.length === 0) return null;
  if (legalMoves.length === 1) return legalMoves[0];

  // Evaluate each move across N sampled boards
  const moveScores = new Float64Array(legalMoves.length);

  for (let s = 0; s < config.samples; s++) {
    const sampledBoard = sampleBoard(botBoard, botPlayerId, belief);

    for (let m = 0; m < legalMoves.length; m++) {
      const move = legalMoves[m];
      // Re-validate move on sampled board (piece might be blocked by placed opponent piece)
      const fromPiece = Number(sampledBoard[move.fromIndex].id);
      if (fromPiece === PIECE_IDS.EMPTY) continue;

      const boardAfterMove = applyMove(sampledBoard, move, botPlayerId);
      moveScores[m] += evaluateBoard(boardAfterMove, botPlayerId);
    }
  }

  // Pick move with highest average score
  let bestIdx = 0;
  let bestScore = -Infinity;
  for (let m = 0; m < legalMoves.length; m++) {
    if (moveScores[m] > bestScore) {
      bestScore = moveScores[m];
      bestIdx = m;
    }
  }

  return legalMoves[bestIdx];
}
