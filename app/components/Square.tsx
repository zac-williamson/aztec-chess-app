import React from "react";
import { PIECE_SYMBOLS } from "../lib/chessUtils";
import type { BoardSquare } from "../lib/types";

interface SquareProps {
  row: number;
  col: number;
  square: BoardSquare;
  isSelected: boolean;
  onClick: () => void;
}

export function Square({ row, col, square, isSelected, onClick }: SquareProps) {
  const isDark = (row + col) % 2 === 1;

  let backgroundColor: string;
  if (isSelected) {
    backgroundColor = "#f6f669";
  } else if (square.visible) {
    backgroundColor = isDark ? "#769656" : "#eeeed2";
  } else if (square.potentiallyVisible) {
    // Semi-opaque gray: might become visible once opponent moves
    backgroundColor = isDark ? "#4a5568" : "#718096";
  } else {
    // Full fog — no vision
    backgroundColor = "#1a1a2e";
  }

  const symbol = square.piece ? PIECE_SYMBOLS[square.piece] : null;

  // White pieces: light fill with dark outline. Black pieces: dark fill.
  const pieceClassName =
    square.pieceColor === "white" ? "piece piece-white" : "piece piece-black";

  return (
    <div
      className="square"
      style={{ backgroundColor }}
      onClick={onClick}
    >
      {symbol && <span className={pieceClassName}>{symbol}</span>}
    </div>
  );
}
