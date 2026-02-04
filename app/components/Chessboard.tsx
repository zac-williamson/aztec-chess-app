import React, { useMemo, useState } from "react";
import { Square } from "./Square";
import { ChessboardCanvas } from "./ChessboardCanvas";
import type { BoardSquare, PlayerRole, Hat } from "../lib/types";
import { FILE_LABELS, RANK_LABELS, getValidMoves } from "../lib/chessUtils";

const SQUARE_SIZE = 70;

interface ChessboardProps {
  board: BoardSquare[][];
  selectedSquare: { row: number; col: number } | null;
  onSquareClick: (row: number, col: number) => void;
  perspective: PlayerRole;
  whiteHat?: Hat | null;
  blackHat?: Hat | null;
}

export function Chessboard({
  board,
  selectedSquare,
  onSquareClick,
  perspective,
  whiteHat,
  blackHat,
}: ChessboardProps) {
  const [hoveredSquare, setHoveredSquare] = useState<{ row: number; col: number } | null>(null);
  // File labels along the bottom
  const fileLabels =
    perspective === "white" ? FILE_LABELS : [...FILE_LABELS].reverse();
  // Rank labels along the side
  const rankLabels =
    perspective === "white"
      ? [...RANK_LABELS].reverse()
      : RANK_LABELS;

  // Compute valid moves for the selected piece
  const validMoves = useMemo(() => {
    if (!selectedSquare) return new Set<string>();

    const moves = getValidMoves(
      board,
      selectedSquare.row,
      selectedSquare.col,
      perspective
    );

    return new Set(moves.map((m) => `${m.row},${m.col}`));
  }, [board, selectedSquare, perspective]);

  return (
    <div className="board-container">
      <div className="board-with-labels">
        {/* Rank labels on the left */}
        <div className="rank-labels" aria-hidden="true">
          {rankLabels.map((label, i) => (
            <div key={i} className="rank-label">
              {label}
            </div>
          ))}
        </div>

        {/* The board with 3D canvas overlay */}
        <div className="board" role="grid" aria-label="Chess board" style={{ position: 'relative' }}>
          {/* 3D pieces canvas overlay */}
          <ChessboardCanvas
            board={board}
            selectedSquare={selectedSquare}
            hoveredSquare={hoveredSquare}
            squareSize={SQUARE_SIZE}
            perspective={perspective}
            whiteHat={whiteHat}
            blackHat={blackHat}
          />

          {/* Interactive squares layer */}
          {board.map((row, rowIdx) => (
            <div key={rowIdx} className="board-row" role="row">
              {row.map((square, colIdx) => {
                const isSelected =
                  selectedSquare?.row === rowIdx &&
                  selectedSquare?.col === colIdx;
                const isValidMove = validMoves.has(`${rowIdx},${colIdx}`);

                return (
                  <Square
                    key={colIdx}
                    row={rowIdx}
                    col={colIdx}
                    square={square}
                    isSelected={isSelected}
                    isValidMove={isValidMove}
                    onClick={() => onSquareClick(rowIdx, colIdx)}
                    onMouseEnter={() => setHoveredSquare({ row: rowIdx, col: colIdx })}
                    onMouseLeave={() => setHoveredSquare(null)}
                    use3DCanvas={true}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* File labels along the bottom */}
      <div className="file-labels" aria-hidden="true">
        <div className="rank-label-spacer" />
        {fileLabels.map((label, i) => (
          <div key={i} className="file-label">
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
