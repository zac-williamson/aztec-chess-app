import React, { useState, useCallback } from "react";
import { Chessboard } from "./Chessboard";
import {
  buildBoardFromUserState,
  isOwnPiece,
  validateMovePattern,
} from "../lib/chessUtils";
import type { PlayerRole, GamePhase } from "../lib/types";

interface GameScreenProps {
  role: PlayerRole;
  phase: GamePhase;
  gameId: number | null;
  userState: any;
  gameState: any;
  confirmedEmptySquares: Set<number>;
  isMyTurn: boolean;
  statusMessage: string;
  error: string | null;
  onMakeMove: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) => Promise<void>;
}

export function GameScreen({
  role,
  phase,
  gameId,
  userState,
  gameState,
  confirmedEmptySquares,
  isMyTurn,
  statusMessage,
  error,
  onMakeMove,
}: GameScreenProps) {
  const [selectedSquare, setSelectedSquare] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);

  const board = userState
    ? buildBoardFromUserState(userState, role, confirmedEmptySquares)
    : null;

  const moveCount = gameState ? Number(gameState.move_count) : 0;

  const handleSquareClick = useCallback(
    (row: number, col: number) => {
      if (phase !== "playing" || !isMyTurn || !board) return;
      setMoveError(null);

      if (selectedSquare) {
        // Second click: attempt move
        if (selectedSquare.row === row && selectedSquare.col === col) {
          // Deselect
          setSelectedSquare(null);
          return;
        }

        // Clicking another own piece → re-select it
        const targetSquare = board[row][col];
        if (isOwnPiece(targetSquare, role)) {
          setSelectedSquare({ row, col });
          return;
        }

        // Validate the move pattern before submitting
        const validationError = validateMovePattern(
          board,
          selectedSquare.row,
          selectedSquare.col,
          row,
          col,
          role
        );
        if (validationError) {
          setMoveError(validationError);
          return;
        }

        // Make the move
        onMakeMove(selectedSquare.row, selectedSquare.col, row, col);
        setSelectedSquare(null);
      } else {
        // First click: select piece
        const square = board[row][col];
        if (isOwnPiece(square, role)) {
          setSelectedSquare({ row, col });
        }
      }
    },
    [phase, isMyTurn, board, selectedSquare, role, onMakeMove]
  );

  // Turn indicator
  const turnText = isMyTurn ? "Your turn" : "Opponent's turn";
  const roleText = role === "white" ? "White" : "Black";

  return (
    <div className="screen game-screen">
      <div className="game-header">
        <div className="game-info-row">
          <span className="role-badge">{roleText}</span>
          <span className="turn-indicator">{turnText}</span>
          <span className="move-counter">Move #{moveCount}</span>
          {gameId !== null && (
            <span className="game-id">Game #{gameId}</span>
          )}
        </div>
        <div className="status-bar">{statusMessage}</div>
        {(error || moveError) && (
          <div className="error-bar">{error || moveError}</div>
        )}
      </div>

      {board ? (
        <Chessboard
          board={board}
          selectedSquare={selectedSquare}
          onSquareClick={handleSquareClick}
          perspective={role}
        />
      ) : (
        <div className="loading">Loading board...</div>
      )}

      {/* Proof generation overlay */}
      {phase === "proving" && (
        <div className="overlay">
          <div className="overlay-content">
            <div className="spinner-large" />
            <p>Generating zero-knowledge proof...</p>
            <p className="note">This may take a while.</p>
          </div>
        </div>
      )}

      {/* Game over overlay */}
      {phase === "game_over" && (
        <div className="overlay">
          <div className="overlay-content">
            <h2>Game Over</h2>
            <p>{statusMessage}</p>
          </div>
        </div>
      )}
    </div>
  );
}
