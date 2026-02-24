import React, { useState, useEffect, useRef, useCallback } from "react";
import { useAztec } from "../hooks/useAztec";
import { useChessGame } from "../hooks/useChessGame";
import { useBotGame } from "../hooks/useBotGame";
import { usePlayerHats } from "../hooks/usePlayerHats";
import { useRelay } from "../hooks/useRelay";
import { LobbyScreen } from "./LobbyScreen";
import { GameScreen } from "./GameScreen";
import { DidYouKnow } from "./DidYouKnow";
import type { Hat, RelayMessage, GameMode, BotDifficulty, Emote } from "../lib/types";

export function App() {
  const aztec = useAztec();
  const game = useChessGame(aztec.wallet, aztec.address, aztec.node, aztec.feePaymentMethod);
  const bot = useBotGame(aztec.wallet, aztec.address, aztec.node);
  const { bestHat: myHat, fetchHatForGame } = usePlayerHats(aztec.wallet, aztec.address, aztec.node);
  const [wonHat, setWonHat] = useState<Hat | null>(null);
  const lastCheckedGameRef = useRef<number | null>(null);
  const [gameMode, setGameMode] = useState<GameMode>("none");
  const [receivedEmote, setReceivedEmote] = useState<Emote | null>(null);

  // Relay message handlers (stable refs via useCallback)
  const handleRelayMoveMsg = useCallback(
    (msg: Extract<RelayMessage, { type: "MOVE" }>) => {
      game.handleRelayMove(msg);
    },
    [game.handleRelayMove]
  );

  const handleMoveProven = useCallback(
    (msg: Extract<RelayMessage, { type: "MOVE_PROVEN" }>) => {
      console.log(`[relay] Peer's move #${msg.moveNumber} proven at block ${msg.blockNumber}`);
      game.handlePeerMoveProven(msg.moveNumber);
    },
    [game.handlePeerMoveProven]
  );

  const handleMoveFailed = useCallback(
    (msg: Extract<RelayMessage, { type: "MOVE_FAILED" }>) => {
      console.warn(`[relay] Peer's move #${msg.moveNumber} failed: ${msg.reason}`);
    },
    []
  );

  const handleEmote = useCallback(
    (msg: Extract<RelayMessage, { type: "EMOTE" }>) => {
      // Set a new object each time to retrigger the effect even for repeated emotes
      setReceivedEmote(null);
      setTimeout(() => setReceivedEmote(msg.emote), 0);
    },
    []
  );

  const relay = useRelay({
    gameId: game.gameId,
    role: game.role,
    phase: game.phase,
    onMove: handleRelayMoveMsg,
    onMoveProven: handleMoveProven,
    onMoveFailed: handleMoveFailed,
    onEmote: handleEmote,
  });

  // Wire relay send functions into useChessGame
  useEffect(() => {
    game.setRelaySendMove(relay.isConnected ? relay.sendMove : null);
    game.setRelaySendMoveProven(relay.isConnected ? relay.sendMoveProven : null);
    game.setRelaySendMoveFailed(relay.isConnected ? relay.sendMoveFailed : null);
    game.setRelayConnected(relay.isConnected);
  }, [
    relay.isConnected,
    relay.sendMove,
    relay.sendMoveProven,
    relay.sendMoveFailed,
    game.setRelaySendMove,
    game.setRelaySendMoveProven,
    game.setRelaySendMoveFailed,
    game.setRelayConnected,
  ]);

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

  // Track game mode based on active game phases
  useEffect(() => {
    if (gameMode === "bot" && bot.phase === "lobby") {
      setGameMode("none");
    }
  }, [gameMode, bot.phase]);

  const handleStartBotGame = useCallback(async (difficulty: BotDifficulty) => {
    setGameMode("bot");
    await bot.startBotGame(difficulty);
  }, [bot.startBotGame]);

  const handleBotReturnToLobby = useCallback(() => {
    bot.returnToLobby();
    setGameMode("none");
  }, [bot.returnToLobby]);

  // Phase 1: Connecting to Aztec (auto-connects on mount)
  if (!aztec.wallet || !aztec.address) {
    return (
      <div className="screen connect-screen animate-fade-in">
        <div className="brand-badge">
          <span className="aztec-logo">AZTEC</span>
          <span>Network</span>
        </div>

        <h1>
          <span className="title-fog">Fog of War</span>{' '}
          <span className="title-chess">C<span className="title-chess-italic">h</span>e<span className="title-chess-italic">s</span>s</span>
          <span className="title-version"> v0.2</span>
        </h1>
        <p className="subtitle">
          Private chess where you can only see what your pieces can see
        </p>

        {aztec.isConnecting && (
          <div className="status-bar spinner animate-slide-up">
            Connecting to Aztec Devnet...
          </div>
        )}

        {aztec.error && (
          <div className="error-bar animate-slide-up">{aztec.error}</div>
        )}

        {!aztec.error && (
          <p className="note mt-8">
            Creating your account on Aztec Devnet...<br />
            This may take a moment on first load.
          </p>
        )}

        {aztec.isConnecting && <DidYouKnow />}
      </div>
    );
  }

  // Phase 2: Bot game in progress
  if (gameMode === "bot" && bot.phase !== "lobby") {
    return (
      <GameScreen
        role={bot.role}
        phase={bot.phase}
        gameId={null}
        userState={bot.userState}
        gameState={bot.gameState}
        confirmedEmptySquares={bot.confirmedEmptySquares}
        isMyTurn={bot.isMyTurn}
        statusMessage={bot.statusMessage}
        error={bot.error}
        opponentJoined={true}
        createdGamePassword=""
        myElo={0}
        opponentElo={0}
        pendingProofCount={0}
        relayConnected={false}
        peerConnected={false}
        onMakeMove={bot.makeMove}
        isBotGame={true}
        isBotThinking={bot.isBotThinking}
        botDifficulty={bot.botDifficulty}
        onReturnToLobby={handleBotReturnToLobby}
        onPlayAgain={() => bot.startBotGame(bot.botDifficulty || "medium")}
      />
    );
  }

  // Phase 3: Lobby (create/join game or play vs bot)
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
        txStep={game.txStep}
        onCreateGame={game.createGame}
        onJoinGame={game.joinGame}
        onResumeGame={game.resumeGame}
        onDeleteSavedGame={game.deleteSavedGame}
        onFetchOpenGames={game.fetchOpenGames}
        onStartBotGame={handleStartBotGame}
      />
    );
  }

  // Phase 4: Multiplayer game in progress
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
      pendingProofCount={game.pendingProofCount}
      relayConnected={relay.isConnected}
      peerConnected={relay.isPeerConnected}
      onMakeMove={game.makeMove}
      onSendEmote={relay.sendEmote}
      receivedEmote={receivedEmote}
      onReturnToLobby={game.returnToLobby}
    />
  );
}
