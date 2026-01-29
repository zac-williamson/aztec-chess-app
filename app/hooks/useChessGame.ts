import { useState, useRef, useCallback, useEffect } from "react";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
  type MoveEvent,
  type NewGame,
} from "../artifacts/FogOfWarChess";
import { getDecodedPublicEvents } from "@aztec/aztec.js/events";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import type { GamePhase, PlayerRole } from "../lib/types";
import { PIECE_IDS } from "../lib/types";
import { computeClientVision } from "../lib/chessUtils";

interface UseChessGameReturn {
  phase: GamePhase;
  role: PlayerRole | null;
  gameId: number | null;
  contractAddress: string | null;
  gameState: any;
  userState: any;
  confirmedEmptySquares: Set<number>;
  isMyTurn: boolean;
  statusMessage: string;
  error: string | null;
  deployAndCreateGame: (password: number) => Promise<void>;
  joinGame: (
    contractAddr: string,
    gameId: number,
    password: number
  ) => Promise<void>;
  makeMove: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) => Promise<void>;
  startPlaying: () => void;
}

export function useChessGame(
  wallet: any,
  address: AztecAddress | null,
  node: any
): UseChessGameReturn {
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [role, setRole] = useState<PlayerRole | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [userState, setUserState] = useState<any>(null);
  const [confirmedEmptySquares, setConfirmedEmptySquares] = useState<Set<number>>(new Set());
  const [moveCount, setMoveCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Waiting...");

  const contractRef = useRef<FogOfWarChessContract | null>(null);
  const lastBlockRef = useRef<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gameStateRef = useRef<any>(null);
  const userStateRef = useRef<any>(null);

  // Store player's own secrets (generated randomly)
  const encryptSecretRef = useRef<Fr | null>(null);
  const maskSecretRef = useRef<Fr | null>(null);
  // Store opponent's secret hashes (fetched from events/storage)
  const opponentSecretHashesRef = useRef<{ encrypt: Fr; mask: Fr } | null>(null);

  // Keep refs in sync with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    userStateRef.current = userState;
  }, [userState]);

  // Compute whose turn it is
  const isMyTurn =
    role !== null && gameState !== null
      ? role === "white"
        ? Number(gameState.move_count) % 2 === 0
        : Number(gameState.move_count) % 2 === 1
      : false;

  // ─── Deploy contract & create game (White player) ───

  const deployAndCreateGame = useCallback(
    async (password: number) => {
      if (!wallet || !address) return;
      setError(null);

      try {
        // Deploy contract
        setPhase("deploying");
        setStatusMessage("Deploying contract...");
        const contract = await FogOfWarChessContract.deploy(wallet)
          .send({ from: address })
          .deployed();
        contractRef.current = contract;
        const addr = contract.address.toString();
        setContractAddress(addr);

        // Generate random secrets for white
        const encryptSecret = Fr.random();
        const maskSecret = Fr.random();
        encryptSecretRef.current = encryptSecret;
        maskSecretRef.current = maskSecret;

        // Initialize states
        setStatusMessage("Initializing game state...");
        let gs = await contract.methods
          .__empty_game_state()
          .simulate({ from: address });
        const ws = await contract.methods
          .__empty_white_state()
          .simulate({ from: address });

        // Set secrets in user state
        ws.encrypt_secret = encryptSecret;
        ws.mask_secret = maskSecret;
      console.log('old white state encrypt mask secrets = ', ws.encrypt_secret, ws.mask_secret);

        // Commit white's secrets to game state (black's will be added after they join)
        gs = await contract.methods
          .__commit_to_user_secrets(gs, encryptSecret, maskSecret, 0)
          .simulate({ from: address });

        // Create game on-chain
        setPhase("creating");
        setStatusMessage("Creating game on-chain...");
        const receipt = await contract.methods
          .create_game_private(encryptSecret, maskSecret, password)
          .send({ from: address })
          .wait();

        // Parse NewGame event to get game_id and our secret hashes
        const newGameEvents = await getDecodedPublicEvents<NewGame>(
          node,
          FogOfWarChessContract.events.NewGame,
          receipt.blockNumber!,
          receipt.blockNumber! + 1
        );

        const gid =
          newGameEvents.length > 0 ? Number(newGameEvents[0].game_id) : 0;

        setGameId(gid);
        setRole("white");
        setGameState(gs);
        setUserState(ws);
        lastBlockRef.current = receipt.blockNumber!;
        setPhase("waiting_opponent");
        setStatusMessage(
          `Game created! ID: ${gid}. Share contract address and game ID with opponent.`
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create game";
        setError(msg);
        setPhase("lobby");
        console.error("Create game error:", e);
      }
    },
    [wallet, address, node]
  );

  // ─── Join existing game (Black player) ───

  const joinGame = useCallback(
    async (contractAddr: string, targetGameId: number, password: number) => {
      if (!wallet || !address) return;
      setError(null);

      try {
        setPhase("joining");
        setStatusMessage("Connecting to contract...");

        // Connect to existing contract
        const { AztecAddress: AztecAddr } = await import(
          "@aztec/aztec.js/addresses"
        );
        const contractAztecAddr = AztecAddr.fromString(contractAddr);

        // Fetch the contract instance from the Aztec node and register it
        // with this wallet's PXE (each browser tab has its own PXE)
        setStatusMessage("Registering contract with local PXE...");
        const contractInstance = await node.getContract(contractAztecAddr);
        if (!contractInstance) {
          throw new Error(
            `Contract not found on-chain at address ${contractAddr}. Has White deployed and created a game?`
          );
        }
        await wallet.registerContract(
          contractInstance,
          FogOfWarChessContractArtifact
        );

        const contract = FogOfWarChessContract.at(
          contractAztecAddr,
          wallet
        );
        contractRef.current = contract;
        setContractAddress(contractAddr);

        // Generate random secrets for black
        const encryptSecret = Fr.random();
        const maskSecret = Fr.random();
        encryptSecretRef.current = encryptSecret;
        maskSecretRef.current = maskSecret;

        // Fetch white's secret hashes using the contract method
        setStatusMessage("Fetching game info from chain...");
        const secretHashes = await contract.methods
          .__get_game_secret_hashes(targetGameId)
          .simulate({ from: address });
        console.log("secret hashes: ", secretHashes, secretHashes[0]);
        // Check if game exists (white's hashes should be non-zero)
        // Values from simulate() are bigints, not Fr objects
        if (BigInt(secretHashes[0]) === 0n && BigInt(secretHashes[1]) === 0n) {
          throw new Error(
            `Game ${targetGameId} not found. Has White created the game?`
          );
        }

        // Extract white's secret hashes
        const whiteSecretHashes = [
          secretHashes[0], // white encrypt_secret_hash
          secretHashes[1], // white mask_secret_hash
        ];

        // Initialize states
        setStatusMessage("Initializing game state...");
        let gs = await contract.methods
          .__empty_game_state()
          .simulate({ from: address });
        const bs = await contract.methods
          .__empty_black_state()
          .simulate({ from: address });

        // Set secrets in user state
        bs.encrypt_secret = encryptSecret;
        bs.mask_secret = maskSecret;

        // Commit both players' secrets to game state
        // Use white's secret hashes (we don't know their actual secrets)
        gs.mpc_state.user_encrypt_secret_hashes[0] = whiteSecretHashes[0];
        gs.mpc_state.user_mask_secret_hashes[0] = whiteSecretHashes[1];
        // Commit black's secrets
        gs = await contract.methods
          .__commit_to_user_secrets(gs, encryptSecret, maskSecret, 1)
          .simulate({ from: address });

        // Join game on-chain
        setStatusMessage("Joining game on-chain...");
        const receipt = await contract.methods
          .join_game_private(
            targetGameId,
            encryptSecret,
            maskSecret,
            whiteSecretHashes,
            password
          )
          .send({ from: address })
          .wait();

        setGameId(targetGameId);
        setRole("black");
        setGameState(gs);
        setUserState(bs);
        lastBlockRef.current = receipt.blockNumber!;
        setPhase("playing");
        setStatusMessage("Game joined! Waiting for White to move...");
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to join game";
        setError(msg);
        setPhase("lobby");
        console.error("Join game error:", e);
      }
    },
    [wallet, address, node]
  );

  // ─── White starts playing (after black joins) ───

  const startPlaying = useCallback(async () => {
    if (!node || !contractRef.current || !address || gameId === null) {
      setPhase("playing");
      setStatusMessage("Your turn! Select a piece to move.");
      return;
    }

    try {
      setStatusMessage("Fetching opponent's secret hashes...");

      const contract = contractRef.current;

      // Use the contract method to get secret hashes
      const secretHashes = await contract.methods
        .__get_game_secret_hashes(gameId)
        .simulate({ from: address });

      // Check if black has joined (black's hashes should be non-zero)
      // Values from simulate() are bigints, not Fr objects
      if (BigInt(secretHashes[2]) === 0n) {
        setStatusMessage("Waiting for opponent to join...");
        return;
      }

      // Store black's secret hashes
      opponentSecretHashesRef.current = {
        encrypt: secretHashes[2],
        mask: secretHashes[3],
      };

      console.log('secret hashes = ', secretHashes);

      // Rebuild game state from scratch to match what the contract computed
      // when black joined. The contract creates a fresh empty_game_state()
      // and sets both players' hashes, so we must do the same.
      setStatusMessage("Initializing game state...");
      let gs = await contract.methods
        .__empty_game_state()
        .simulate({ from: address });

      // Set white's secret hashes (our own)
      gs.mpc_state.user_encrypt_secret_hashes[0] = secretHashes[0];
      gs.mpc_state.user_mask_secret_hashes[0] = secretHashes[1];
      // Set black's secret hashes
      gs.mpc_state.user_encrypt_secret_hashes[1] = secretHashes[2];
      gs.mpc_state.user_mask_secret_hashes[1] = secretHashes[3];

      // Also rebuild user state with our secrets
      const ws = await contract.methods
        .__empty_white_state()
        .simulate({ from: address });
      ws.encrypt_secret = encryptSecretRef.current;
      ws.mask_secret = maskSecretRef.current;

      console.log('new white state encrypt mask secrets = ', ws.encrypt_secret, ws.mask_secret);
      setGameState({ ...gs });
      setUserState({ ...ws });

      setPhase("playing");
      setStatusMessage("Your turn! Select a piece to move.");
    } catch (e) {
      console.error("Error fetching opponent secrets:", e);
      // Fall back to just starting
      setPhase("playing");
      setStatusMessage("Your turn! Select a piece to move.");
    }
  }, [address, gameId]);

  // ─── Make a move ───

  const makeMove = useCallback(
    async (
      fromRow: number,
      fromCol: number,
      toRow: number,
      toCol: number
    ) => {
      if (!wallet || !address || !contractRef.current || !role) return;
      const contract = contractRef.current;
      const gs = gameStateRef.current;
      const us = userStateRef.current;
      if (!gs || !us) return;

      setError(null);
      setPhase("proving");
      setStatusMessage("Generating proof for your move...");

      try {
        const playerId = role === "white" ? 0 : 1;

        // Import coordinate conversion
        const { rowColToNoirXY } = await import("../lib/chessUtils");
        const from = rowColToNoirXY(fromRow, fromCol, role);
        const to = rowColToNoirXY(toRow, toCol, role);

        // Create move data
        const moveData = await contract.methods
          .__create_move(from.x, from.y, to.x, to.y)
          .simulate({ from: address });

        // Send move transaction
        let receipt;
        if (role === "white") {
          receipt = await contract.methods
            .make_move_white_private(gameId!, gs, us, moveData)
            .send({ from: address })
            .wait();
        } else {
          receipt = await contract.methods
            .make_move_black_private(gameId!, gs, us, moveData)
            .send({ from: address })
            .wait();
        }

        // Get MoveEvent from receipt
        const events = await getDecodedPublicEvents<MoveEvent>(
          node,
          FogOfWarChessContract.events.MoveEvent,
          receipt.blockNumber!,
          receipt.blockNumber! + 1
        );

        if (events.length === 0) {
          throw new Error("No MoveEvent found in receipt");
        }
        const userOutputState = events[0].state;

        // Update own user state after the move
        const isFirstTwo = Number(gs.move_count) < 2;
        const newUserState = await contract.methods
          .__update_user_state_from_move(isFirstTwo, us, moveData, playerId)
          .simulate({ from: address });

        console.log("After __update_user_state_from_move:");
      console.log("newUserState.visible_squares:", newUserState.visible_squares);
      console.log("newUserState.game_state:", newUserState.game_state);

        // Update shared game state
        const newGameState = await contract.methods
          .__update_game_state_from_move(gs, userOutputState, playerId)
          .simulate({ from: address });

        // Spread to create new references — .simulate() may mutate in place,
        // and React skips re-render if the reference is unchanged.
        setUserState({ ...newUserState });
        setGameState({ ...newGameState });
        setMoveCount((prev) => prev + 1);
        lastBlockRef.current = receipt.blockNumber!;

        // Check if game ended - game_ended might be a BigInt/Field
        const gameEnded = newGameState.game_ended !== 0n && newGameState.game_ended !== 0;
        console.log("Game ended check after move:", { raw: newGameState.game_ended, parsed: gameEnded });

        // Also check if opponent's king is still on the board (failsafe)
        const opponentPlayerId = playerId === 0 ? 1 : 0;
        const opponentKingExists = newUserState.game_state.some(
          (sq: any) => Number(sq.id) === PIECE_IDS.KING && Number(sq.player_id) === opponentPlayerId
        );
        console.log("Opponent king exists:", opponentKingExists);

        if (gameEnded || !opponentKingExists) {
          setPhase("game_over");
          setStatusMessage("Game over! You captured the opponent's king!");
        } else {
          setPhase("playing");
          setStatusMessage("Move submitted. Waiting for opponent...");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Move failed";
        setError(msg);
        setPhase("playing");
        console.error("Move error:", e);
      }
    },
    [wallet, address, node, role, gameId]
  );

  // ─── Poll for opponent moves ───

  const pollForOpponentMove = useCallback(async () => {
    if (!node || !contractRef.current || !role || !address) return;
    const gs = gameStateRef.current;
    const us = userStateRef.current;
    if (!gs || !us) return;

    try {
      const currentBlock = await node.getBlockNumber();
      if (currentBlock <= lastBlockRef.current) return;

      const events = await getDecodedPublicEvents<MoveEvent>(
        node,
        FogOfWarChessContract.events.MoveEvent,
        lastBlockRef.current + 1,
        currentBlock + 1
      );

      if (events.length === 0) {
        lastBlockRef.current = currentBlock;
        return;
      }

      // Process the latest opponent move
      const opponentOutputState = events[events.length - 1].state;
      const opponentPlayerId = role === "white" ? 1 : 0;
      const myPlayerId = role === "white" ? 0 : 1;
      const contract = contractRef.current;

      // Update game state from opponent's move
      const newGameState = await contract.methods
        .__update_game_state_from_move(gs, opponentOutputState, opponentPlayerId)
        .simulate({ from: address });

      // Consume opponent's move to update own vision
      const newUserState = await contract.methods
        .__consume_opponent_move(newGameState, us, myPlayerId)
        .simulate({ from: address });

      console.log("After __consume_opponent_move:");
      console.log("newUserState.visible_squares:", newUserState.visible_squares);
      console.log("newUserState.game_state:", newUserState.game_state);

      // Calculate client vision and update confirmed empty squares
      // All squares in current vision that don't have a piece are confirmed empty
      const clientVision = computeClientVision(newUserState.game_state, myPlayerId);
      const newConfirmedEmpty = new Set(confirmedEmptySquares);
      for (let i = 0; i < 64; i++) {
        if (clientVision[i] && Number(newUserState.game_state[i].id) === PIECE_IDS.EMPTY) {
          newConfirmedEmpty.add(i);
        }
      }
      setConfirmedEmptySquares(newConfirmedEmpty);

      // Spread to create new references for React state change detection.
      setGameState({ ...newGameState });
      setUserState({ ...newUserState });
      setMoveCount((prev) => prev + 1);
      lastBlockRef.current = currentBlock;

      // Check if game ended - game_ended might be a BigInt/Field
      const gameEnded = newGameState.game_ended !== 0n && newGameState.game_ended !== 0;
      console.log("Game ended check:", { raw: newGameState.game_ended, parsed: gameEnded });

      // Also check if our king is still on the board (failsafe)
      const myKingExists = newUserState.game_state.some(
        (sq: any) => Number(sq.id) === PIECE_IDS.KING && Number(sq.player_id) === myPlayerId
      );
      console.log("My king exists:", myKingExists);

      if (gameEnded || !myKingExists) {
        setPhase("game_over");
        setStatusMessage("Game over! Your king was captured.");
      } else {
        setStatusMessage("Your turn! Select a piece to move.");
      }
    } catch (e) {
      console.error("Poll error:", e);
    }
  }, [node, role, address, confirmedEmptySquares]);

  // Start/stop polling based on phase and turn
  useEffect(() => {
    // Poll when it's not our turn and we're in playing phase
    const shouldPoll = phase === "playing" && !isMyTurn;

    // Also poll when waiting for opponent to join
    const waitingForOpponent = phase === "waiting_opponent";

    if (shouldPoll || waitingForOpponent) {
      pollingRef.current = setInterval(() => {
        if (waitingForOpponent) {
          // Just check if opponent joined — for now, white manually starts
          // (Could poll game_hashes storage, but that requires public storage reads)
        } else {
          pollForOpponentMove();
        }
      }, 5000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [phase, isMyTurn, pollForOpponentMove]);

  return {
    phase,
    role,
    gameId,
    contractAddress,
    gameState,
    userState,
    confirmedEmptySquares,
    isMyTurn,
    statusMessage,
    error,
    deployAndCreateGame,
    joinGame,
    makeMove,
    startPlaying,
  };
}
