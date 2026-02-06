import { useState, useRef, useCallback, useEffect } from "react";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
  type MoveEvent,
} from "../artifacts/FogOfWarChess";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import { Fr } from "@aztec/aztec.js/fields";
import type { GamePhase, PlayerRole, OpenGame, SavedGame } from "../lib/types";
import { PIECE_IDS } from "../lib/types";

const SAVED_GAMES_KEY = "aztec-chess-saved-games";

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
  const { decodeFromAbi } = await import("@aztec/aztec.js/abi");
  const { EventSelector } = await import("@aztec/aztec.js/abi");

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
  createGame: (password: number) => Promise<void>;
  joinGame: (
    gameId: number,
    password: number
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
  const [_moveCount, setMoveCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("Waiting...");
  const [openGames, setOpenGames] = useState<OpenGame[]>([]);
  const [isLoadingGames, setIsLoadingGames] = useState(false);
  const [opponentJoined, setOpponentJoined] = useState(false);
  const [createdGamePassword, setCreatedGamePassword] = useState("");
  const [savedGames, setSavedGames] = useState<SavedGame[]>([]);
  const [myElo, setMyElo] = useState<number>(1200);
  const [opponentElo, setOpponentElo] = useState<number>(1200);

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
    const allGames = loadSavedGames(true);
    const filtered = allGames.filter(g => !(g.gameId === targetGameId && g.playerAddress === playerAddr));
    saveSavedGames(filtered);
  }, [address, loadSavedGames, saveSavedGames]);

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
    async (password: number) => {
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
        setStatusMessage("Connecting to chess contract...");

        const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
        const contractAztecAddr = AztecAddr.fromString(contractConfig.contractAddress);

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
        setStatusMessage("Creating game on-chain...");
        if (!feePaymentMethod) {
          throw new Error("Fee payment method not initialized. Please wait for wallet to connect.");
        }
        const receipt = await contract.methods
          .create_game_private(encryptSecret, maskSecret, password)
          .send({ from: address, fee: { paymentMethod: feePaymentMethod } });

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
        setCreatedGamePassword(String(password || ""));
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
        console.error("Create game error:", e);
      }
    },
    [wallet, address, node, feePaymentMethod, fetchPlayerElo, saveGameToStorage]
  );

  // ─── Join existing game (White player - joiner) ───

  const joinGame = useCallback(
    async (targetGameId: number, password: number) => {
      if (!wallet || !address) return;
      setError(null);

      // Check that contract address is configured
      if (!contractConfig.contractAddress) {
        setError("No contract address configured. Run 'npx tsx scripts/deploy.ts' first.");
        return;
      }

      try {
        setPhase("joining");
        setStatusMessage("Connecting to contract...");

        // Connect to existing contract
        const { AztecAddress: AztecAddr } = await import(
          "@aztec/aztec.js/addresses"
        );
        const contractAztecAddr = AztecAddr.fromString(contractConfig.contractAddress);

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
        setStatusMessage("Joining game on-chain...");
        if (!feePaymentMethod) {
          throw new Error("Fee payment method not initialized. Please wait for wallet to connect.");
        }
        const receipt = await contract.methods
          .join_game_private(
            targetGameId,
            encryptSecret,
            maskSecret,
            blackSecretHashes,
            password
          )
          .send({ from: address, fee: { paymentMethod: feePaymentMethod } });

        setGameId(targetGameId);
        setRole("white");
        setGameState(gs);
        setUserState(ws);
        lastBlockRef.current = receipt.blockNumber ?? 0;
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

        const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
        const contractAztecAddr = AztecAddr.fromString(contractConfig.contractAddress);

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
        // Note: MoveEvent doesn't have game_id, so this assumes no other games
        // were played on this contract since our game started. This works for
        // single-game scenarios or when startBlock is precise to our game.
        setStatusMessage("Replaying game history...");
        const currentBlock = await node.getBlockNumber();
        const gameEvents = await getDecodedEventsNoValidation<MoveEvent>(
          node,
          FogOfWarChessContract.events.MoveEvent,
          savedGame.startBlock,
          currentBlock + 1
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
        setMoveCount(currentMoveCount);
        lastBlockRef.current = currentBlock;

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
        const opponentPlayerId = playerId === 0 ? 1 : 0;

        // Import coordinate conversion
        const { rowColToNoirXY } = await import("../lib/chessUtils");
        const from = rowColToNoirXY(fromRow, fromCol, role);
        const to = rowColToNoirXY(toRow, toCol, role);

        // Check if we're capturing the opponent's king (we can see this before the move)
        const targetIndex = to.x + to.y * 8;
        const targetPiece = us.game_state[targetIndex];
        const capturingOpponentKing =
          Number(targetPiece.id) === PIECE_IDS.KING &&
          Number(targetPiece.player_id) === opponentPlayerId;

        // Create move data
        const moveData = await contract.methods
          .__create_move(from.x, from.y, to.x, to.y)
          .simulate({ from: address });

        // Send move transaction
        if (!feePaymentMethod) {
          throw new Error("Fee payment method not initialized. Please wait for wallet to connect.");
        }
        let receipt;
        if (role === "white") {
          receipt = await contract.methods
            .make_move_white_private(gameId!, gs, us, moveData)
            .send({ from: address, fee: { paymentMethod: feePaymentMethod } });
        } else {
          receipt = await contract.methods
            .make_move_black_private(gameId!, gs, us, moveData)
            .send({ from: address, fee: { paymentMethod: feePaymentMethod } });
        }

        // Get MoveEvent from receipt
        const events = await getDecodedEventsNoValidation<MoveEvent>(
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
        lastBlockRef.current = receipt.blockNumber ?? 0;

        // Check if game ended:
        // 1. We captured opponent's king (we know this client-side from the move)
        // 2. Contract's game_ended flag is set
        const gameEndedFlag = newGameState.game_ended === true ||
          (typeof newGameState.game_ended === 'bigint' && newGameState.game_ended !== 0n) ||
          (typeof newGameState.game_ended === 'number' && newGameState.game_ended !== 0);
        console.log("Game ended check after move:", {
          capturingOpponentKing,
          gameEndedFlag,
          raw: newGameState.game_ended
        });

        if (capturingOpponentKing || gameEndedFlag) {
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
    [wallet, address, node, role, gameId, feePaymentMethod]
  );

  // ─── Fetch open games for lobby ───

  const fetchOpenGames = useCallback(async () => {
    if (!node || !wallet || !address) return;

    setIsLoadingGames(true);
    try {
      const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
      const contractAddr = AztecAddr.fromString(contractConfig.contractAddress);

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
      const games: OpenGame[] = [];

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

      setOpenGames(games);
    } catch (e) {
      console.error("Failed to fetch open games:", e);
    } finally {
      setIsLoadingGames(false);
    }
  }, [node, wallet, address]);

  // ─── Poll for opponent moves ───

  const pollForOpponentMove = useCallback(async () => {
    if (!node || !contractRef.current || !role || !address) return;
    const gs = gameStateRef.current;
    const us = userStateRef.current;
    if (!gs || !us) return;

    try {
      const currentBlock = await node.getBlockNumber();
      if (currentBlock <= lastBlockRef.current) return;

      const events = await getDecodedEventsNoValidation<MoveEvent>(
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
      // Note: We cannot reliably check king existence due to fog of war.
      // Only rely on the contract's game_ended flag.
      const gameEnded = newGameState.game_ended === true ||
          (typeof newGameState.game_ended === 'bigint' && newGameState.game_ended !== 0n) ||
          (typeof newGameState.game_ended === 'number' && newGameState.game_ended !== 0);
      console.log("Game ended check:", { raw: newGameState.game_ended, parsed: gameEnded });

      if (gameEnded) {
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
    const shouldPollForMoves = phase === "playing" && !isMyTurn && opponentJoined;

    // Poll when black (creator) is waiting for white (joiner) to join
    const shouldPollForOpponent = phase === "playing" && role === "black" && !opponentJoined;

    if (shouldPollForMoves || shouldPollForOpponent) {
      pollingRef.current = setInterval(() => {
        if (shouldPollForOpponent) {
          pollForOpponentJoin();
        } else {
          pollForOpponentMove();
        }
      }, 3000);
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [phase, isMyTurn, opponentJoined, role, pollForOpponentMove, pollForOpponentJoin]);

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
    createGame,
    joinGame,
    resumeGame,
    deleteSavedGame,
    makeMove,
    fetchOpenGames,
    setRole,
  };
}
