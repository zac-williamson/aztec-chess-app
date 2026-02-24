import { useState, useRef, useCallback, useEffect } from "react";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
  type MoveEvent,
} from "../artifacts/FogOfWarChess";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import { decodeFromAbi, EventSelector } from "@aztec/aztec.js/abi";
import type { GamePhase, PlayerRole, OpenGame, SavedGame, TxStep, QueuedProof } from "../lib/types";
import { PIECE_IDS } from "../lib/types";
import environmentConfig from "../config/environment.json";
import devnetConfig from "../config/networks/devnet.json";
import localConfig from "../config/networks/local.json";

const networkConfig = environmentConfig.network === "local" ? localConfig : devnetConfig;

const SAVED_GAMES_KEY = "aztec-chess-saved-games";

// Hash a password string into a Field element using SHA-256.
// This is layer 1 of a two-layer hashing scheme:
//   1. Client-side: SHA-256(password) → Fr (this function)
//   2. On-chain: Poseidon2(Fr) for storage in contract state
// The client sends the SHA-256 hash; the contract Poseidon-hashes it again
// before comparing against the stored value, so the raw password never
// appears on-chain or in calldata.
async function hashPassword(password: string): Promise<Fr> {
  if (!password) return Fr.ZERO;
  const data = new TextEncoder().encode(password);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  // Take first 31 bytes to fit within the Fr field modulus
  let value = 0n;
  for (let i = 0; i < 31; i++) {
    value = (value << 8n) | BigInt(hash[i]);
  }
  return new Fr(value);
}

// Helper to extract game_id from NewGame event logs
// Workaround for Aztec.js event decoder mismatch with array fields
async function getGameIdFromLogs(
  node: any,
  fromBlock: number,
  toBlock: number,
  eventSelector: string
): Promise<number | null> {
  try {
    const { logs } = await node.getPublicLogs({
      fromBlock,
      toBlock,
    });

    for (const log of logs) {
      const fields = log.log.getEmittedFields();
      // Event selector is at the end of the fields array
      const selectorField = fields[fields.length - 1];
      const selectorHex = selectorField.toString(16).padStart(8, "0");

      if (selectorHex.endsWith(eventSelector.replace("0x", ""))) {
        // game_id is the first field
        return Number(fields[0].toBigInt());
      }
    }
    return null;
  } catch (e) {
    console.error("Error extracting game_id from logs:", e);
    return null;
  }
}

// Custom event decoder that doesn't validate field count
// Workaround for Aztec.js event decoder mismatch with nested arrays/structs
async function getDecodedEventsNoValidation<T>(
  node: any,
  eventMetadataDef: { abiType: any; eventSelector: any; fieldNames: string[] },
  from: number,
  limit: number
): Promise<T[]> {
  const { logs } = await node.getPublicLogs({
    fromBlock: from,
    toBlock: from + limit,
  });

  const decodedEvents: T[] = [];

  for (const log of logs) {
    const logFields = log.log.getEmittedFields();
    // Event selector is the last field
    const selectorField = logFields[logFields.length - 1];

    if (
      EventSelector.fromField(selectorField).equals(
        eventMetadataDef.eventSelector
      )
    ) {
      try {
        const decoded = decodeFromAbi(
          [eventMetadataDef.abiType],
          log.log.fields
        );
        decodedEvents.push(decoded as T);
      } catch (e) {
        console.error("Error decoding event:", e);
      }
    }
  }

  return decodedEvents;
}
import { computeClientVision } from "../lib/chessUtils";
import contractConfig from "../config/contract-address.json";
import type { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { NO_WAIT } from "@aztec/aztec.js/contracts";
import { waitForTx } from "@aztec/aztec.js/node";

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
  openGames: OpenGame[];
  isLoadingGames: boolean;
  opponentJoined: boolean;
  createdGamePassword: string;
  savedGames: SavedGame[];
  myElo: number;
  opponentElo: number;
  txStep: TxStep | null;
  pendingProofCount: number;
  createGame: (password: string) => Promise<void>;
  joinGame: (
    gameId: number,
    password: string
  ) => Promise<void>;
  resumeGame: (savedGame: SavedGame) => Promise<void>;
  deleteSavedGame: (gameId: number) => void;
  makeMove: (
    fromRow: number,
    fromCol: number,
    toRow: number,
    toCol: number
  ) => Promise<void>;
  fetchOpenGames: () => Promise<void>;
  setRole: (role: PlayerRole) => void;
  returnToLobby: () => void;
  // Relay integration
  handleRelayMove: (msg: { moveNumber: number; userOutputState: any; gameEnded: boolean }) => Promise<void>;
  setRelaySendMove: (fn: ((moveNumber: number, userOutputState: any, gameEnded: boolean) => void) | null) => void;
  setRelaySendMoveProven: (fn: ((moveNumber: number, blockNumber: number) => void) | null) => void;
  setRelaySendMoveFailed: (fn: ((moveNumber: number, reason: string) => void) | null) => void;
  setRelayConnected: (connected: boolean) => void;
  handlePeerMoveProven: (moveNumber: number) => void;
}

export function useChessGame(
  wallet: any,
  address: AztecAddress | null,
  node: any,
  feePaymentMethod: SponsoredFeePaymentMethod | null
): UseChessGameReturn {
  const [phase, setPhase] = useState<GamePhase>("lobby");
  const [role, setRole] = useState<PlayerRole | null>(null);
  const [gameId, setGameId] = useState<number | null>(null);
  const [contractAddress, setContractAddress] = useState<string | null>(null);
  const [gameState, setGameState] = useState<any>(null);
  const [userState, setUserState] = useState<any>(null);
  const [confirmedEmptySquares, setConfirmedEmptySquares] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Waiting...");
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [createdGamePassword, setCreatedGamePassword] = useState("");
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [myElo, setMyElo] = useState<number>(1200);
  const [opponentElo, setOpponentElo] = useState<number>(1200);
  const [txStep, setTxStep] = useState<TxStep | null>(null);
  const [proofQueue, setProofQueue] = useState<QueuedProof[]>([]);
  const [pendingProofCount, setPendingProofCount] = useState(0);

  const contractRef = useRef<FogOfWarChessContract | null>(null);
  const lastBlockRef = useRef<number>(0);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const gameStateRef = useRef<any>(null);
  const userStateRef = useRef<any>(null);
  const confirmedEmptySquaresRef = useRef<Set<number>>(new Set());

  const proofInProgressRef = useRef(false);
  const proofQueueRef = useRef<QueuedProof[]>([]);
  const lastConfirmedMoveRef = useRef<number>(0);
  // Tracks the move_count that the on-chain game_hash corresponds to.
  // A proof for move #N can only be submitted when lastProvenMoveRef >= N,
  // because the contract asserts game_hash == initial_hash.
  const lastProvenMoveRef = useRef<number>(0);
  const [lastProvenMove, setLastProvenMove] = useState(0);
  // Tracks how many on-chain move events the poller has seen.
  // Separate from lastProvenMoveRef (which gates proof submission) so that
  // MOVE_PROVEN relay messages don't corrupt the poller's event counting.
  const lastPolledChainMoveCountRef = useRef<number>(0);
  // Relay callbacks refs (set by App.tsx via setter)
  const relaySendMoveRef = useRef<((moveNumber: number, userOutputState: any, gameEnded: boolean) => void) | null>(null);
  const relaySendMoveProvenRef = useRef<((moveNumber: number, blockNumber: number) => void) | null>(null);
  const relaySendMoveFailedRef = useRef<((moveNumber: number, reason: string) => void) | null>(null);
  const relayConnectedRef = useRef(false);

  // Store player's own secrets (generated randomly)
  const encryptSecretRef = useRef<Fr | null>(null);
  const maskSecretRef = useRef<Fr | null>(null);
  // Store opponent's secret hashes (fetched from events/storage)
  const opponentSecretHashesRef = useRef<{ encrypt: Fr; mask: Fr } | null>(null);
  // Flag to skip auto-save when resuming (prevents state conflicts)
  // Note: isResumingRef reserved for future use in auto-save logic

  // ─── ELO Rating helpers ───

  const fetchPlayerElo = useCallback(async (
    contract: FogOfWarChessContract,
    playerAddress: any,
    fromAddress: AztecAddress
  ): Promise<number> => {
    try {
      const eloResult = await contract.methods
        .__get_elo_rating(playerAddress)
        .simulate({ from: fromAddress });
      return Number(eloResult) || 1200;
    } catch (e) {
      console.error("Failed to fetch ELO rating:", e);
      return 1200; // Default ELO
    }
  }, []);

  const fetchGamePlayers = useCallback(async (
    contract: FogOfWarChessContract,
    gId: number,
    fromAddress: AztecAddress
  ): Promise<{ white: any; black: any } | null> => {
    try {
      const players = await contract.methods
        .__get_game_players(gId)
        .simulate({ from: fromAddress });
      return {
        white: players[0],
        black: players[1],
      };
    } catch (e) {
      console.error("Failed to fetch game players:", e);
      return null;
    }
  }, []);

  // ─── LocalStorage helpers ───
  // Only store minimal data - replay from chain to get current state

  const loadSavedGames = useCallback((skipFilter = false): SavedGame[] => {
    try {
      const stored = localStorage.getItem(SAVED_GAMES_KEY);
      if (stored) {
        const allGames: SavedGame[] = JSON.parse(stored);

        if (skipFilter) {
          return allGames;
        }

        // Filter by current contract address and player address
        const currentContract = contractConfig.contractAddress;
        const playerAddr = address?.toString();

        const filtered = allGames.filter(g => {
          const matchesContract = g.contractAddress === currentContract;
          const matchesPlayer = !playerAddr || g.playerAddress === playerAddr;
          return matchesContract && matchesPlayer;
        });

        console.log("Loaded saved games:", filtered.length, "of", allGames.length, "for player:", playerAddr?.slice(0, 10));
        return filtered;
      }
    } catch (e) {
      console.error("Failed to load saved games:", e);
    }
    return [];
  }, [address]);

  const saveSavedGames = useCallback((games: SavedGame[]) => {
    try {
      localStorage.setItem(SAVED_GAMES_KEY, JSON.stringify(games));
      setSavedGames(games);
    } catch (e) {
      console.error("Failed to save games:", e);
    }
  }, []);

  const saveGameToStorage = useCallback((
    gId: number,
    r: PlayerRole,
    startBlock: number
  ) => {
    if (!address) return;

    const playerAddr = address.toString();
    const savedGame: SavedGame = {
      gameId: gId,
      role: r,
      contractAddress: contractConfig.contractAddress,
      playerAddress: playerAddr,
      encryptSecret: encryptSecretRef.current?.toString() || "",
      maskSecret: maskSecretRef.current?.toString() || "",
      startBlock,
      savedAt: Date.now(),
    };

    console.log("Saving game to localStorage:", savedGame.gameId, "role:", r);
    const allGames = loadSavedGames(true);
    const filtered = allGames.filter(g => !(g.gameId === gId && g.playerAddress === playerAddr));
    saveSavedGames([savedGame, ...filtered]);
  }, [address, loadSavedGames, saveSavedGames]);

  const deleteSavedGame = useCallback((targetGameId: number) => {
    if (!address) return;
    const playerAddr = address.toString();
    // Remove from the full (unfiltered) list and persist
    const allGames = loadSavedGames(true);
    const remaining = allGames.filter(g => !(g.gameId === targetGameId && g.playerAddress === playerAddr));
    try {
      localStorage.setItem(SAVED_GAMES_KEY, JSON.stringify(remaining));
    } catch (e) {
      console.error("Failed to save games:", e);
    }
    // Update React state with the filtered view for the current player
    setSavedGames(loadSavedGames());
  }, [address, loadSavedGames]);

  // Load saved games on mount
  useEffect(() => {
    setSavedGames(loadSavedGames());
  }, [loadSavedGames]);

  // Keep refs in sync with state
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);
  useEffect(() => {
    userStateRef.current = userState;
  }, [userState]);
  useEffect(() => {
    confirmedEmptySquaresRef.current = confirmedEmptySquares;
  }, [confirmedEmptySquares]);

  // Compute whose turn it is (black must wait for opponent to join since black is the creator)
  // White's turn when move_count is even, Black's turn when move_count is odd
  // White is now the joiner, so white can move immediately after joining
  const isMyTurn =
    role !== null && gameState !== null
      ? role === "white"
        ? Number(gameState.move_count) % 2 === 0  // White moves on even (joiner moves immediately)
        : opponentJoined && Number(gameState.move_count) % 2 === 1  // Black must wait for white to join
      : false;

  // ─── Create game on pre-deployed contract (Black player - creator) ───

  const createGame = useCallback(
    async (password: string) => {
      if (!wallet || !address || !node) return;
      setError(null);

      // Check that contract address is configured
      if (!contractConfig.contractAddress) {
        setError("No contract address configured. Run 'npx tsx scripts/deploy.ts' first.");
        return;
      }

      try {
        // Connect to existing contract
        setPhase("creating");
        setTxStep("building");
        setStatusMessage("Connecting to chess contract...");

        const contractAztecAddr = AztecAddress.fromString(contractConfig.contractAddress);

        // Register contract with this wallet's PXE
        const contractInstance = await node.getContract(contractAztecAddr);
        if (!contractInstance) {
          throw new Error(
            `Contract not found at ${contractConfig.contractAddress}. Has it been deployed?`
          );
        }
        await wallet.registerContract(contractInstance, FogOfWarChessContractArtifact);

        const contract = FogOfWarChessContract.at(contractAztecAddr, wallet);
        contractRef.current = contract;
        setContractAddress(contractConfig.contractAddress);

        // Generate random secrets for black (creator is now black)
        const encryptSecret = Fr.random();
        const maskSecret = Fr.random();
        encryptSecretRef.current = encryptSecret;
        maskSecretRef.current = maskSecret;

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

        // Commit black's secrets to game state (player_id 1 for black)
        // After creation: [password_hash, 0, black_encrypt, black_mask]
        gs = await contract.methods
          .__commit_to_user_secrets(gs, encryptSecret, maskSecret, 1)
          .simulate({ from: address });

        // Create game on-chain
        if (!feePaymentMethod) {
          throw new Error("Fee payment method not initialized. Please wait for wallet to connect.");
        }
        const passwordField = await hashPassword(password);
        console.log("Creating game with password:", password, "passwordField:", passwordField.toString());

        setTxStep("proving");
        setStatusMessage("Generating zero-knowledge proof...");
        const txHash = await contract.methods
          .create_game_private(encryptSecret, maskSecret, passwordField)
          .send({ from: address, fee: { paymentMethod: feePaymentMethod }, wait: NO_WAIT });

        setTxStep("confirming");
        setStatusMessage("Waiting for transaction confirmation...");
        const receipt = await waitForTx(node, txHash);

        setTxStep(null);

        // Parse NewGame event to get game_id
        // Using custom helper due to Aztec.js event decoder mismatch with array fields
        const gid = await getGameIdFromLogs(
          node,
          receipt.blockNumber!,
          receipt.blockNumber! + 1,
          FogOfWarChessContract.events.NewGame.eventSelector.toString()
        ) ?? 0;

        setGameId(gid);
        setRole("black");
        setGameState(gs);
        setUserState(bs);
        lastBlockRef.current = receipt.blockNumber!;
        lastPolledChainMoveCountRef.current = 0;
        setCreatedGamePassword(password);
        setOpponentJoined(false);
        setPhase("playing");
        setStatusMessage(
          `Game #${gid} created. Waiting for opponent to join...`
        );

        // Fetch our ELO rating
        const playerElo = await fetchPlayerElo(contract, address, address);
        setMyElo(playerElo);

        // Save game to localStorage with minimal data for future resume
        saveGameToStorage(gid, "black", receipt.blockNumber!);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to create game";
        setError(msg);
        setPhase("lobby");
        setTxStep(null);
        console.error("Create game error:", e);
      }
    },
    [wallet, address, node, feePaymentMethod, fetchPlayerElo, saveGameToStorage]
  );

  // ─── Join existing game (White player - joiner) ───

  const joinGame = useCallback(
    async (targetGameId: number, password: string) => {
      if (!wallet || !address) return;
      setError(null);

      // Check that contract address is configured
      if (!contractConfig.contractAddress) {
        setError("No contract address configured. Run 'npx tsx scripts/deploy.ts' first.");
        return;
      }

      try {
        setPhase("joining");
        setTxStep("building");
        setStatusMessage("Connecting to contract...");

        // Connect to existing contract
        const contractAztecAddr = AztecAddress.fromString(contractConfig.contractAddress);

        // Fetch the contract instance from the Aztec node and register it
        // with this wallet's PXE (each browser tab has its own PXE)
        setStatusMessage("Registering contract with local PXE...");
        const contractInstance = await node.getContract(contractAztecAddr);
        if (!contractInstance) {
          throw new Error(
            `Contract not found at ${contractConfig.contractAddress}. Has it been deployed?`
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
        setContractAddress(contractConfig.contractAddress);

        // Generate random secrets for white (joiner is now white)
        const encryptSecret = Fr.random();
        const maskSecret = Fr.random();
        encryptSecretRef.current = encryptSecret;
        maskSecretRef.current = maskSecret;

        // Fetch black's (creator's) secret hashes using the contract method
        // After creation: [password_hash, 0, black_encrypt, black_mask]
        setStatusMessage("Fetching game info from chain...");
        const secretHashes = await contract.methods
          .__get_game_secret_hashes(targetGameId)
          .simulate({ from: address });
        console.log("secret hashes: ", secretHashes, secretHashes[0]);

        // Check if game exists (black's hashes at [2] and [3] should be non-zero)
        // Values from simulate() are bigints, not Fr objects
        if (BigInt(secretHashes[2]) === 0n && BigInt(secretHashes[3]) === 0n) {
          throw new Error(
            `Game ${targetGameId} not found. Has Black created the game?`
          );
        }

        // Extract black's secret hashes (creator's hashes are at indices 2 and 3)
        const blackSecretHashes = [
          secretHashes[2], // black encrypt_secret_hash
          secretHashes[3], // black mask_secret_hash
        ];

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

        // Commit both players' secrets to game state
        // Set black's secret hashes (we don't know their actual secrets)
        gs.mpc_state.user_encrypt_secret_hashes[1] = blackSecretHashes[0];
        gs.mpc_state.user_mask_secret_hashes[1] = blackSecretHashes[1];
        // Commit white's secrets (player_id 0 for white)
        gs = await contract.methods
          .__commit_to_user_secrets(gs, encryptSecret, maskSecret, 0)
          .simulate({ from: address });

        // Join game on-chain
        if (!feePaymentMethod) {
          throw new Error("Fee payment method not initialized. Please wait for wallet to connect.");
        }
        const passwordField = await hashPassword(password);
        console.log("Joining game with password:", password, "passwordField:", passwordField.toString());

        setTxStep("proving");
        setStatusMessage("Generating zero-knowledge proof...");
        const txHash = await contract.methods
          .join_game_private(
            targetGameId,
            encryptSecret,
            maskSecret,
            blackSecretHashes,
            passwordField
          )
          .send({ from: address, fee: { paymentMethod: feePaymentMethod }, wait: NO_WAIT });

        setTxStep("confirming");
        setStatusMessage("Waiting for transaction confirmation...");
        const receipt = await waitForTx(node, txHash);

        setTxStep(null);
        setGameId(targetGameId);
        setRole("white");
        setGameState(gs);
        setUserState(ws);
        lastBlockRef.current = receipt.blockNumber ?? 0;
        lastPolledChainMoveCountRef.current = 0;
        setOpponentJoined(true); // White joining means both players are present
        setPhase("playing");
        setStatusMessage("Game joined! Your turn to move.");

        // Fetch ELO ratings for both players
        const myEloValue = await fetchPlayerElo(contract, address, address);
        setMyElo(myEloValue);

        const players = await fetchGamePlayers(contract, targetGameId, address);
        if (players?.black) {
          const oppElo = await fetchPlayerElo(contract, players.black, address);
          setOpponentElo(oppElo);
        }

        // Save game to localStorage with minimal data for future resume
        saveGameToStorage(targetGameId, "white", receipt.blockNumber ?? 0);
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to join game";
        setError(msg);
        setPhase("lobby");
        setTxStep(null);
        console.error("Join game error:", e);
      }
    },
    [wallet, address, node, feePaymentMethod, fetchPlayerElo, fetchGamePlayers, saveGameToStorage]
  );

  // ─── Resume a saved game from LocalStorage ───
  // Replays game state from chain events instead of storing full state

  const resumeGame = useCallback(
    async (savedGame: SavedGame) => {
      console.log("resumeGame called with:", savedGame.gameId, "role:", savedGame.role);

      if (!wallet || !address || !node) {
        console.log("resumeGame: missing wallet/address/node", { wallet: !!wallet, address: !!address, node: !!node });
        return;
      }
      setError(null);

      if (!contractConfig.contractAddress) {
        setError("No contract address configured.");
        return;
      }

      try {
        console.log("resumeGame: starting resume process...");
        setPhase("joining");
        setStatusMessage("Reconnecting to game...");

        const contractAztecAddr = AztecAddress.fromString(contractConfig.contractAddress);

        // Register contract with wallet
        const contractInstance = await node.getContract(contractAztecAddr);
        if (!contractInstance) {
          throw new Error("Contract not found");
        }
        await wallet.registerContract(contractInstance, FogOfWarChessContractArtifact);

        const contract = FogOfWarChessContract.at(contractAztecAddr, wallet);
        contractRef.current = contract;
        setContractAddress(contractConfig.contractAddress);

        // Restore secrets from saved game
        encryptSecretRef.current = Fr.fromString(savedGame.encryptSecret);
        maskSecretRef.current = Fr.fromString(savedGame.maskSecret);

        // Fetch current secret hashes from contract to check opponent status
        // After creation: [password_hash, 0, black_encrypt, black_mask]
        // After join: [white_encrypt, white_mask, black_encrypt, black_mask]
        setStatusMessage("Fetching game state from chain...");
        const secretHashes = await contract.methods
          .__get_game_secret_hashes(savedGame.gameId)
          .simulate({ from: address });

        // Check if opponent has joined
        // For black (creator): white joined when [1] is non-zero
        // For white (joiner): we joined, so opponent (black) is always there
        const whiteJoined = BigInt(secretHashes[1]) !== 0n;
        const opponentJoinedStatus = savedGame.role === "black" ? whiteJoined : true;
        console.log("resumeGame: whiteJoined =", whiteJoined, "opponentJoined =", opponentJoinedStatus);

        // Store opponent's secret hashes
        if (savedGame.role === "black" && whiteJoined) {
          // Black is creator, white is opponent
          opponentSecretHashesRef.current = {
            encrypt: secretHashes[0],
            mask: secretHashes[1],
          };
        } else if (savedGame.role === "white") {
          // White is joiner, black is opponent
          opponentSecretHashesRef.current = {
            encrypt: secretHashes[2],
            mask: secretHashes[3],
          };
        }

        // Initialize empty game state with secret hashes
        let gs = await contract.methods
          .__empty_game_state()
          .simulate({ from: address });

        // Set all secret hashes in game state
        // [white_encrypt, white_mask, black_encrypt, black_mask]
        if (whiteJoined) {
          gs.mpc_state.user_encrypt_secret_hashes[0] = secretHashes[0];
          gs.mpc_state.user_mask_secret_hashes[0] = secretHashes[1];
        }
        gs.mpc_state.user_encrypt_secret_hashes[1] = secretHashes[2];
        gs.mpc_state.user_mask_secret_hashes[1] = secretHashes[3];

        // Initialize user state for our role
        const isWhite = savedGame.role === "white";
        const myPlayerId = isWhite ? 0 : 1;
        let us = isWhite
          ? await contract.methods.__empty_white_state().simulate({ from: address })
          : await contract.methods.__empty_black_state().simulate({ from: address });

        us.encrypt_secret = encryptSecretRef.current;
        us.mask_secret = maskSecretRef.current;

        // Fetch all MoveEvents from startBlock to now and replay them
        setStatusMessage("Replaying game history...");
        const currentBlock = await node.getBlockNumber();
        const allGameEvents = await getDecodedEventsNoValidation<MoveEvent>(
          node,
          FogOfWarChessContract.events.MoveEvent,
          savedGame.startBlock,
          currentBlock + 1
        );
        // Filter to only events for our game
        const gameEvents = allGameEvents.filter(
          (e) => Number(e.game_id) === savedGame.gameId
        );

        console.log(`resumeGame: replaying ${gameEvents.length} moves from block ${savedGame.startBlock}`);

        // Replay each move to reconstruct state
        let currentMoveCount = 0;
        for (const event of gameEvents) {
          const playerWhoMoved = currentMoveCount % 2; // 0 = white, 1 = black

          // Update shared game state with this move
          gs = await contract.methods
            .__update_game_state_from_move(gs, event.state, playerWhoMoved)
            .simulate({ from: address });

          // Update user state based on who moved
          if (playerWhoMoved !== myPlayerId) {
            // Opponent moved - consume their revealed information
            us = await contract.methods
              .__consume_opponent_move(gs, us, myPlayerId)
              .simulate({ from: address });
          } else {
            // We moved - for historical moves without moveData, we sync from game state
            // The next opponent move will update our visibility via consume_opponent_move
            // Our pieces are tracked in gs, visibility will be recomputed below
          }

          currentMoveCount++;
        }

        // Compute confirmed empty squares from current visibility
        const clientVision = computeClientVision(us.game_state, myPlayerId);
        const newConfirmedEmpty = new Set<number>();
        for (let i = 0; i < 64; i++) {
          if (clientVision[i] && Number(us.game_state[i].id) === PIECE_IDS.EMPTY) {
            newConfirmedEmpty.add(i);
          }
        }

        // Set all state
        setGameId(savedGame.gameId);
        setRole(savedGame.role);
        setGameState({ ...gs });
        setUserState({ ...us });
        setConfirmedEmptySquares(newConfirmedEmpty);
        setOpponentJoined(opponentJoinedStatus);

        lastBlockRef.current = currentBlock;
        lastPolledChainMoveCountRef.current = currentMoveCount;

        // Determine whose turn it is
        // White (joiner) moves on even count, Black (creator) moves on odd count
        // Black must wait for white to join before their turn
        const isMyTurnNow = isWhite
          ? (currentMoveCount % 2 === 0)  // White moves immediately
          : (opponentJoinedStatus && currentMoveCount % 2 === 1);  // Black waits for white

        console.log("resumeGame: complete", {
          moveCount: currentMoveCount,
          isMyTurn: isMyTurnNow,
          opponentJoined: opponentJoinedStatus
        });

        setPhase("playing");
        if (!opponentJoinedStatus && !isWhite) {
          setStatusMessage(`Game #${savedGame.gameId} resumed. Waiting for opponent to join...`);
        } else {
          setStatusMessage(isMyTurnNow ? "Your turn!" : "Waiting for opponent...");
        }

        // Fetch ELO ratings
        const myEloValue = await fetchPlayerElo(contract, address, address);
        setMyElo(myEloValue);

        const players = await fetchGamePlayers(contract, savedGame.gameId, address);
        if (players) {
          const opponentAddr = isWhite ? players.black : players.white;
          if (opponentAddr && opponentJoinedStatus) {
            const oppElo = await fetchPlayerElo(contract, opponentAddr, address);
            setOpponentElo(oppElo);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Failed to resume game";
        setError(msg);
        setPhase("lobby");
        console.error("Resume game error:", e);
      }
    },
    [wallet, address, node, fetchPlayerElo, fetchGamePlayers]
  );

  // ─── Poll for opponent to join (black only - creator waits for white joiner) ───

  const pollForOpponentJoin = useCallback(async () => {
    if (!node || !contractRef.current || !address || gameId === null || role !== "black" || opponentJoined) {
      return;
    }

    try {
      const contract = contractRef.current;

      // Use the contract method to get secret hashes
      // After creation: [password_hash, 0, black_encrypt, black_mask]
      // After join: [white_encrypt, white_mask, black_encrypt, black_mask]
      const secretHashes = await contract.methods
        .__get_game_secret_hashes(gameId)
        .simulate({ from: address });

      // Check if white has joined (white's hashes at [0] should be non-zero and not just password_hash)
      // When white joins, [0] becomes white's encrypt hash (replacing password_hash) and [1] becomes mask hash
      if (BigInt(secretHashes[1]) === 0n) {
        // Still waiting - [1] is still 0, meaning white hasn't joined yet
        return;
      }

      console.log("Opponent joined! Secret hashes:", secretHashes);

      // Store white's secret hashes
      opponentSecretHashesRef.current = {
        encrypt: secretHashes[0],
        mask: secretHashes[1],
      };

      // Rebuild game state from scratch to match what the contract computed
      // when white joined.
      let gs = await contract.methods
        .__empty_game_state()
        .simulate({ from: address });

      // Set white's secret hashes (opponent)
      gs.mpc_state.user_encrypt_secret_hashes[0] = secretHashes[0];
      gs.mpc_state.user_mask_secret_hashes[0] = secretHashes[1];
      // Set black's secret hashes (our own)
      gs.mpc_state.user_encrypt_secret_hashes[1] = secretHashes[2];
      gs.mpc_state.user_mask_secret_hashes[1] = secretHashes[3];

      // Also rebuild user state with our secrets
      const bs = await contract.methods
        .__empty_black_state()
        .simulate({ from: address });
      bs.encrypt_secret = encryptSecretRef.current;
      bs.mask_secret = maskSecretRef.current;

      setGameState({ ...gs });
      setUserState({ ...bs });
      setOpponentJoined(true);
      setStatusMessage("Opponent joined! Waiting for White to move...");

      // Fetch opponent's ELO now that they've joined
      const players = await fetchGamePlayers(contract, gameId, address);
      if (players?.white) {
        const oppElo = await fetchPlayerElo(contract, players.white, address);
        setOpponentElo(oppElo);
      }
    } catch (e) {
      console.error("Error polling for opponent:", e);
    }
  }, [node, address, gameId, role, opponentJoined, fetchPlayerElo, fetchGamePlayers]);

  // ─── Make a move (instant via relay, proof in background) ───

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

      try {
        const playerId = role === "white" ? 0 : 1;
        const opponentPlayerId = playerId === 0 ? 1 : 0;

        // Import coordinate conversion
        const { rowColToNoirXY } = await import("../lib/chessUtils");
        const from = rowColToNoirXY(fromRow, fromCol, role);
        const to = rowColToNoirXY(toRow, toCol, role);

        // Check if we're capturing the opponent's king
        const targetIndex = to.x + to.y * 8;
        const targetPiece = us.game_state[targetIndex];
        const capturingOpponentKing =
          Number(targetPiece.id) === PIECE_IDS.KING &&
          Number(targetPiece.player_id) === opponentPlayerId;

        // Step 1: Create move data (~instant)
        const moveData = await contract.methods
          .__create_move(from.x, from.y, to.x, to.y)
          .simulate({ from: address });

        // Step 2: Compute UserOutputState without proof (~100ms)
        const userOutputState = await contract.methods
          .__compute_move_output(gs, us, moveData, playerId)
          .simulate({ from: address });

        const gameEnded = capturingOpponentKing;
        const currentMoveNumber = Number(gs.move_count);

        // Step 3: Send move via relay (instant)
        if (relaySendMoveRef.current) {
          relaySendMoveRef.current(currentMoveNumber, userOutputState, gameEnded);
        }

        // Step 4: Update own state immediately using existing helpers
        const isFirstTwo = currentMoveNumber < 2;
        const newUserState = await contract.methods
          .__update_user_state_from_move(isFirstTwo, us, moveData, playerId)
          .simulate({ from: address });

        const newGameState = await contract.methods
          .__update_game_state_from_move(gs, userOutputState, playerId)
          .simulate({ from: address });

        // Spread to create new references for React
        setUserState({ ...newUserState });
        setGameState({ ...newGameState });


        // Step 5: Enqueue proof for background processing
        const queueEntry: QueuedProof = {
          moveNumber: currentMoveNumber,
          gameState: gs,      // Snapshot state AT TIME OF MOVE for proof
          userState: us,      // Snapshot state AT TIME OF MOVE for proof
          moveData,
          gameEnded,
        };
        setProofQueue((prev) => [...prev, queueEntry]);
        proofQueueRef.current = [...proofQueueRef.current, queueEntry];
        setPendingProofCount((prev) => prev + 1);

        // Step 6: Check game end and update phase
        if (gameEnded) {
          setPhase("game_over");
          setStatusMessage("Game over! You captured the opponent's king!");
        } else {
          setPhase("playing");
          setStatusMessage("Move sent. Waiting for opponent...");
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Move failed";
        setError(msg);
        setPhase("playing");
        console.error("Move error:", e);
      }
    },
    [wallet, address, node, role, gameId, feePaymentMethod]
  );

  // ─── Background proof processor ───

  useEffect(() => {
    if (proofQueue.length === 0 || proofInProgressRef.current) return;
    if (!wallet || !address || !contractRef.current || !role || !feePaymentMethod || !node || gameId === null) return;

    const entry = proofQueueRef.current[0];
    if (!entry) return;

    // Gate: only submit proof for move #N when move #N-1 is confirmed on-chain.
    // The contract asserts game_hash == initial_hash, so the previous move's
    // proof (from either player) must have landed first.
    if (entry.moveNumber > lastProvenMoveRef.current) {
      console.log(`[proof-queue] Waiting: move #${entry.moveNumber} needs on-chain move #${entry.moveNumber - 1}, last proven: #${lastProvenMoveRef.current - 1}`);
      return;
    }

    const processNextProof = async () => {
      proofInProgressRef.current = true;

      const contract = contractRef.current!;
      console.log(`[proof-queue] Processing proof for move #${entry.moveNumber} (lastProven: ${lastProvenMoveRef.current})`);

      try {
        let txHash;
        if (role === "white") {
          txHash = await contract.methods
            .make_move_white_private(gameId!, entry.gameState, entry.userState, entry.moveData)
            .send({ from: address!, fee: { paymentMethod: feePaymentMethod }, wait: NO_WAIT });
        } else {
          txHash = await contract.methods
            .make_move_black_private(gameId!, entry.gameState, entry.userState, entry.moveData)
            .send({ from: address!, fee: { paymentMethod: feePaymentMethod }, wait: NO_WAIT });
        }

        const receipt = await waitForTx(node, txHash);
        const blockNumber = receipt.blockNumber ?? 0;
        lastBlockRef.current = Math.max(lastBlockRef.current, blockNumber);
        lastConfirmedMoveRef.current = entry.moveNumber + 1;
        // Bump proven counter — this move is now confirmed on-chain
        lastProvenMoveRef.current = entry.moveNumber + 1;
        setLastProvenMove(entry.moveNumber + 1);

        console.log(`[proof-queue] Move #${entry.moveNumber} proven at block ${blockNumber}`);

        // Notify peer that proof landed
        if (relaySendMoveProvenRef.current) {
          relaySendMoveProvenRef.current(entry.moveNumber, blockNumber);
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : "Proof failed";
        console.error(`[proof-queue] Move #${entry.moveNumber} FAILED:`, e);

        entry.retryCount = (entry.retryCount ?? 0) + 1;
        if (entry.retryCount < 3) {
          // Keep entry in queue, retry after delay
          console.log(`[proof-queue] Will retry move #${entry.moveNumber} (attempt ${entry.retryCount}/3) in 5s`);
          proofInProgressRef.current = false;
          setTimeout(() => setLastProvenMove(v => v), 5000); // trigger re-eval after delay
          return; // don't remove from queue
        }

        // After 3 failures, give up on this proof
        console.error(`[proof-queue] Move #${entry.moveNumber} failed after 3 attempts, giving up`);
        if (relaySendMoveFailedRef.current) {
          relaySendMoveFailedRef.current(entry.moveNumber, reason);
        }

        setError(`Proof failed for move #${entry.moveNumber}: ${reason}`);
      }

      // Remove processed entry from queue
      proofQueueRef.current = proofQueueRef.current.slice(1);
      setProofQueue((prev) => prev.slice(1));
      setPendingProofCount((prev) => Math.max(0, prev - 1));
      proofInProgressRef.current = false;
    };

    processNextProof();
  }, [proofQueue, lastProvenMove, wallet, address, node, role, gameId, feePaymentMethod]);

  // ─── Handle incoming relay moves ───

  const handleRelayMove = useCallback(
    async (msg: { moveNumber: number; userOutputState: any; gameEnded: boolean }) => {
      if (!contractRef.current || !address || !role) return;
      const gs = gameStateRef.current;
      const us = userStateRef.current;
      if (!gs || !us) return;

      const currentMoveCount = Number(gs.move_count);
      // Ignore stale/duplicate messages
      if (msg.moveNumber !== currentMoveCount) {
        console.log(`[relay] Ignoring stale move #${msg.moveNumber} (current: ${currentMoveCount})`);
        return;
      }

      console.log(`[relay] Received opponent move #${msg.moveNumber}`);

      try {
        const contract = contractRef.current;
        const opponentPlayerId = role === "white" ? 1 : 0;
        const myPlayerId = role === "white" ? 0 : 1;

        // Update game state from opponent's move
        const newGameState = await contract.methods
          .__update_game_state_from_move(gs, msg.userOutputState, opponentPlayerId)
          .simulate({ from: address });

        // Consume opponent's move to update own vision
        const newUserState = await contract.methods
          .__consume_opponent_move(newGameState, us, myPlayerId)
          .simulate({ from: address });

        // Calculate client vision and update confirmed empty squares
        const clientVision = computeClientVision(newUserState.game_state, myPlayerId);
        const newConfirmedEmpty = new Set(confirmedEmptySquaresRef.current);
        for (let i = 0; i < 64; i++) {
          if (clientVision[i] && Number(newUserState.game_state[i].id) === PIECE_IDS.EMPTY) {
            newConfirmedEmpty.add(i);
          }
        }
        setConfirmedEmptySquares(newConfirmedEmpty);

        // Spread to create new references for React
        setGameState({ ...newGameState });
        setUserState({ ...newUserState });

        // Check if game ended
        if (msg.gameEnded) {
          setPhase("game_over");
          setStatusMessage("Game over! Your king was captured.");
        } else {
          setStatusMessage("Your turn! Select a piece to move.");
        }
      } catch (e) {
        console.error("[relay] Error processing opponent move:", e);
      }
    },
    [address, role]
  );

  // ─── Setters for relay integration (called from App.tsx) ───

  const setRelaySendMove = useCallback(
    (fn: ((moveNumber: number, userOutputState: any, gameEnded: boolean) => void) | null) => {
      relaySendMoveRef.current = fn;
    },
    []
  );

  const setRelaySendMoveProven = useCallback(
    (fn: ((moveNumber: number, blockNumber: number) => void) | null) => {
      relaySendMoveProvenRef.current = fn;
    },
    []
  );

  const setRelaySendMoveFailed = useCallback(
    (fn: ((moveNumber: number, reason: string) => void) | null) => {
      relaySendMoveFailedRef.current = fn;
    },
    []
  );

  const setRelayConnected = useCallback((connected: boolean) => {
    relayConnectedRef.current = connected;
  }, []);

  // Called when the opponent's proof lands on-chain (received via relay MOVE_PROVEN)
  const handlePeerMoveProven = useCallback((moveNumber: number) => {
    const newProven = moveNumber + 1;
    if (newProven > lastProvenMoveRef.current) {
      console.log(`[proof-queue] Peer move #${moveNumber} proven on-chain, lastProven now ${newProven}`);
      lastProvenMoveRef.current = newProven;
      setLastProvenMove(newProven);
    }
  }, []);

  // ─── Fetch open games for lobby ───

  const fetchOpenGames = useCallback(async () => {
    if (!node || !wallet || !address) return;

    setIsLoadingGames(true);
    try {
      const contractAddr = AztecAddress.fromString(contractConfig.contractAddress);

      // Register contract if needed
      const contractInstance = await node.getContract(contractAddr);
      if (!contractInstance) {
        console.error("Contract not found");
        setIsLoadingGames(false);
        return;
      }
      await wallet.registerContract(contractInstance, FogOfWarChessContractArtifact);

      const contract = FogOfWarChessContract.at(contractAddr, wallet);

      // Read game_counter from public storage (slot 1)
      const gameCounterSlot = new Fr(1n);
      const gameCounterValue = await node.getPublicStorageAt("latest", contractAddr, gameCounterSlot);
      const maxGameId = Number(gameCounterValue.toBigInt());

      // Query last 50 games (or fewer if less exist)
      const startId = Math.max(0, maxGameId - 50);
      const games: { gameId: number; hasPassword: boolean }[] = [];

      for (let gameId = startId; gameId < maxGameId; gameId++) {
        try {
          const hashes = await contract.methods
            .__get_game_secret_hashes(gameId)
            .simulate({ from: address });

          // Check if game exists and is open
          // After creation: [password_hash, 0, black_encrypt, black_mask]
          // After join: [white_encrypt, white_mask, black_encrypt, black_mask]
          const blackCreated = BigInt(hashes[2]) !== 0n;  // Black (creator) has joined
          const whiteJoined = BigInt(hashes[1]) !== 0n;   // White (joiner) has joined when [1] is non-zero
          // Before white joins, [0] holds password hash (0 = no password)
          const hasPassword = !whiteJoined && BigInt(hashes[0]) !== 0n;

          if (blackCreated && !whiteJoined) {
            games.push({ gameId, hasPassword });
          }
        } catch (e) {
          console.error(`Failed to check game ${gameId}:`, e);
        }
      }

      // Query NewGame events to get creation block numbers
      const currentBlock = await node.getBlockNumber();
      const blockTimeSeconds = networkConfig.blockTimeSeconds;
      const ONE_WEEK_SECONDS = 7 * 86400;
      const gameCreationBlocks = new Map<number, number>();

      if (games.length > 0) {
        try {
          const newGameSelector = FogOfWarChessContract.events.NewGame.eventSelector;
          const maxGameAgeBlocks = Math.ceil(ONE_WEEK_SECONDS / blockTimeSeconds);
          const { logs } = await node.getPublicLogs({
            fromBlock: Math.max(1, currentBlock - maxGameAgeBlocks),
            toBlock: currentBlock + 1,
          });
          for (const log of logs) {
            const fields = log.log.getEmittedFields();
            const selectorField = fields[fields.length - 1];
            if (EventSelector.fromField(selectorField).equals(newGameSelector)) {
              const eventGameId = Number(fields[0].toBigInt());
              gameCreationBlocks.set(eventGameId, log.id.blockNumber);
            }
          }
        } catch (e) {
          console.error("Failed to fetch NewGame events for elapsed time:", e);
        }
      }

      // Compute elapsed time and filter stale games
      const openGames: OpenGame[] = [];
      for (const game of games) {
        const creationBlock = gameCreationBlocks.get(game.gameId);
        const elapsedSeconds = creationBlock != null
          ? (currentBlock - creationBlock) * blockTimeSeconds
          : 0;

        if (elapsedSeconds <= ONE_WEEK_SECONDS) {
          openGames.push({ ...game, elapsedSeconds });
        }
      }

      setOpenGames(openGames);
    } catch (e) {
      console.error("Failed to fetch open games:", e);
    } finally {
      setIsLoadingGames(false);
    }
  }, [node, wallet, address]);

  // ─── Poll for opponent moves ───

  const pollForOpponentMove = useCallback(async () => {
    if (!node || !contractRef.current || !role || !address) return;
    // Note: we no longer skip polling when proofInProgress — the poller uses
    // its own lastPolledChainMoveCountRef to correctly identify and skip our
    // own MoveEvents via move_count parity.

    const gs = gameStateRef.current;
    const us = userStateRef.current;
    if (!gs || !us) return;

    try {
      const currentBlock = await node.getBlockNumber();
      if (currentBlock <= lastBlockRef.current) return;

      const allEvents = await getDecodedEventsNoValidation<MoveEvent>(
        node,
        FogOfWarChessContract.events.MoveEvent,
        lastBlockRef.current + 1,
        currentBlock + 1
      );

      // Filter to only events for our game
      const events = allEvents.filter(
        (e) => Number(e.game_id) === gameId
      );

      if (events.length === 0) {
        lastBlockRef.current = currentBlock;
        return;
      }

      const myPlayerId = role === "white" ? 0 : 1;
      const opponentPlayerId = role === "white" ? 1 : 0;
      const contract = contractRef.current;

      // Determine each event's on-chain move number using the poller's own
      // counter (not lastProvenMoveRef, which can be bumped by MOVE_PROVEN
      // relay messages independently of what the poller has actually seen).
      let onChainMoveCount = lastPolledChainMoveCountRef.current;
      let latestGs = gs;
      let latestUs = us;
      let processedOpponentMove = false;

      for (const event of events) {
        const playerWhoMoved = onChainMoveCount % 2; // 0 = white, 1 = black
        onChainMoveCount++;

        if (playerWhoMoved === myPlayerId) {
          // Our own proof landed — update proven counter, skip processing
          console.log(`[poll] Skipping own move #${onChainMoveCount - 1} (on-chain)`);
          continue;
        }

        // Opponent's move — process it
        console.log(`[poll] Processing opponent move #${onChainMoveCount - 1} (on-chain)`);
        latestGs = await contract.methods
          .__update_game_state_from_move(latestGs, event.state, opponentPlayerId)
          .simulate({ from: address });

        latestUs = await contract.methods
          .__consume_opponent_move(latestGs, latestUs, myPlayerId)
          .simulate({ from: address });

        processedOpponentMove = true;
      }

      // Update the poller's own counter for events it has seen
      lastPolledChainMoveCountRef.current = onChainMoveCount;
      // Also advance lastProvenMoveRef if the poller saw more events than
      // the proof queue / MOVE_PROVEN relay messages have reported so far
      if (onChainMoveCount > lastProvenMoveRef.current) {
        lastProvenMoveRef.current = onChainMoveCount;
        setLastProvenMove(onChainMoveCount);
      }

      lastBlockRef.current = currentBlock;

      if (!processedOpponentMove) {
        // All events were our own proofs — no state update needed
        return;
      }

      // Skip if the relay already applied the opponent's move
      // (local state is already ahead of on-chain).
      // Use a fresh read from gameStateRef instead of the stale `gs` captured
      // at the top of this function (which may be outdated due to React batching).
      const freshLocalMoveCount = Number(gameStateRef.current?.move_count ?? 0);
      if (freshLocalMoveCount >= onChainMoveCount) {
        return;
      }

      // Calculate client vision and update confirmed empty squares
      const clientVision = computeClientVision(latestUs.game_state, myPlayerId);
      const newConfirmedEmpty = new Set(confirmedEmptySquaresRef.current);
      for (let i = 0; i < 64; i++) {
        if (clientVision[i] && Number(latestUs.game_state[i].id) === PIECE_IDS.EMPTY) {
          newConfirmedEmpty.add(i);
        }
      }
      setConfirmedEmptySquares(newConfirmedEmpty);

      setGameState({ ...latestGs });
      setUserState({ ...latestUs });

      // Check if game ended
      const gameEnded = latestGs.game_ended === true ||
          (typeof latestGs.game_ended === 'bigint' && latestGs.game_ended !== 0n) ||
          (typeof latestGs.game_ended === 'number' && latestGs.game_ended !== 0);

      if (gameEnded) {
        setPhase("game_over");
        setStatusMessage("Game over! Your king was captured.");
      } else {
        setStatusMessage("Your turn! Select a piece to move.");
      }
    } catch (e) {
      console.error("Poll error:", e);
    }
  }, [node, role, address]);

  // Start/stop polling based on phase and turn
  useEffect(() => {
    // Poll when it's not our turn and we're in playing phase
    const shouldPollForMoves = phase === "playing" && !isMyTurn && opponentJoined;

    // Poll when black (creator) is waiting for white (joiner) to join
    const shouldPollForOpponent = phase === "playing" && role === "black" && !opponentJoined;

    if (shouldPollForMoves || shouldPollForOpponent) {
      // When relay is connected, poll less frequently (fallback only)
      const interval = relayConnectedRef.current ? 15000 : 3000;
      pollingRef.current = setInterval(() => {
        if (shouldPollForOpponent) {
          pollForOpponentJoin();
        } else {
          pollForOpponentMove();
        }
      }, interval);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [phase, isMyTurn, opponentJoined, role, pollForOpponentMove, pollForOpponentJoin]);

  // ─── Return to lobby (leave current game) ───

  const returnToLobby = useCallback(() => {
    // Stop polling
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    // Reset all game state
    setPhase("lobby");
    setRole(null);
    setGameId(null);
    setContractAddress(null);
    setGameState(null);
    setUserState(null);
    setConfirmedEmptySquares(new Set());

    setError(null);
    setStatusMessage("Waiting...");
    setOpponentJoined(false);
    setCreatedGamePassword("");
    setMyElo(1200);
    setOpponentElo(1200);
    setTxStep(null);
    setProofQueue([]);
    setPendingProofCount(0);
    setLastProvenMove(0);

    // Reset refs
    contractRef.current = null;
    lastBlockRef.current = 0;
    gameStateRef.current = null;
    userStateRef.current = null;
    proofQueueRef.current = [];
    proofInProgressRef.current = false;
    lastConfirmedMoveRef.current = 0;
    lastProvenMoveRef.current = 0;
    lastPolledChainMoveCountRef.current = 0;
    encryptSecretRef.current = null;
    maskSecretRef.current = null;
    opponentSecretHashesRef.current = null;

    // Clear relay callbacks
    relaySendMoveRef.current = null;
    relaySendMoveProvenRef.current = null;
    relaySendMoveFailedRef.current = null;
    relayConnectedRef.current = false;
  }, []);

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
    openGames,
    isLoadingGames,
    opponentJoined,
    createdGamePassword,
    savedGames,
    myElo,
    opponentElo,
    txStep,
    pendingProofCount,
    createGame,
    joinGame,
    resumeGame,
    deleteSavedGame,
    makeMove,
    fetchOpenGames,
    setRole,
    returnToLobby,
    // Relay integration
    handleRelayMove,
    setRelaySendMove,
    setRelaySendMoveProven,
    setRelaySendMoveFailed,
    setRelayConnected,
    handlePeerMoveProven,
  };
}
