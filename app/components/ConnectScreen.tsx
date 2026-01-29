import React from "react";

interface ConnectScreenProps {
  isConnecting: boolean;
  error: string | null;
  onConnect: (playerIndex: number) => void;
}

export function ConnectScreen({
  isConnecting,
  error,
  onConnect,
}: ConnectScreenProps) {
  return (
    <div className="screen connect-screen">
      <h1>Fog of War Chess</h1>
      <p className="subtitle">Powered by Aztec Network</p>

      <div className="connect-info">
        <p>
          Each player opens a separate browser tab and selects their role. White
          creates the game, Black joins it.
        </p>
        <p className="note">
          Requires an Aztec sandbox running at localhost:8080
        </p>
      </div>

      <div className="connect-buttons">
        <button
          className="btn btn-white"
          onClick={() => onConnect(0)}
          disabled={isConnecting}
        >
          Play as White
        </button>
        <button
          className="btn btn-black"
          onClick={() => onConnect(1)}
          disabled={isConnecting}
        >
          Play as Black
        </button>
      </div>

      {isConnecting && (
        <div className="status-bar">Connecting to Aztec network...</div>
      )}
      {error && <div className="error-bar">{error}</div>}
    </div>
  );
}
