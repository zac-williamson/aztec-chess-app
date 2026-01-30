import React, { useState } from "react";
import type { PlayerRole } from "../lib/types";

interface LobbyScreenProps {
  role: PlayerRole;
  phase: string;
  contractAddress: string | null;
  gameId: number | null;
  statusMessage: string;
  error: string | null;
  onCreateGame: (password: number) => void;
  onJoinGame: (gameId: number, password: number) => void;
  onStartPlaying: () => void;
}

export function LobbyScreen({
  role,
  phase,
  contractAddress,
  gameId,
  statusMessage,
  error,
  onCreateGame,
  onJoinGame,
  onStartPlaying,
}: LobbyScreenProps) {
  const [password, setPassword] = useState("3");
  const [joinGameId, setJoinGameId] = useState("0");
  const [joinPassword, setJoinPassword] = useState("3");

  const isBusy = phase === "creating" || phase === "joining";

  if (role === "white") {
    return (
      <div className="screen lobby-screen">
        <h2>Create Game (White)</h2>

        {phase === "lobby" && (
          <div className="form-group">
            <label>
              Game password:
              <input
                type="number"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isBusy}
              />
            </label>
            <button
              className="btn btn-primary"
              onClick={() => onCreateGame(Number(password))}
              disabled={isBusy}
            >
              Create Game
            </button>
          </div>
        )}

        {isBusy && <div className="status-bar spinner">{statusMessage}</div>}

        {phase === "waiting_opponent" && (
          <div className="game-info">
            <p className="success">{statusMessage}</p>
            <div className="info-box">
              <div>
                <strong>Contract Address:</strong>
                <code>{contractAddress}</code>
              </div>
              <div>
                <strong>Game ID:</strong> <code>{gameId}</code>
              </div>
              <div>
                <strong>Password:</strong> <code>{password}</code>
              </div>
            </div>
            <p className="note">
              Share the contract address, game ID, and password with your
              opponent.
            </p>
            <p className="note">
              Click "Start Playing" once your opponent has joined the game.
            </p>
            <button className="btn btn-primary" onClick={onStartPlaying}>
              Start Playing
            </button>
          </div>
        )}

        {error && <div className="error-bar">{error}</div>}
      </div>
    );
  }

  // Black player — join game
  return (
    <div className="screen lobby-screen">
      <h2>Join Game (Black)</h2>

      {phase === "lobby" && (
        <div className="form-group">
          <label>
            Game ID:
            <input
              type="number"
              value={joinGameId}
              onChange={(e) => setJoinGameId(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <label>
            Password:
            <input
              type="number"
              value={joinPassword}
              onChange={(e) => setJoinPassword(e.target.value)}
              disabled={isBusy}
            />
          </label>
          <button
            className="btn btn-primary"
            onClick={() =>
              onJoinGame(Number(joinGameId), Number(joinPassword))
            }
            disabled={isBusy}
          >
            Join Game
          </button>
        </div>
      )}

      {isBusy && <div className="status-bar spinner">{statusMessage}</div>}
      {error && <div className="error-bar">{error}</div>}
    </div>
  );
}
