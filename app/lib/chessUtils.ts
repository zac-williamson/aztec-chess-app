import { PIECE_IDS, WHITE_PLAYER, type BoardSquare, type PlayerRole } from "./types";

// Use the filled Unicode chess symbols for all pieces.
// Color is applied via CSS, not by symbol choice.
export const PIECE_SYMBOLS: Record<string, string> = {
  K: "\u265A", // ♚
  Q: "\u265B", // ♛
  R: "\u265C", // ♜
  B: "\u265D", // ♝
  N: "\u265E", // ♞
  P: "\u265F", // ♟
};

// Map piece ID from contract → letter code
const PIECE_LETTER: Record<number, string> = {
  [PIECE_IDS.WHITE_PAWN]: "P",
  [PIECE_IDS.BLACK_PAWN]: "P",
  [PIECE_IDS.KNIGHT]: "N",
  [PIECE_IDS.BISHOP]: "B",
  [PIECE_IDS.ROOK]: "R",
  [PIECE_IDS.QUEEN]: "Q",
  [PIECE_IDS.KING]: "K",
};

/**
 * Convert a Noir board index (0..63, where index = x + y*8)
 * to a UI (row, col) for a given board perspective.
 *
 * Noir coords: x=0..7 (a-h file), y=0..7 (rank 1-8).
 * y=0 is White's back rank (rank 1).
 * UI coords: row=0 is the top of the screen.
 * White perspective: White's pieces at bottom → row = 7-y, col = x
 * Black perspective: Black's pieces at bottom → row = y, col: 7-x
 */
export function noirIndexToRowCol(
  index: number,
  perspective: PlayerRole
): { row: number; col: number } {
  const x = index % 8;
  const y = Math.floor(index / 8);
  if (perspective === "white") {
    return { row: 7 - y, col: x };
  } else {
    return { row: y, col: 7 - x };
  }
}

/**
 * Convert UI (row, col) back to Noir coordinates (x, y).
 */
export function rowColToNoirXY(
  row: number,
  col: number,
  perspective: PlayerRole
): { x: number; y: number } {
  if (perspective === "white") {
    return { x: col, y: 7 - row };
  } else {
    return { x: 7 - col, y: row };
  }
}

// ─── Client-side vision computation ─────────────────────────────────
// Mirrors the Noir update_vision function from fog_of_war_chess.
// Used for rendering only; userState.visible_squares is NOT modified.

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

/**
 * Cast rays in the given directions. Each ray extends up to 7 squares.
 * A ray stops (is blocked) after hitting any piece, but the occupied
 * square itself IS visible.
 */
function addSlidingVision(
  vision: boolean[],
  gameState: any[],
  x: number,
  y: number,
  directions: [number, number][]
): void {
  for (const [dx, dy] of directions) {
    for (let dist = 1; dist <= 7; dist++) {
      const nx = x + dx * dist;
      const ny = y + dy * dist;
      if (!inBounds(nx, ny)) break;
      const idx = nx + ny * 8;
      vision[idx] = true;
      // Blocked by any piece (own or opponent)
      if (Number(gameState[idx].id) !== PIECE_IDS.EMPTY) break;
    }
  }
}

function addKnightVision(vision: boolean[], x: number, y: number): void {
  const offsets: [number, number][] = [
    [2, 1], [1, 2], [-1, 2], [-2, 1],
    [2, -1], [1, -2], [-1, -2], [-2, -1],
  ];
  for (const [dx, dy] of offsets) {
    const nx = x + dx;
    const ny = y + dy;
    if (inBounds(nx, ny)) {
      vision[nx + ny * 8] = true;
    }
  }
}

function addKingVision(vision: boolean[], x: number, y: number): void {
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      if (dx === 0 && dy === 0) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(nx, ny)) {
        vision[nx + ny * 8] = true;
      }
    }
  }
}

function addPawnVision(
  vision: boolean[],
  gameState: any[],
  x: number,
  y: number,
  forward: number // +1 for white (north), -1 for black (south)
): void {
  const ny1 = y + forward;
  if (!inBounds(x, ny1)) return;

  // One square straight forward
  vision[x + ny1 * 8] = true;
  // One square diagonally forward
  if (x > 0) vision[(x - 1) + ny1 * 8] = true;
  if (x < 7) vision[(x + 1) + ny1 * 8] = true;

  // Two squares forward from starting rank (blocked by piece on first square)
  const startY = forward === 1 ? 1 : 6;
  if (y === startY) {
    const ny2 = y + forward * 2;
    if (inBounds(x, ny2)) {
      // Only if the first square ahead is empty
      if (Number(gameState[x + ny1 * 8].id) === PIECE_IDS.EMPTY) {
        vision[x + ny2 * 8] = true;
      }
    }
  }
}

const DIAGONAL_DIRS: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const CARDINAL_DIRS: [number, number][] = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const ALL_DIRS: [number, number][] = [...DIAGONAL_DIRS, ...CARDINAL_DIRS];

/**
 * Compute which squares are visible to the given player based on their
 * current piece positions. Mirrors the Noir update_vision function.
 *
 * @returns A 64-element boolean array indexed by (x + y*8).
 */
export function computeClientVision(
  gameState: any[],
  playerId: number
): boolean[] {
  const vision: boolean[] = new Array(64).fill(false);

  for (let i = 0; i < 64; i++) {
    const piece = gameState[i];
    const pieceId = Number(piece.id);
    const pId = Number(piece.player_id);

    if (pieceId === PIECE_IDS.EMPTY || pId !== playerId) continue;

    const x = i % 8;
    const y = Math.floor(i / 8);

    // The piece's own square is always visible
    vision[i] = true;

    switch (pieceId) {
      case PIECE_IDS.WHITE_PAWN:
        addPawnVision(vision, gameState, x, y, 1);
        break;
      case PIECE_IDS.BLACK_PAWN:
        addPawnVision(vision, gameState, x, y, -1);
        break;
      case PIECE_IDS.KNIGHT:
        addKnightVision(vision, x, y);
        break;
      case PIECE_IDS.BISHOP:
        addSlidingVision(vision, gameState, x, y, DIAGONAL_DIRS);
        break;
      case PIECE_IDS.ROOK:
        addSlidingVision(vision, gameState, x, y, CARDINAL_DIRS);
        break;
      case PIECE_IDS.QUEEN:
        addSlidingVision(vision, gameState, x, y, ALL_DIRS);
        break;
      case PIECE_IDS.KING:
        addKingVision(vision, x, y);
        break;
    }
  }

  return vision;
}

// ─── Board building ──────────────────────────────────────────────────

/**
 * Build an 8x8 board display from the player's UserState.
 *
 * Vision is computed client-side from piece positions (mirrors the Noir
 * update_vision algorithm). userState.visible_squares is left untouched
 * so contract calls continue to receive the correct on-chain value.
 */
export function buildBoardFromUserState(
  userState: { game_state: any[]; visible_squares: any[] },
  perspective: PlayerRole,
  confirmedEmptySquares: Set<number> = new Set()
): BoardSquare[][] {
  const board: BoardSquare[][] = Array.from({ length: 8 }, () =>
    Array.from({ length: 8 }, () => ({
      piece: null,
      pieceColor: null,
      visible: false,
      potentiallyVisible: false,
      isSelected: false,
    }))
  );

  const playerId = perspective === "white" ? WHITE_PLAYER : 1;
  const clientVision = computeClientVision(userState.game_state, playerId);

  for (let i = 0; i < 64; i++) {
    const pieceData = userState.game_state[i];
    const { row, col } = noirIndexToRowCol(i, perspective);

    const pieceId = Number(pieceData.id);
    const pId = Number(pieceData.player_id);

    // Determine piece letter (e.g. "P", "K")
    let piece: string | null = null;
    let pieceColor: "white" | "black" | null = null;
    if (pieceId !== PIECE_IDS.EMPTY) {
      piece = PIECE_LETTER[pieceId] || null;
      pieceColor = pId === WHITE_PLAYER ? "white" : "black";
    }

    const hasPiece = pieceId !== PIECE_IDS.EMPTY;
    const inClientVision = clientVision[i];
    const isConfirmedEmpty = confirmedEmptySquares.has(i);

    // Visibility states:
    // 1. Has a piece → visible (contract already filtered what we can see)
    // 2. In current vision AND confirmed empty → visible (MPC verified it's empty)
    // 3. In current vision but NOT confirmed → potentially visible (gray)
    // 4. Not in current vision → fog
    const visible = hasPiece || (inClientVision && isConfirmedEmpty);
    const potentiallyVisible = !visible && inClientVision;

    board[row][col] = {
      piece: hasPiece ? piece : null,
      pieceColor: hasPiece ? pieceColor : null,
      visible,
      potentiallyVisible,
      isSelected: false,
    };
  }

  return board;
}

/**
 * Check if a square contains a piece belonging to the given player role.
 */
export function isOwnPiece(square: BoardSquare, role: PlayerRole): boolean {
  if (!square.piece) return false;
  return square.pieceColor === role;
}

/**
 * Validate whether a move is a legal movement pattern for the given piece.
 * Does NOT check path obstruction for sliding pieces or check/pin legality.
 * Returns an error message if invalid, or null if the move looks valid.
 */
export function validateMovePattern(
  board: BoardSquare[][],
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number,
  role: PlayerRole
): string | null {
  const from = board[fromRow][fromCol];
  const to = board[toRow][toCol];

  if (!from.piece) return "No piece on source square";
  if (!isOwnPiece(from, role)) return "Not your piece";
  if (to.piece && to.pieceColor === role) return "Cannot capture your own piece";

  const dr = toRow - fromRow;
  const dc = toCol - fromCol;
  const absDr = Math.abs(dr);
  const absDc = Math.abs(dc);
  const isCapture = to.piece !== null;

  switch (from.piece) {
    case "P": {
      // Pawns move "up" from the player's perspective (row decreases for white display)
      // In our UI, row 0 is top. White's pawns move up (dr < 0), Black's move up too
      // since the board is already flipped per perspective.
      // Forward = row decreasing (toward row 0)
      const forward = -1;

      if (isCapture) {
        // Capture: one step diagonally forward
        if (dr !== forward || absDc !== 1) {
          return "Pawns capture one square diagonally forward";
        }
      } else {
        // Non-capture: must move straight forward
        if (dc !== 0) return "Pawns move straight forward (not diagonally) when not capturing";
        if (dr === forward) {
          // Single step forward — always OK
        } else if (dr === forward * 2) {
          // Double step — only from starting row
          const startRow = 6; // pawns start on row 6 in UI (regardless of perspective)
          if (fromRow !== startRow) {
            return "Pawns can only move two squares from their starting position";
          }
        } else {
          return "Pawns move one square forward (or two from start)";
        }
      }
      return null;
    }

    case "N":
      // Knight: L-shape
      if (!((absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2))) {
        return "Knights move in an L-shape (2+1 squares)";
      }
      return null;

    case "B":
      // Bishop: diagonal
      if (absDr !== absDc || absDr === 0) {
        return "Bishops move diagonally";
      }
      return null;

    case "R":
      // Rook: horizontal or vertical
      if (dr !== 0 && dc !== 0) {
        return "Rooks move horizontally or vertically";
      }
      if (absDr === 0 && absDc === 0) {
        return "Must move at least one square";
      }
      return null;

    case "Q":
      // Queen: diagonal, horizontal, or vertical
      if (dr !== 0 && dc !== 0 && absDr !== absDc) {
        return "Queens move horizontally, vertically, or diagonally";
      }
      if (absDr === 0 && absDc === 0) {
        return "Must move at least one square";
      }
      return null;

    case "K":
      // King: one square in any direction
      if (absDr > 1 || absDc > 1 || (absDr === 0 && absDc === 0)) {
        return "Kings move one square in any direction";
      }
      return null;

    default:
      return null;
  }
}

/**
 * File labels for coordinate display.
 */
export const FILE_LABELS = ["a", "b", "c", "d", "e", "f", "g", "h"];
export const RANK_LABELS = ["1", "2", "3", "4", "5", "6", "7", "8"];

/**
 * Get all valid move target squares for a piece at the given position.
 * Returns an array of {row, col} objects representing valid destinations.
 * This is a basic check that doesn't account for check/pin legality,
 * path obstructions for sliding pieces, or en passant.
 */
export function getValidMoves(
  board: BoardSquare[][],
  fromRow: number,
  fromCol: number,
  role: PlayerRole
): { row: number; col: number }[] {
  const from = board[fromRow][fromCol];
  if (!from.piece || !isOwnPiece(from, role)) return [];

  const validMoves: { row: number; col: number }[] = [];

  // Check all possible squares
  for (let toRow = 0; toRow < 8; toRow++) {
    for (let toCol = 0; toCol < 8; toCol++) {
      if (toRow === fromRow && toCol === fromCol) continue;

      const error = validateMovePattern(board, fromRow, fromCol, toRow, toCol, role);
      if (error === null) {
        // Basic validation passed - check path for sliding pieces
        const piece = from.piece;

        // For sliding pieces (B, R, Q), check if path is clear
        if (piece === "B" || piece === "R" || piece === "Q") {
          if (isPathClear(board, fromRow, fromCol, toRow, toCol)) {
            validMoves.push({ row: toRow, col: toCol });
          }
        } else {
          // Non-sliding pieces (P, N, K) - already validated
          validMoves.push({ row: toRow, col: toCol });
        }
      }
    }
  }

  return validMoves;
}

/**
 * Check if the path between two squares is clear (for sliding pieces).
 * Does not check the destination square (that's handled by validateMovePattern).
 */
function isPathClear(
  board: BoardSquare[][],
  fromRow: number,
  fromCol: number,
  toRow: number,
  toCol: number
): boolean {
  const dr = toRow - fromRow;
  const dc = toCol - fromCol;

  // Determine step direction
  const stepR = dr === 0 ? 0 : dr > 0 ? 1 : -1;
  const stepC = dc === 0 ? 0 : dc > 0 ? 1 : -1;

  let r = fromRow + stepR;
  let c = fromCol + stepC;

  // Check all squares between from and to (exclusive)
  while (r !== toRow || c !== toCol) {
    const square = board[r][c];
    // If there's a piece in the way (and we can see it), path is blocked
    if (square.piece) {
      return false;
    }
    // If it's fog, we can't be sure - allow the move and let the contract validate
    // This is intentional for fog of war gameplay
    r += stepR;
    c += stepC;
  }

  return true;
}
