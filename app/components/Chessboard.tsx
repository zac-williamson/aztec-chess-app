import React from "react";
import { Square } from "./Square";
import type { BoardSquare, PlayerRole } from "../lib/types";
import { FILE_LABELS, RANK_LABELS } from "../lib/chessUtils";

interface ChessboardProps {
  board: BoardSquare[][];
  selectedSquare: { row: number; col: number } | null;
  onSquareClick: (row: number, col: number) => void;
  perspective: PlayerRole;
}

export function Chessboard({
  board,
  selectedSquare,
  onSquareClick,
  perspective,
}: ChessboardProps) {
  // File labels along the bottom
  const fileLabels =
    perspective === "white" ? FILE_LABELS : [...FILE_LABELS].reverse();
  // Rank labels along the side
  const rankLabels =
    perspective === "white"
      ? [...RANK_LABELS].reverse()
      : RANK_LABELS;

  return (
    <div className="board-container">
      <div className="board-with-labels">
        {/* Rank labels on the left */}
        <div className="rank-labels">
          {rankLabels.map((label, i) => (
            <div key={i} className="rank-label">
              {label}
            </div>
          ))}
        </div>

        {/* The board */}
        <div className="board">
          {board.map((row, rowIdx) => (
            <div key={rowIdx} className="board-row">
              {row.map((square, colIdx) => (
                <Square
                  key={colIdx}
                  row={rowIdx}
                  col={colIdx}
                  square={square}
                  isSelected={
                    selectedSquare?.row === rowIdx &&
                    selectedSquare?.col === colIdx
                  }
                  onClick={() => onSquareClick(rowIdx, colIdx)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* File labels along the bottom */}
      <div className="file-labels">
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
