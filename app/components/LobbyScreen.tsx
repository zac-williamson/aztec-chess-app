import React, { useState, useCallback, useEffect } from "react";
import { DidYouKnow } from "./DidYouKnow";
import { TxProgress } from "./TxProgress";
import { BotDifficultyPicker } from "./BotDifficultyPicker";
import type { OpenGame, SavedGame, TxStep, BotDifficulty } from "../lib/types";

interface LobbyScreenProps {
  phase: string;
  statusMessage: string;
  error: string | null;
  openGames: OpenGame[];
  isLoadingGames: boolean;
  savedGames: SavedGame[];
  txStep: TxStep | null;
  onCreateGame: (password: string) => void;
  onJoinGame: (gameId: number, password: string) => void;
  onResumeGame: (savedGame: SavedGame) => void;
  onDeleteSavedGame: (gameId: number) => void;
  onFetchOpenGames: () => Promise<void>;
  onStartBotGame?: (difficulty: BotDifficulty) => void;
}

function formatElapsedTime(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function LobbyScreen({
  phase,
  statusMessage,
  error,
  openGames,
  isLoadingGames,
  savedGames,
  txStep,
  onCreateGame,
  onJoinGame,
  onResumeGame,
  onDeleteSavedGame,
  onFetchOpenGames,
  onStartBotGame,
}: LobbyScreenProps) {
  const [createPassword, setCreatePassword] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joiningGameId, setJoiningGameId] = useState<number | null>(null);
  const [joinModalPassword, setJoinModalPassword] = useState("");
  const [deletingGameId, setDeletingGameId] = useState<number | null>(null);

  const isBusy = phase === "creating" || phase === "joining";

  // Fetch open games on mount
  useEffect(() => {
    if (phase === "lobby") {
      onFetchOpenGames();
    }
  }, [phase, onFetchOpenGames]);

  const handleJoinFromList = useCallback((game: OpenGame) => {
    if (game.hasPassword) {
      setJoiningGameId(game.gameId);
      setJoinModalPassword("");
    } else {
      onJoinGame(game.gameId, "");
    }
  }, [onJoinGame]);

  const handleConfirmJoin = useCallback(() => {
    if (joiningGameId !== null) {
      onJoinGame(joiningGameId, joinModalPassword);
      setJoiningGameId(null);
    }
  }, [joiningGameId, joinModalPassword, onJoinGame]);

  const handleCancelJoin = useCallback(() => {
    setJoiningGameId(null);
    setJoinModalPassword("");
  }, []);

  const handleDeleteClick = useCallback((gameId: number) => {
    setDeletingGameId(gameId);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (deletingGameId !== null) {
      onDeleteSavedGame(deletingGameId);
      setDeletingGameId(null);
    }
  }, [deletingGameId, onDeleteSavedGame]);

  const handleCancelDelete = useCallback(() => {
    setDeletingGameId(null);
  }, []);

  // Creating/Joining in progress
  if (phase === "creating" || phase === "joining") {
    return (
      <div className="screen lobby-screen animate-fade-in">
        <h2>Game Lobby</h2>
        {txStep && <TxProgress step={txStep} />}
        {error && <div className="error-bar animate-slide-up">{error}</div>}
        <DidYouKnow />
      </div>
    );
  }


  // Main lobby screen
  return (
    <div className="screen lobby-screen animate-fade-in">
      <h2>Game Lobby</h2>

      {/* Saved Games Section */}
      {savedGames.length > 0 && (
        <div className="lobby-section saved-games-section">
          <div className="section-header">
            <h3>Your Games</h3>
          </div>
          <div className="games-list">
            {savedGames.map((game) => (
              <div key={game.gameId} className="game-row saved-game-row">
                <span className="game-id">Game #{game.gameId}</span>
                <span className={`role-badge-small ${game.role}`}>
                  {game.role === "white" ? "White" : "Black"}
                </span>
                <div className="game-actions">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => onResumeGame(game)}
                    disabled={isBusy}
                  >
                    Resume
                  </button>
                  <button
                    className="btn btn-secondary btn-sm btn-danger"
                    onClick={() => handleDeleteClick(game.gameId)}
                    disabled={isBusy}
                    title="Delete saved game"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Password modal for joining games */}
      {joiningGameId !== null && (
        <div className="modal-overlay" onClick={handleCancelJoin}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Enter Password</h3>
            <p>Game #{joiningGameId} requires a password</p>
            <input
              type="text"
              value={joinModalPassword}
              onChange={(e) => setJoinModalPassword(e.target.value)}
              placeholder="Enter password"
              autoFocus
            />
            <div className="modal-buttons">
              <button className="btn btn-secondary" onClick={handleCancelJoin}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={handleConfirmJoin}>
                Join
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deletingGameId !== null && (
        <div className="modal-overlay" onClick={handleCancelDelete}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Delete Game?</h3>
            <p>
              Are you sure you want to delete Game #{deletingGameId}?
              <br />
              <strong>This will permanently remove your ability to rejoin this game.</strong>
            </p>
            <div className="modal-buttons">
              <button className="btn btn-secondary" onClick={handleCancelDelete}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Play vs Bot Section */}
      {onStartBotGame && (
        <div className="lobby-section bot-section">
          <div className="section-header">
            <h3>Play vs Bot</h3>
          </div>
          <p className="note">Practice offline — no blockchain transactions</p>
          <BotDifficultyPicker onSelect={onStartBotGame} disabled={isBusy} />
        </div>
      )}

      <div className="divider-with-text">
        <span>or play online</span>
      </div>

      {/* Open Games Section */}
      <div className="lobby-section">
        <div className="section-header">
          <h3>Open Games</h3>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onFetchOpenGames}
            disabled={isLoadingGames}
          >
            {isLoadingGames ? "Loading..." : "Refresh"}
          </button>
        </div>

        <div className="games-list">
          {isLoadingGames && openGames.length === 0 && (
            <div className="games-loading">Loading open games...</div>
          )}

          {!isLoadingGames && openGames.length === 0 && (
            <div className="games-empty">
              No open games found. Create one below!
            </div>
          )}

          {openGames.map((game) => (
            <div key={game.gameId} className="game-row">
              <span className="game-id">Game #{game.gameId}</span>
              <span className="game-elapsed-time">{formatElapsedTime(game.elapsedSeconds)}</span>
              <span className="game-password-icon" title={game.hasPassword ? "Password protected" : "No password"}>
                {game.hasPassword ? "🔒" : "🔓"}
              </span>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => handleJoinFromList(game)}
                disabled={isBusy}
              >
                Join
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="divider-with-text">
        <span>or</span>
      </div>

      {/* Create/Join Actions */}
      <div className="lobby-actions">
        {/* Create Game */}
        <div className="lobby-action-box">
          <h3>Create Game</h3>
          <p className="note">You will play as Black</p>
          <label>
            Password (optional)
            <input
              type="text"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              disabled={isBusy}
              placeholder="Leave empty for no password"
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => onCreateGame(createPassword)}
            disabled={isBusy}
          >
            Create Game
          </button>
        </div>

        {/* Join by ID */}
        <div className="lobby-action-box">
          <h3>Join by Game ID</h3>
          <p className="note">You will play as White</p>
          <label>
            Game ID
            <input
              type="number"
              value={joinGameId}
              onChange={(e) => setJoinGameId(e.target.value)}
              disabled={isBusy}
              placeholder="Enter game ID"
            />
          </label>
          <label>
            Password
            <input
              type="text"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              disabled={isBusy}
              placeholder="Leave empty if none"
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => onJoinGame(Number(joinGameId), joinPassword)}
            disabled={isBusy || !joinGameId}
          >
            Join Game
          </button>
        </div>
      </div>

      {error && <div className="error-bar animate-slide-up">{error}</div>}
    </div>
  );
}
