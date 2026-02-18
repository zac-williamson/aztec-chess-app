/**
 * Bot game hook: manages a fog-of-war chess game against a local PIMC bot.
 *
 * All state transitions use contract.simulate() — purely local Noir execution,
 * no transactions, no relay, no proofs. Both player states are maintained locally.
 */

import { useState, useRef, useCallback } from "react";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
} from "../artifacts/FogOfWarChess";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
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
  const gameStateRef = useRef<any>(null);
  const userStateRef = useRef<any>(null);
  // Bot's own user state (black side)
  const botUserStateRef = useRef<any>(null);
  const beliefRef = useRef<BeliefState | null>(null);
  const difficultyRef = useRef<BotDifficulty>("medium");
  const moveInProgressRef = useRef(false);

  // Keep refs in sync — refs hold raw BigInt data for simulate(),
  // React state gets converted copies (no BigInts) for safe rendering.
  const syncRefs = useCallback((gs: any, us: any) => {
    gameStateRef.current = gs;
    userStateRef.current = us;
    setGameState(convertBigInts(gs));
    setUserState(convertBigInts(us));
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

        // Initialize empty game state
        let gs = await contract.methods
          .__empty_game_state()
          .simulate({ from: address });

        // Initialize both player states
        const whiteState = await contract.methods
          .__empty_white_state()
          .simulate({ from: address });

        const blackState = await contract.methods
          .__empty_black_state()
          .simulate({ from: address });

        // Generate secrets for both players
        const whiteEncrypt = Fr.random();
        const whiteMask = Fr.random();
        const blackEncrypt = Fr.random();
        const blackMask = Fr.random();

        whiteState.encrypt_secret = whiteEncrypt;
        whiteState.mask_secret = whiteMask;
        blackState.encrypt_secret = blackEncrypt;
        blackState.mask_secret = blackMask;

        // Commit secrets for both players
        gs = await contract.methods
          .__commit_to_user_secrets(gs, whiteEncrypt, whiteMask, 0)
          .simulate({ from: address });

        gs = await contract.methods
          .__commit_to_user_secrets(gs, blackEncrypt, blackMask, 1)
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

        botUserStateRef.current = blackState;
        syncRefs(gs, whiteState);
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
    [wallet, address, node, syncRefs]
  );

  // ─── Execute bot's response move ───────────────────────────────────

  const executeBotMove = useCallback(
    async (gs: any, humanUs: any) => {
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
          // No legal moves - bot is stuck (shouldn't happen in normal play)
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

        // Execute bot's move through the simulate pipeline
        const moveData = await contract.methods
          .__create_move(botMove.fromX, botMove.fromY, botMove.toX, botMove.toY)
          .simulate({ from: address });

        const userOutputState = await contract.methods
          .__compute_move_output(gs, botUs, moveData, botPlayerId)
          .simulate({ from: address });

        // Update bot's own user state
        const currentMoveNumber = Number(gs.move_count);
        const isFirstTwo = currentMoveNumber < 2;
        const newBotUs = await contract.methods
          .__update_user_state_from_move(isFirstTwo, botUs, moveData, botPlayerId)
          .simulate({ from: address });

        // Update shared game state
        const newGs = await contract.methods
          .__update_game_state_from_move(gs, userOutputState, botPlayerId)
          .simulate({ from: address });

        // Human consumes bot's move
        const newHumanUs = await contract.methods
          .__consume_opponent_move(newGs, humanUs, humanPlayerId)
          .simulate({ from: address });

        // Update confirmed empty squares for human
        const clientVision = computeClientVision(newHumanUs.game_state, humanPlayerId);
        const newConfirmed = new Set<number>();
        for (let i = 0; i < 64; i++) {
          if (clientVision[i] && Number(newHumanUs.game_state[i].id) === PIECE_IDS.EMPTY) {
            newConfirmed.add(i);
          }
        }

        botUserStateRef.current = newBotUs;
        syncRefs(newGs, newHumanUs);
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
    [address, syncRefs]
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
      const gs = gameStateRef.current;
      const us = userStateRef.current;
      if (!gs || !us) {
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

        // Update bot's belief state if we're capturing a bot piece
        const capturedId = Number(targetPiece.id);
        if (capturedId !== PIECE_IDS.EMPTY && Number(targetPiece.player_id) === botPlayerId) {
          // Bot doesn't observe this directly, but we track it for sampling accuracy
          // (The bot will see the capture when it consumes the opponent move)
        }

        // Step 1: Create move
        const moveData = await contract.methods
          .__create_move(from.x, from.y, to.x, to.y)
          .simulate({ from: address });

        // Step 2: Compute output
        const userOutputState = await contract.methods
          .__compute_move_output(gs, us, moveData, humanPlayerId)
          .simulate({ from: address });

        // Step 3: Update human's user state
        const currentMoveNumber = Number(gs.move_count);
        const isFirstTwo = currentMoveNumber < 2;
        const newHumanUs = await contract.methods
          .__update_user_state_from_move(isFirstTwo, us, moveData, humanPlayerId)
          .simulate({ from: address });

        // Step 4: Update shared game state
        const newGs = await contract.methods
          .__update_game_state_from_move(gs, userOutputState, humanPlayerId)
          .simulate({ from: address });

        // Step 5: Bot consumes human's move
        const botUs = botUserStateRef.current;
        if (botUs) {
          const newBotUs = await contract.methods
            .__consume_opponent_move(newGs, botUs, botPlayerId)
            .simulate({ from: address });

          botUserStateRef.current = newBotUs;

          // Update bot's belief: if human captured a bot piece, remove it
          if (capturedId !== PIECE_IDS.EMPTY && Number(targetPiece.player_id) === botPlayerId) {
            // Bot sees that its piece was captured
          }
          // If the bot sees the human captured one of its own pieces on a visible square,
          // the belief state is updated by observing what's on the board
          if (beliefRef.current && capturedId !== PIECE_IDS.EMPTY && Number(targetPiece.player_id) === humanPlayerId) {
            // Human piece was captured — this would be the bot capturing, handled elsewhere
          }
        }

        syncRefs(newGs, newHumanUs);

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
        await executeBotMove(newGs, newHumanUs);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Move failed";
        setError(msg);
        console.error("Human move error:", e);
        moveInProgressRef.current = false;
      }
    },
    [address, syncRefs, executeBotMove]
  );

  // ─── Return to lobby ──────────────────────────────────────────────

  const returnToLobby = useCallback(() => {
    setPhase("lobby");
    setGameState(null);
    setUserState(null);
    gameStateRef.current = null;
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
