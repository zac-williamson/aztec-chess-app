import React, { useState, useCallback, useEffect, useRef } from "react";
import { Chessboard } from "./Chessboard";
import { FlappyPawn } from "./FlappyPawn";
import { DidYouKnow } from "./DidYouKnow";
import { VictoryHatModal } from "./VictoryHatModal";
import {
  buildBoardFromUserState,
  isOwnPiece,
  validateMovePattern,
} from "../lib/chessUtils";
import type { PlayerRole, GamePhase, BoardSquare, Hat } from "../lib/types";

// Singleton AudioContext for efficient sound playback
let audioContext: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (!audioContext) {
    try {
      audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    } catch {
      return null;
    }
  }
  return audioContext;
}

// Play a cute voice sound using oscillators to simulate speech
const playCuteSound = (type: "yahoo" | "aww") => {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    if (type === "yahoo") {
      // Happy ascending "Yahoo!" sound
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        setTimeout(() => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "sine";
          gain.gain.value = 0.15;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
          osc.stop(ctx.currentTime + 0.12);
        }, i * 80);
      });
    } else {
      // Sad descending minor arpeggio: C5, G4, Eb4, C4
      const notes = [523.25, 392.00, 311.13, 261.63];
      notes.forEach((freq, i) => {
        setTimeout(() => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          osc.type = "sine";
          gain.gain.value = 0.15;
          osc.start();
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
          osc.stop(ctx.currentTime + 0.15);
        }, i * 100);
      });
    }
  } catch {
    // Audio playback failed, silently ignore
  }
};

const playSound = (type: "move" | "capture" | "opponentCapture" | "gameOver" | "yourTurn") => {
  const ctx = getAudioContext();
  if (!ctx) return;

  // Use cute sounds for captures
  if (type === "capture") {
    playCuteSound("yahoo");
    return;
  }
  if (type === "opponentCapture") {
    playCuteSound("aww");
    return;
  }

  try {
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    switch (type) {
      case "move":
        oscillator.frequency.value = 440;
        gainNode.gain.value = 0.1;
        oscillator.type = "sine";
        break;
      case "gameOver":
        oscillator.frequency.value = 220;
        gainNode.gain.value = 0.1;
        oscillator.type = "sawtooth";
        break;
      case "yourTurn":
        oscillator.frequency.value = 523.25;
        gainNode.gain.value = 0.15;
        oscillator.type = "sine";
        break;
    }

    const duration = type === "yourTurn" ? 0.15 : 0.3;
    oscillator.start();
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    oscillator.stop(ctx.currentTime + duration);

    if (type === "yourTurn") {
      setTimeout(() => {
        try {
          const osc2 = ctx.createOscillator();
          const gain2 = ctx.createGain();
          osc2.connect(gain2);
          gain2.connect(ctx.destination);
          osc2.frequency.value = 659.25;
          gain2.gain.value = 0.15;
          osc2.type = "sine";
          osc2.start();
          gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
          osc2.stop(ctx.currentTime + 0.2);
        } catch {
          // Ignore errors
        }
      }, 120);
    }
  } catch {
    // Audio playback failed, silently ignore
  }
};

interface BoardSnapshot {
  board: BoardSquare[][];
  moveNumber: number;
}

interface CapturedPieces {
  byWhite: string[]; // Pieces white has captured (black pieces)
  byBlack: string[]; // Pieces black has captured (white pieces)
}

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
  opponentJoined: boolean;
  createdGamePassword: string;
  myElo: number;
  opponentElo: number;
  myHat?: Hat | null;
  opponentHat?: Hat | null;
  wonHat?: Hat | null;
  pendingProofCount?: number;
  relayConnected?: boolean;
  peerConnected?: boolean;
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
  opponentJoined,
  createdGamePassword,
  myElo,
  opponentElo,
  myHat,
  opponentHat,
  wonHat,
  pendingProofCount = 0,
  relayConnected = false,
  peerConnected = false,
  onMakeMove,
}: GameScreenProps) {
  const [selectedSquare, setSelectedSquare] = useState<{
    row: number;
    col: number;
  } | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [capturedPieces, setCapturedPieces] = useState<CapturedPieces>({
    byWhite: [],
    byBlack: [],
  });
  const [boardHistory, setBoardHistory] = useState<BoardSnapshot[]>([]);
  const [viewingMoveIndex, setViewingMoveIndex] = useState<number>(-1); // -1 means viewing current
  // Optimistic board state for immediate visual feedback before proof completes
  const [optimisticBoard, setOptimisticBoard] = useState<BoardSquare[][] | null>(null);
  const prevIsMyTurnRef = useRef<boolean>(isMyTurn);
  const prevMoveCountRef = useRef<number>(0);
  const justLostPieceRef = useRef<boolean>(false);

  const currentBoard = userState
    ? buildBoardFromUserState(userState, role, confirmedEmptySquares)
    : null;

  // Victory/defeat detection (moved earlier for use in effects)
  const isVictory = phase === "game_over" && statusMessage.toLowerCase().includes("you captured");
  const isDefeat = phase === "game_over" && statusMessage.toLowerCase().includes("your king");

  const moveCount = gameState ? Number(gameState.move_count) : 0;

  // Clear optimistic board when move count changes (real state arrived from simulate)
  useEffect(() => {
    if (optimisticBoard) {
      setOptimisticBoard(null);
    }
  }, [moveCount]);

  // Helper to get list of our pieces on a board
  const getOurPieces = useCallback((board: BoardSquare[][] | null): string[] => {
    if (!board) return [];
    const pieces: string[] = [];
    const ourColor = role;
    board.forEach(row => {
      row.forEach(square => {
        if (square.piece && square.pieceColor === ourColor) {
          pieces.push(square.piece);
        }
      });
    });
    return pieces.sort(); // Sort for consistent comparison
  }, [role]);

  // Find which pieces were lost by comparing two piece lists
  const findLostPieces = useCallback((prevPieces: string[], currentPieces: string[]): string[] => {
    const lost: string[] = [];
    const currentCopy = [...currentPieces];

    for (const piece of prevPieces) {
      const idx = currentCopy.indexOf(piece);
      if (idx === -1) {
        // This piece is no longer present
        lost.push(piece);
      } else {
        // Remove from copy so duplicates are handled correctly
        currentCopy.splice(idx, 1);
      }
    }
    return lost;
  }, []);

  const prevPiecesRef = useRef<string[]>([]); // Track actual pieces, not just count

  // Store board snapshot when move count changes and detect opponent captures
  useEffect(() => {
    if (currentBoard && moveCount !== prevMoveCountRef.current) {
      const currentPieces = getOurPieces(currentBoard);

      // Check if opponent captured our piece (we have fewer pieces than before)
      // Only check when it becomes our turn (opponent just moved)
      if (isMyTurn && prevPiecesRef.current.length > 0 && phase === "playing") {
        const lostPieces = findLostPieces(prevPiecesRef.current, currentPieces);
        if (lostPieces.length > 0) {
          justLostPieceRef.current = true; // Skip "your turn" sound
          playSound("opponentCapture");
          // Track opponent's capture with the actual piece type
          setCapturedPieces(prev => ({
            ...prev,
            [role === "white" ? "byBlack" : "byWhite"]: [
              ...prev[role === "white" ? "byBlack" : "byWhite"],
              ...lostPieces,
            ],
          }));
        }
      }
      prevPiecesRef.current = currentPieces;

      // Deep copy the board for the snapshot
      const boardCopy = currentBoard.map(row =>
        row.map(square => ({ ...square }))
      );
      setBoardHistory(prev => {
        // Only add if this move number doesn't exist yet
        const existingIndex = prev.findIndex(s => s.moveNumber === moveCount);
        if (existingIndex === -1) {
          return [...prev, { board: boardCopy, moveNumber: moveCount }];
        }
        return prev;
      });
      // Reset to viewing current when new move happens
      setViewingMoveIndex(-1);
    }
    prevMoveCountRef.current = moveCount;
  }, [moveCount, currentBoard, getOurPieces, findLostPieces, isMyTurn, phase, role]);

  // Determine which board to display
  const isViewingHistory = viewingMoveIndex >= 0 && viewingMoveIndex < boardHistory.length;
  const displayBoard = isViewingHistory
    ? boardHistory[viewingMoveIndex].board
    : (optimisticBoard || currentBoard); // Use optimistic board during proof generation
  const displayMoveNumber = isViewingHistory
    ? boardHistory[viewingMoveIndex].moveNumber
    : moveCount;

  // Keyboard shortcut: ESC to deselect
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && selectedSquare) {
        setSelectedSquare(null);
        setMoveError(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSquare]);

  // Play sound on game over
  useEffect(() => {
    if (phase === "game_over") {
      playSound("gameOver");
    }
  }, [phase]);

  // Play notification sound when it becomes your turn (unless we just lost a piece)
  useEffect(() => {
    if (isMyTurn && !prevIsMyTurnRef.current && phase === "playing") {
      // Skip if we just lost a piece - the loss sound is enough
      if (!justLostPieceRef.current) {
        playSound("yourTurn");
      }
      justLostPieceRef.current = false; // Reset for next turn
    }
    prevIsMyTurnRef.current = isMyTurn;
  }, [isMyTurn, phase]);

  // Navigation handlers for move replay
  const canGoBack = boardHistory.length > 0 && (viewingMoveIndex === -1 ? true : viewingMoveIndex > 0);
  const canGoForward = viewingMoveIndex >= 0 && viewingMoveIndex < boardHistory.length - 1;
  const isAtCurrentMove = viewingMoveIndex === -1;

  const goBack = useCallback(() => {
    if (viewingMoveIndex === -1) {
      // Currently viewing current state, go to last snapshot
      setViewingMoveIndex(boardHistory.length - 1);
    } else if (viewingMoveIndex > 0) {
      setViewingMoveIndex(viewingMoveIndex - 1);
    }
    setSelectedSquare(null);
  }, [viewingMoveIndex, boardHistory.length]);

  const goForward = useCallback(() => {
    if (viewingMoveIndex >= 0 && viewingMoveIndex < boardHistory.length - 1) {
      setViewingMoveIndex(viewingMoveIndex + 1);
    } else if (viewingMoveIndex === boardHistory.length - 1) {
      // At last snapshot, go to current
      setViewingMoveIndex(-1);
    }
    setSelectedSquare(null);
  }, [viewingMoveIndex, boardHistory.length]);

  const goToCurrent = useCallback(() => {
    setViewingMoveIndex(-1);
    setSelectedSquare(null);
  }, []);

  const handleSquareClick = useCallback(
    async (row: number, col: number) => {
      // Block moves when viewing history
      if (isViewingHistory) {
        setMoveError("Viewing history - return to current move to play");
        return;
      }

      if (phase !== "playing" || !isMyTurn || !currentBoard) return;
      setMoveError(null);

      if (selectedSquare) {
        if (selectedSquare.row === row && selectedSquare.col === col) {
          setSelectedSquare(null);
          return;
        }

        const targetSquare = currentBoard[row][col];
        if (isOwnPiece(targetSquare, role)) {
          setSelectedSquare({ row, col });
          return;
        }

        const validationError = validateMovePattern(
          currentBoard,
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

        // Get the moving piece info
        const movingPiece = currentBoard[selectedSquare.row][selectedSquare.col];
        const isCapture = targetSquare.piece !== null;
        const capturedPiece = isCapture ? targetSquare.piece : undefined;

        // Play appropriate sound
        playSound(isCapture ? "capture" : "move");

        // Track captured piece
        if (isCapture && capturedPiece) {
          setCapturedPieces((prev) => ({
            ...prev,
            [role === "white" ? "byWhite" : "byBlack"]: [
              ...prev[role === "white" ? "byWhite" : "byBlack"],
              capturedPiece,
            ],
          }));
        }

        // Create optimistic board state for immediate visual feedback
        const newBoard = currentBoard.map(r => r.map(sq => ({ ...sq })));
        // Move the piece
        newBoard[row][col] = {
          ...newBoard[selectedSquare.row][selectedSquare.col],
          visible: true,
        };
        // Clear the source square
        newBoard[selectedSquare.row][selectedSquare.col] = {
          piece: null,
          pieceColor: null,
          visible: true,
          potentiallyVisible: false,
          isSelected: false,
        };
        setOptimisticBoard(newBoard);
        setSelectedSquare(null);

        // Now submit the move (this takes a while for proof generation)
        await onMakeMove(selectedSquare.row, selectedSquare.col, row, col);
      } else {
        const square = currentBoard[row][col];
        if (isOwnPiece(square, role)) {
          setSelectedSquare({ row, col });
        }
      }
    },
    [phase, isMyTurn, currentBoard, selectedSquare, role, onMakeMove, isViewingHistory]
  );

  const waitingForOpponentToJoin = role === "black" && !opponentJoined;
  const isYourTurn = isMyTurn && phase === "playing" && !waitingForOpponentToJoin;
  const turnText = waitingForOpponentToJoin
    ? "Waiting for opponent to join..."
    : isYourTurn
    ? "Your turn"
    : "Waiting for opponent...";
  const roleText = role === "white" ? "White" : "Black";

  // ELO display - White player always shown first
  const whiteElo = role === "white" ? myElo : opponentElo;
  const blackElo = role === "black" ? myElo : opponentElo;

  // Hat display - map to white/black
  const whiteHat = role === "white" ? myHat : opponentHat;
  const blackHat = role === "black" ? myHat : opponentHat;

  // Render captured pieces using unicode symbols
  const pieceSymbols: Record<string, string> = {
    K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞", P: "♟",
  };

  const renderCapturedPieces = (pieces: string[], color: "white" | "black") => {
    if (pieces.length === 0) return <span className="no-captures">None</span>;
    return pieces.map((piece, i) => (
      <span key={i} className={`captured-piece ${color}`}>
        {pieceSymbols[piece] || piece}
      </span>
    ));
  };

  return (
    <div className="screen game-screen animate-fade-in">
      <div className="game-header">
        <div className="game-info-row">
          <span className={`role-badge ${role}`}>{roleText}</span>
          <span
            className={`turn-indicator ${isYourTurn ? "your-turn" : "opponent-turn"}`}
            role="status"
            aria-live="polite"
          >
            {turnText}
          </span>
          <span className="move-counter">Move #{moveCount}</span>
        </div>

        <div className="elo-display">
          <span className={`elo-badge white ${role === "white" ? "you" : ""}`}>
            <span className="elo-icon">♔</span>
            <span className="elo-value">{whiteElo}</span>
          </span>
          <span className="elo-vs">vs</span>
          <span className={`elo-badge black ${role === "black" ? "you" : ""}`}>
            <span className="elo-icon">♚</span>
            <span className="elo-value">{blackElo}</span>
          </span>
        </div>

        {gameId !== null && (
          <span className="game-id">
            Game <code>#{gameId}</code>
          </span>
        )}
      </div>

      {/* Waiting for opponent to join info */}
      {waitingForOpponentToJoin && (
        <div className="waiting-opponent-info animate-slide-up">
          <p className="waiting-text">
            Share these details with your opponent:
          </p>
          <div className="share-details">
            <div className="share-item">
              <span className="share-label">Game ID:</span>
              <code className="share-value">{gameId}</code>
            </div>
            {createdGamePassword && (
              <div className="share-item">
                <span className="share-label">Password:</span>
                <code className="share-value">{createdGamePassword}</code>
              </div>
            )}
          </div>
          <p className="note">The game will start automatically when they join.</p>
        </div>
      )}

      {(error || moveError) && (
        <div className="error-bar animate-slide-up">{error || moveError}</div>
      )}

      {/* Main game area with board and side panel */}
      <div className="game-main-area">
        {/* Left side: Board and controls */}
        <div className="game-board-section">
          {/* Captured pieces display */}
          <div className="captured-pieces-container">
            <div className="captured-section">
              <span className="captured-label">Your captures:</span>
              <div className="captured-list">
                {renderCapturedPieces(
                  role === "white" ? capturedPieces.byWhite : capturedPieces.byBlack,
                  role === "white" ? "black" : "white"
                )}
              </div>
            </div>
            <div className="captured-section">
              <span className="captured-label">Opponent's captures:</span>
              <div className="captured-list">
                {renderCapturedPieces(
                  role === "white" ? capturedPieces.byBlack : capturedPieces.byWhite,
                  role
                )}
              </div>
            </div>
          </div>

          {displayBoard ? (
            <Chessboard
              board={displayBoard}
              selectedSquare={isViewingHistory ? null : selectedSquare}
              onSquareClick={handleSquareClick}
              perspective={role}
              whiteHat={whiteHat}
              blackHat={blackHat}
            />
          ) : (
            <div className="loading">
              <div className="spinner-large" />
              <p className="loading-text">Loading board...</p>
            </div>
          )}

          {/* Move replay controls */}
          <div className="move-replay-controls">
            <button
              className="btn btn-secondary btn-sm replay-btn"
              onClick={goBack}
              disabled={!canGoBack}
              title="Previous move"
            >
              ◀
            </button>
            <span className="move-indicator">
              {isViewingHistory ? (
                <>Move {displayMoveNumber} <span className="viewing-history">(viewing history)</span></>
              ) : (
                <>Move {moveCount}</>
              )}
            </span>
            <button
              className="btn btn-secondary btn-sm replay-btn"
              onClick={goForward}
              disabled={!canGoForward && isAtCurrentMove}
              title="Next move"
            >
              ▶
            </button>
            {isViewingHistory && (
              <button
                className="btn btn-primary btn-sm"
                onClick={goToCurrent}
                title="Return to current"
              >
                Current
              </button>
            )}
          </div>

          {selectedSquare && !isViewingHistory && (
            <p className="note" style={{ marginTop: "0.5rem", textAlign: "center" }}>
              Press <kbd className="kbd">ESC</kbd> to deselect
            </p>
          )}
        </div>

        {/* Right side: Status panel with mini-game (always visible during gameplay) */}
        {phase !== "game_over" && !waitingForOpponentToJoin && (
          <div className="game-side-panel animate-slide-in-right">
            <div className="side-panel-status">
              {!isMyTurn ? (
                <>
                  <div className="spinner-medium" />
                  <h3>Opponent's Turn</h3>
                  <p>Waiting for opponent to make their move...</p>
                </>
              ) : (
                <>
                  <h3>Your Turn</h3>
                  <p>Select a piece and make your move!</p>
                </>
              )}
            </div>

            {/* Proof queue status badge */}
            {pendingProofCount > 0 && (
              <div className="proof-status-badge animate-slide-up">
                <div className="spinner-small" />
                <span>{pendingProofCount} proof{pendingProofCount > 1 ? "s" : ""} pending</span>
              </div>
            )}

            {/* Connection status indicators */}
            <div className="connection-status">
              <span className={`status-dot ${relayConnected ? "connected" : "disconnected"}`} />
              <span className="status-text">
                {relayConnected
                  ? (peerConnected ? "Relay: connected" : "Relay: waiting for peer")
                  : "Relay: offline (using chain polling)"}
              </span>
            </div>

            <div className="mini-game-section">
              <p className="mini-game-label">
                {isMyTurn && phase === "playing" ? "Make your move first!" : "Play while you wait!"}
              </p>
              <FlappyPawn playerColor={role} disabled={isMyTurn && phase === "playing"} />
            </div>

            {!isMyTurn && <DidYouKnow />}
          </div>
        )}
      </div>

      {/* Game over overlay - show for defeats or victories without a hat */}
      {phase === "game_over" && !(isVictory && wonHat) && (
        <div className="overlay animate-fade-in">
          <div className={`overlay-content animate-scale-in ${isVictory ? "victory" : isDefeat ? "defeat" : ""}`}>
            <div className="game-result-icon">
              {isVictory ? "🏆" : isDefeat ? "💀" : "🤝"}
            </div>
            <h2>
              {isVictory ? "Victory!" : isDefeat ? "Defeat" : "Game Over"}
            </h2>
            <p>{statusMessage}</p>
            <button
              className="btn btn-primary"
              onClick={() => window.location.reload()}
            >
              Play Again
            </button>
          </div>
        </div>
      )}

      {/* Victory Hat Modal - show for victories with a hat reward */}
      {phase === "game_over" && isVictory && wonHat && (
        <VictoryHatModal
          hat={wonHat}
          onPlayAgain={() => window.location.reload()}
        />
      )}
    </div>
  );
}
