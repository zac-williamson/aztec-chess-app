import React from "react";
import { useAztec } from "../hooks/useAztec";
import { useChessGame } from "../hooks/useChessGame";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";

export function App() {
  const aztec = useAztec();
  const game = useChessGame(aztec.wallet, aztec.address, aztec.node);

  // Phase 1: Connecting to Aztec (auto-connects on mount)
  if (!aztec.wallet || !aztec.address) {
    return (
      <div className="screen connect-screen animate-fade-in">
        <div className="brand-badge">
          <span className="aztec-logo">AZTEC</span>
          <span>Network</span>
        </div>

        <h1>Fog of War Chess</h1>
        <p className="subtitle">
          Private chess where you can only see what your pieces can see
        </p>

        {aztec.isConnecting && (
          <div className="status-bar spinner animate-slide-up">
            Connecting to Aztec network (Player {aztec.playerIndex})...
          </div>
        )}

        {aztec.error && (
          <>
            <div className="error-bar animate-slide-up">{aztec.error}</div>
            <p className="note mt-8">
              Open as Player 1: <a href="?player=0">?player=0</a><br />
              Open as Player 2: <a href="?player=1">?player=1</a>
            </p>
          </>
        )}

        {!aztec.error && (
          <p className="note mt-8">
            Requires an Aztec sandbox running at localhost:8080
          </p>
        )}
      </div>
    );
  }

  // Phase 2: Lobby (create/join game)
  if (
    game.phase === "lobby" ||
    game.phase === "creating" ||
    game.phase === "joining"
  ) {
    return (
      <LobbyScreen
        phase={game.phase}
        statusMessage={game.statusMessage}
        error={game.error}
        openGames={game.openGames}
        isLoadingGames={game.isLoadingGames}
        playerIndex={aztec.playerIndex}
        onCreateGame={game.createGame}
        onJoinGame={game.joinGame}
        onFetchOpenGames={game.fetchOpenGames}
      />
    );
  }

  // Phase 3: Playing (includes waiting for opponent)
  return (
    <GameScreen
      role={game.role || "white"}
      phase={game.phase}
      gameId={game.gameId}
      userState={game.userState}
      gameState={game.gameState}
      confirmedEmptySquares={game.confirmedEmptySquares}
      isMyTurn={game.isMyTurn}
      statusMessage={game.statusMessage}
      error={game.error}
      opponentJoined={game.opponentJoined}
      createdGamePassword={game.createdGamePassword}
      onMakeMove={game.makeMove}
    />
  );
}
