import React, { useState } from "react";
import { PIECE_SYMBOLS } from "../lib/chessUtils";
import type { BoardSquare } from "../lib/types";

// Map piece letters to image filenames
const PIECE_IMAGES: Record<string, string> = {
  K: "king",
  Q: "queen",
  R: "rook",
  B: "bishop",
  N: "knight",
  P: "pawn",
};

interface SquareProps {
  row: number;
  col: number;
  square: BoardSquare;
  isSelected: boolean;
  isValidMove?: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  use3DCanvas?: boolean; // When true, pieces are rendered by ChessboardCanvas
}

export function Square({
  row,
  col,
  square,
  isSelected,
  isValidMove = false,
  onClick,
  onMouseEnter,
  onMouseLeave,
  use3DCanvas = true,
}: SquareProps) {
  const isDark = (row + col) % 2 === 1;
  const [imageError, setImageError] = useState(false);

  // Build class names
  const classNames = ["square"];

  // Base color
  classNames.push(isDark ? "dark" : "light");

  // Selection state
  if (isSelected) {
    classNames.push("selected");
  }

  // Valid move indicator
  if (isValidMove) {
    classNames.push("valid-move");
    if (square.piece) {
      classNames.push("has-piece");
    }
  }

  // Visibility state (fog of war)
  if (!square.visible && !square.potentiallyVisible) {
    classNames.push("fog");
  } else if (square.potentiallyVisible && !square.visible) {
    classNames.push("potentially-visible");
  }

  // Render piece - skip if using 3D canvas (canvas renders all pieces)
  const renderPiece = () => {
    if (!square.piece || use3DCanvas) return null;

    const color = (square.pieceColor || "white") as 'white' | 'black';

    // Try image rendering first
    if (!imageError) {
      const pieceName = PIECE_IMAGES[square.piece];
      return (
        <img
          src={`/assets/pieces/${color}/${pieceName}.png`}
          alt={`${color} ${pieceName}`}
          className="piece"
          draggable={false}
          onError={() => setImageError(true)}
        />
      );
    }

    // Unicode fallback
    const symbol = PIECE_SYMBOLS[square.piece];
    const pieceClassName =
      color === "white"
        ? "piece-unicode piece-white"
        : "piece-unicode piece-black";

    return <span className={pieceClassName}>{symbol}</span>;
  };

  return (
    <div
      className={classNames.join(" ")}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      role="button"
      tabIndex={0}
      aria-label={`Square ${String.fromCharCode(97 + col)}${8 - row}${
        square.piece ? `, ${square.pieceColor} ${square.piece}` : ""
      }${isSelected ? ", selected" : ""}${isValidMove ? ", valid move" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {renderPiece()}
    </div>
  );
}
