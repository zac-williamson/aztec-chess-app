import React, { useState, useCallback, useEffect } from "react";
import type { OpenGame } from "../lib/types";

interface LobbyScreenProps {
  phase: string;
  statusMessage: string;
  error: string | null;
  openGames: OpenGame[];
  isLoadingGames: boolean;
  playerIndex: number;
  onCreateGame: (password: number) => void;
  onJoinGame: (gameId: number, password: number) => void;
  onFetchOpenGames: () => Promise<void>;
}

export function LobbyScreen({
  phase,
  statusMessage,
  error,
  openGames,
  isLoadingGames,
  playerIndex,
  onCreateGame,
  onJoinGame,
  onFetchOpenGames,
}: LobbyScreenProps) {
  const [createPassword, setCreatePassword] = useState("");
  const [joinGameId, setJoinGameId] = useState("");
  const [joinPassword, setJoinPassword] = useState("");
  const [joiningGameId, setJoiningGameId] = useState<number | null>(null);
  const [joinModalPassword, setJoinModalPassword] = useState("");

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
      onJoinGame(game.gameId, 0);
    }
  }, [onJoinGame]);

  const handleConfirmJoin = useCallback(() => {
    if (joiningGameId !== null) {
      onJoinGame(joiningGameId, Number(joinModalPassword));
      setJoiningGameId(null);
    }
  }, [joiningGameId, joinModalPassword, onJoinGame]);

  const handleCancelJoin = useCallback(() => {
    setJoiningGameId(null);
    setJoinModalPassword("");
  }, []);

  // Creating/Joining in progress
  if (phase === "creating" || phase === "joining") {
    return (
      <div className="screen lobby-screen animate-fade-in">
        <h2>Game Lobby</h2>
        <div className="status-bar spinner animate-slide-up">
          {statusMessage}
        </div>
        {error && <div className="error-bar animate-slide-up">{error}</div>}
      </div>
    );
  }

  // Main lobby screen
  return (
    <div className="screen lobby-screen animate-fade-in">
      <h2>Game Lobby</h2>
      <div className="player-info">
        Connected as <strong>Player {playerIndex + 1}</strong>
        {playerIndex === 0 ? (
          <span className="player-switch"> &middot; <a href="?player=1">Switch to Player 2</a></span>
        ) : (
          <span className="player-switch"> &middot; <a href="?player=0">Switch to Player 1</a></span>
        )}
      </div>

      {/* Password modal for joining games */}
      {joiningGameId !== null && (
        <div className="modal-overlay" onClick={handleCancelJoin}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Enter Password</h3>
            <p>Game #{joiningGameId} requires a password</p>
            <input
              type="number"
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
          <p className="note">You will play as White</p>
          <label>
            Password (optional)
            <input
              type="number"
              value={createPassword}
              onChange={(e) => setCreatePassword(e.target.value)}
              disabled={isBusy}
              placeholder="Leave empty for no password"
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => onCreateGame(Number(createPassword) || 0)}
            disabled={isBusy}
          >
            Create Game
          </button>
        </div>

        {/* Join by ID */}
        <div className="lobby-action-box">
          <h3>Join by Game ID</h3>
          <p className="note">You will play as Black</p>
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
              type="number"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              disabled={isBusy}
              placeholder="Enter password (0 if none)"
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() => onJoinGame(Number(joinGameId), Number(joinPassword) || 0)}
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
