/**
 * Bot game hook: manages a fog-of-war chess game against a local PIMC bot.
 *
 * All state transitions use contract.simulate() — purely local Noir execution,
 * no transactions, no relay, no proofs. Both player states are maintained locally.
 *
 * MPC encryption/decryption is bypassed entirely since we control both sides.
 * Instead, each player's fog-of-war view is computed directly in TypeScript.
 */

import { useState, useRef, useCallback } from "react";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
} from "../artifacts/FogOfWarChess";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { PIECE_IDS, WHITE_PLAYER } from "../lib/types";
import type { GamePhase, PlayerRole, BotDifficulty } from "../lib/types";
import { computeClientVision, rowColToNoirXY } from "../lib/chessUtils";
import {
  selectBotMove,
  createInitialBeliefState,
  recordCapture,
  type BeliefState,
} from "../lib/botEngine";

/**
 * Recursively convert BigInt values to numbers so React state is
 * JSON-serializable (React DevTools / profiler calls JSON.stringify
 * on component props, which throws on BigInt).
 * Refs keep the raw BigInt data for passing back into simulate().
 */
function convertBigInts(obj: any): any {
  if (typeof obj === "bigint") return Number(obj);
  if (Array.isArray(obj)) return obj.map(convertBigInts);
  if (obj !== null && typeof obj === "object") {
    const out: any = {};
    for (const k of Object.keys(obj)) {
      out[k] = convertBigInts(obj[k]);
    }
    return out;
  }
  return obj;
}

/**
 * After one player moves, update the other player's fog-of-war view.
 *
 * This directly replicates the logic of consume_opponent_move_and_update_game_state
 * without going through MPC encryption/decryption:
 * - Visible squares: show the moving player's pieces, clear squares they vacated
 * - Non-visible squares: remove stale opponent pieces (lost vision)
 */
function updateOpponentView(
  movingPlayerBoard: any[],
  opponentBoard: any[],
  opponentPlayerId: number
): any[] {
  const movingPlayerId = opponentPlayerId === 0 ? 1 : 0;

  // Compute opponent's vision based on their current board
  const vision = computeClientVision(opponentBoard, opponentPlayerId);

  const newBoard = opponentBoard.map((p: any) => ({ ...p }));

  for (let i = 0; i < 64; i++) {
    const isVisible = vision[i];
    const currentPiece = opponentBoard[i];
    const currentId = Number(currentPiece.id);
    const currentPid = Number(currentPiece.player_id);
    const movedPiece = movingPlayerBoard[i];
    const movedId = Number(movedPiece.id);
    const movedPid = Number(movedPiece.player_id);

    if (isVisible) {
      // Opponent can see this square — update with moving player's data
      if (movedId !== PIECE_IDS.EMPTY && movedPid === movingPlayerId) {
        // Moving player has their piece here — show it
        newBoard[i] = { id: movedId, player_id: movedPid, has_moved: Number(movedPiece.has_moved) };
      } else if (currentId !== PIECE_IDS.EMPTY && currentPid === movingPlayerId) {
        // Had a moving player piece here but it's gone now — clear it
        newBoard[i] = { id: PIECE_IDS.EMPTY, player_id: 0, has_moved: 0 };
      }
      // If the square has the opponent's own piece, leave it unchanged
    } else {
      // Not visible — clear any stale moving player pieces
      if (currentId !== PIECE_IDS.EMPTY && currentPid === movingPlayerId) {
        newBoard[i] = { id: PIECE_IDS.EMPTY, player_id: 0, has_moved: 0 };
      }
    }
  }

  return newBoard;
}

interface UseBotGameReturn {
  phase: GamePhase;
  role: PlayerRole;
  gameState: any;
  userState: any;
  confirmedEmptySquares: Set<number>;
  isMyTurn: boolean;
  statusMessage: string;
  error: string | null;
  isBotThinking: boolean;
  botDifficulty: BotDifficulty | null;
  makeMove: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) => Promise<void>;
  startBotGame: (difficulty: BotDifficulty) => Promise<void>;
  returnToLobby: () => void;
}

export function useBotGame(
  wallet: any,
  address: AztecAddress | null,
  node: any
): UseBotGameReturn {
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [gameState, setGameState] = useState<any>(null);
  const [userState, setUserState] = useState<any>(null);
  const [confirmedEmptySquares, setConfirmedEmptySquares] = useState<Set<number>>(new Set());
  const [isMyTurn, setIsMyTurn] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [botDifficulty, setBotDifficulty] = useState<BotDifficulty | null>(null);

  // Refs for state that needs to be current in async callbacks
  const contractRef = useRef<FogOfWarChessContract | null>(null);
  const userStateRef = useRef<any>(null);
  // Bot's own user state (black side)
  const botUserStateRef = useRef<any>(null);
  const beliefRef = useRef<BeliefState | null>(null);
  const difficultyRef = useRef<BotDifficulty>("medium");
  const moveInProgressRef = useRef(false);
  const moveCountRef = useRef(0);

  // Keep refs in sync — refs hold raw BigInt data for simulate(),
  // React state gets converted copies (no BigInts) for safe rendering.
  const syncState = useCallback((us: any) => {
    userStateRef.current = us;
    setUserState(convertBigInts(us));
    setGameState({ move_count: moveCountRef.current });
  }, []);

  // ─── Start a bot game ──────────────────────────────────────────────

  const startBotGame = useCallback(
    async (difficulty: BotDifficulty) => {
      if (!wallet || !address || !node) return;
      setError(null);
      setBotDifficulty(difficulty);
      difficultyRef.current = difficulty;

      try {
        setPhase("creating");
        setStatusMessage("Setting up bot game...");

        // Connect to existing contract
        const contractConfig = (await import("../config/contract-address.json")).default;
        if (!contractConfig.contractAddress) {
          throw new Error("No contract address configured.");
        }

        const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
        const contractAztecAddr = AztecAddr.fromString(contractConfig.contractAddress);

        const contractInstance = await node.getContract(contractAztecAddr);
        if (!contractInstance) {
          throw new Error("Contract not found. Has it been deployed?");
        }
        await wallet.registerContract(contractInstance, FogOfWarChessContractArtifact);

        const contract = FogOfWarChessContract.at(contractAztecAddr, wallet);
        contractRef.current = contract;

        // Initialize both player states via Noir (sets up piece positions)
        const whiteState = await contract.methods
          .__empty_white_state()
          .simulate({ from: address });

        const blackState = await contract.methods
          .__empty_black_state()
          .simulate({ from: address });

        // Compute initial vision for white (human player)
        const clientVision = computeClientVision(whiteState.game_state, WHITE_PLAYER);
        const initialConfirmed = new Set<number>();
        for (let i = 0; i < 64; i++) {
          if (clientVision[i] && Number(whiteState.game_state[i].id) === PIECE_IDS.EMPTY) {
            initialConfirmed.add(i);
          }
        }

        // Initialize bot belief state
        beliefRef.current = createInitialBeliefState(WHITE_PLAYER); // bot tracks white pieces
        moveCountRef.current = 0;

        botUserStateRef.current = blackState;
        syncState(whiteState);
        setConfirmedEmptySquares(initialConfirmed);
        setIsMyTurn(true);
        setPhase("playing");
        setStatusMessage("Your turn! You are White.");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to start bot game";
        setError(msg);
        setPhase("lobby");
        console.error("Start bot game error:", e);
      }
    },
    [wallet, address, node, syncState]
  );

  // ─── Execute bot's response move ───────────────────────────────────

  const executeBotMove = useCallback(
    async (humanUs: any) => {
      if (!contractRef.current || !address || !beliefRef.current) return;

      const contract = contractRef.current;
      const botUs = botUserStateRef.current;
      if (!botUs) return;

      setIsBotThinking(true);
      setStatusMessage("Bot is thinking...");

      // Small delay for UX feel
      await new Promise((r) => setTimeout(r, 800 + Math.random() * 700));

      try {
        const botPlayerId = 1; // black
        const humanPlayerId = 0; // white

        // Bot selects a move using PIMC
        const botMove = selectBotMove(
          botUs.game_state,
          botPlayerId,
          beliefRef.current,
          difficultyRef.current
        );

        if (!botMove) {
          setStatusMessage("Bot has no legal moves. Your turn!");
          setIsMyTurn(true);
          setIsBotThinking(false);
          return;
        }

        // Check if bot is capturing human's king
        const targetPiece = botUs.game_state[botMove.toIndex];
        const capturingKing =
          Number(targetPiece.id) === PIECE_IDS.KING &&
          Number(targetPiece.player_id) === humanPlayerId;

        // Create move data
        const moveData = await contract.methods
          .__create_move(botMove.fromX, botMove.fromY, botMove.toX, botMove.toY)
          .simulate({ from: address });

        // Update bot's board via Noir (validates move + applies it)
        const isFirstTwo = moveCountRef.current < 2;
        const newBotUs = await contract.methods
          .__update_user_state_from_move(isFirstTwo, botUs, moveData, botPlayerId)
          .simulate({ from: address });

        moveCountRef.current += 1;

        // Update human's fog-of-war view directly (no MPC)
        const newHumanBoard = updateOpponentView(
          newBotUs.game_state,
          humanUs.game_state,
          humanPlayerId
        );
        const newHumanUs = { ...humanUs, game_state: newHumanBoard };

        // Update confirmed empty squares for human
        const clientVision = computeClientVision(newHumanBoard, humanPlayerId);
        const newConfirmed = new Set<number>();
        for (let i = 0; i < 64; i++) {
          if (clientVision[i] && Number(newHumanBoard[i].id) === PIECE_IDS.EMPTY) {
            newConfirmed.add(i);
          }
        }

        botUserStateRef.current = newBotUs;
        syncState(newHumanUs);
        setConfirmedEmptySquares(newConfirmed);

        if (capturingKing) {
          setPhase("game_over");
          setStatusMessage("Game over! Your king was captured.");
          setIsMyTurn(false);
        } else {
          setIsMyTurn(true);
          setStatusMessage("Your turn!");
        }
      } catch (e) {
        console.error("Bot move error:", e);
        setError("Bot encountered an error. Try again.");
        setIsMyTurn(true);
      } finally {
        setIsBotThinking(false);
      }
    },
    [address, syncState]
  );

  // ─── Human player makes a move ────────────────────────────────────

  const makeMove = useCallback(
    async (
      fromRow: number,
      fromCol: number,
      toRow: number,
      toCol: number
    ) => {
      if (!contractRef.current || !address || moveInProgressRef.current) return;
      moveInProgressRef.current = true;

      const contract = contractRef.current;
      const us = userStateRef.current;
      if (!us) {
        moveInProgressRef.current = false;
        return;
      }

      setError(null);

      try {
        const humanPlayerId = 0; // white
        const botPlayerId = 1; // black

        const from = rowColToNoirXY(fromRow, fromCol, "white");
        const to = rowColToNoirXY(toRow, toCol, "white");

        // Check if capturing bot's king
        const targetIndex = to.x + to.y * 8;
        const targetPiece = us.game_state[targetIndex];
        const capturingKing =
          Number(targetPiece.id) === PIECE_IDS.KING &&
          Number(targetPiece.player_id) === botPlayerId;

        // Update bot belief state for captures
        const capturedId = Number(targetPiece.id);
        if (capturedId !== PIECE_IDS.EMPTY && Number(targetPiece.player_id) === botPlayerId && beliefRef.current) {
          beliefRef.current = recordCapture(beliefRef.current, capturedId);
        }

        // Create move data
        const moveData = await contract.methods
          .__create_move(from.x, from.y, to.x, to.y)
          .simulate({ from: address });

        // Update human's board via Noir (validates move + applies it)
        const isFirstTwo = moveCountRef.current < 2;
        const newHumanUs = await contract.methods
          .__update_user_state_from_move(isFirstTwo, us, moveData, humanPlayerId)
          .simulate({ from: address });

        moveCountRef.current += 1;

        // Update bot's fog-of-war view directly (no MPC)
        const botUs = botUserStateRef.current;
        if (botUs) {
          const newBotBoard = updateOpponentView(
            newHumanUs.game_state,
            botUs.game_state,
            botPlayerId
          );
          botUserStateRef.current = { ...botUs, game_state: newBotBoard };
        }

        syncState(newHumanUs);

        if (capturingKing) {
          setPhase("game_over");
          setStatusMessage("Game over! You captured the opponent's king!");
          setIsMyTurn(false);
          moveInProgressRef.current = false;
          return;
        }

        setIsMyTurn(false);
        setStatusMessage("Bot is thinking...");
        moveInProgressRef.current = false;

        // Trigger bot's response
        await executeBotMove(newHumanUs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Move failed";
        setError(msg);
        console.error("Human move error:", e);
        moveInProgressRef.current = false;
      }
    },
    [address, syncState, executeBotMove]
  );

  // ─── Return to lobby ──────────────────────────────────────────────

  const returnToLobby = useCallback(() => {
    setPhase("lobby");
    setGameState(null);
    setUserState(null);
    userStateRef.current = null;
    botUserStateRef.current = null;
    beliefRef.current = null;
    setConfirmedEmptySquares(new Set());
    setIsMyTurn(false);
    setStatusMessage("");
    setError(null);
    setIsBotThinking(false);
    setBotDifficulty(null);
    moveInProgressRef.current = false;
    moveCountRef.current = 0;
  }, []);

  return {
    phase,
    role: "white" as PlayerRole, // Human always plays white
    gameState,
    userState,
    confirmedEmptySquares,
    isMyTurn,
    statusMessage,
    error,
    isBotThinking,
    botDifficulty,
    makeMove,
    startBotGame,
    returnToLobby,
  };
}
