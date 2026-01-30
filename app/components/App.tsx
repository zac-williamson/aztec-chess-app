import React, { useState, useCallback } from "react";
import { useAztec } from "../hooks/useAztec";
import { useChessGame } from "../hooks/useChessGame";
import { ConnectScreen } from "./ConnectScreen";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";
import type { PlayerRole } from "../lib/types";

export function App() {
  const aztec = useAztec();
  const game = useChessGame(aztec.wallet, aztec.address, aztec.node);
  const [selectedRole, setSelectedRole] = useState<PlayerRole | null>(null);

  const handleConnect = useCallback(
    (playerIndex: number) => {
      setSelectedRole(playerIndex === 0 ? "white" : "black");
      aztec.connect(playerIndex);
    },
    [aztec.connect]
  );

  // Phase 1: Connect wallet
  if (!aztec.wallet || !aztec.address) {
    return (
      <ConnectScreen
        isConnecting={aztec.isConnecting}
        error={aztec.error}
        onConnect={handleConnect}
      />
    );
  }

  const effectiveRole = game.role || selectedRole || "white";

  // Phase 2: Lobby (create/join game)
  if (
    game.phase === "lobby" ||
    game.phase === "creating" ||
    game.phase === "waiting_opponent" ||
    game.phase === "joining"
  ) {
    return (
      <LobbyScreen
        role={effectiveRole}
        phase={game.phase}
        contractAddress={game.contractAddress}
        gameId={game.gameId}
        statusMessage={game.statusMessage}
        error={game.error}
        onCreateGame={game.createGame}
        onJoinGame={game.joinGame}
        onStartPlaying={game.startPlaying}
      />
    );
  }

  // Phase 3: Playing
  return (
    <GameScreen
      role={game.role || effectiveRole}
      phase={game.phase}
      gameId={game.gameId}
      userState={game.userState}
      gameState={game.gameState}
      confirmedEmptySquares={game.confirmedEmptySquares}
      isMyTurn={game.isMyTurn}
      statusMessage={game.statusMessage}
      error={game.error}
      onMakeMove={game.makeMove}
    />
  );
}
