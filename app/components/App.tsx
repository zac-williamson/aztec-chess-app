import React, { useState, useEffect, useRef } from "react";
import { useAztec } from "../hooks/useAztec";
import { useChessGame } from "../hooks/useChessGame";
import { usePlayerHats } from "../hooks/usePlayerHats";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";
import type { Hat } from "../lib/types";

export function App() {
  const aztec = useAztec();
  const game = useChessGame(aztec.wallet, aztec.address, aztec.node);
  const { bestHat: myHat, fetchHatForGame } = usePlayerHats(aztec.wallet, aztec.address, aztec.node);
  const [wonHat, setWonHat] = useState<Hat | null>(null);
  const lastCheckedGameRef = useRef<number | null>(null);

  // Fetch won hat when game ends with a victory
  useEffect(() => {
    const checkForWonHat = async () => {
      // Only check when game_over phase and we have a gameId
      if (game.phase !== "game_over" || game.gameId === null) {
        return;
      }

      // Check if this is a victory by checking the status message
      // (same logic as GameScreen uses)
      const isVictory = game.statusMessage.toLowerCase().includes("you captured");
      if (!isVictory) {
        console.log("Game over but not a victory (status:", game.statusMessage, ")");
        return;
      }

      // Don't re-check the same game
      if (lastCheckedGameRef.current === game.gameId) {
        return;
      }

      lastCheckedGameRef.current = game.gameId;

      console.log("Game ended with victory, checking for won hat...");

      // Try multiple times with increasing delays since hat minting may take time
      const delays = [2000, 5000, 10000, 15000]; // 2s, 5s, 10s, 15s

      for (let attempt = 0; attempt < delays.length; attempt++) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));

        console.log(`Attempt ${attempt + 1}/${delays.length} to fetch hat for game ${game.gameId}...`);
        const hat = await fetchHatForGame(game.gameId);

        if (hat) {
          console.log("Found won hat:", hat);
          setWonHat(hat);
          return;
        }

        console.log(`No hat found yet (attempt ${attempt + 1})`);
      }

      console.log("No hat found for game", game.gameId, "after all attempts");
    };

    checkForWonHat();
  }, [game.phase, game.gameId, game.statusMessage, fetchHatForGame]);

  // Reset wonHat when starting a new game
  useEffect(() => {
    if (game.phase === "lobby" || game.phase === "creating" || game.phase === "joining") {
      setWonHat(null);
      lastCheckedGameRef.current = null;
    }
  }, [game.phase]);

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
        savedGames={game.savedGames}
        onCreateGame={game.createGame}
        onJoinGame={game.joinGame}
        onResumeGame={game.resumeGame}
        onDeleteSavedGame={game.deleteSavedGame}
        onFetchOpenGames={game.fetchOpenGames}
      />
    );
  }

  // Phase 3: Playing (includes waiting for opponent)
  // Note: Opponent's hat would need to be fetched separately when they join
  // For now, we only show our own hat on the board
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
      myElo={game.myElo}
      opponentElo={game.opponentElo}
      myHat={myHat}
      opponentHat={null}
      wonHat={wonHat}
      onMakeMove={game.makeMove}
    />
  );
}
