export type BotDifficulty = "easy" | "medium" | "hard";

export type GameMode = "none" | "multiplayer" | "bot";

export type GamePhase =
  | "connecting"
  | "lobby"
  | "creating"
  | "waiting_opponent"
  | "joining"
  | "playing"
  | "proving"
  | "game_over";

export type PlayerRole = "white" | "black";

export type TxStep = "building" | "proving" | "confirming";

// Piece type IDs from the fog_of_war_chess Noir contract (src/piece.nr)
export const PIECE_IDS = {
  EMPTY: 0,
  WHITE_PAWN: 1,
  BLACK_PAWN: 2,
  KNIGHT: 3,
  BISHOP: 4,
  ROOK: 5,
  QUEEN: 6,
  KING: 7,
} as const;

export const WHITE_PLAYER = 0;
export const BLACK_PLAYER = 1;

export interface BoardSquare {
  piece: string | null; // piece letter: "P", "N", "B", "R", "Q", "K"
  pieceColor: "white" | "black" | null;
  visible: boolean;
  potentiallyVisible: boolean; // client-side vision says yes, but waiting for opponent's MPC response
  isSelected: boolean;
}

export interface OpenGame {
  gameId: number;
  hasPassword: boolean;
  elapsedSeconds: number;
}

export interface SavedGame {
  gameId: number;
  role: PlayerRole;
  contractAddress: string;
  playerAddress: string;
  // Only store secrets and starting point - replay from chain to get current state
  encryptSecret: string; // Fr as hex string
  maskSecret: string; // Fr as hex string
  startBlock: number; // Block when game was created/joined - replay events from here
  savedAt: number; // timestamp
}

// NFT Hat types
export interface Hat {
  tokenId: number;
  gameId: number;
  hatType: number;   // 0-6, based on ELO delta
  hatQuality: number; // 0-7, based on winner's ELO
}

// Hat type names based on ELO delta (winner_elo - loser_elo)
export const HAT_TYPE_NAMES: Record<number, string> = {
  0: "Crown",         // Upset victory (+200 delta)
  1: "Laurel Wreath", // +100 to +200
  2: "Wizard Hat",    // Fair match (-100 to +100)
  3: "Top Hat",       // -100 to -200
  4: "Bowler Hat",    // -200 to -300
  5: "Baseball Cap",  // -300 to -400
  6: "Dunce Cap",     // Expected win (< -400)
};

// Hat quality names based on winner's ELO
export const HAT_QUALITY_NAMES: Record<number, string> = {
  0: "Tattered",
  1: "Shoddy",
  2: "Plain",
  3: "Fine",
  4: "Elegant",
  5: "Majestic",
  6: "Legendary",
  7: "Mythic",
};

// Relay / proof queue types
export interface QueuedProof {
  moveNumber: number;
  gameState: any;
  userState: any;
  moveData: any;
  gameEnded: boolean;
  retryCount?: number;
}

export const EMOTES = ["👋", "❤️", "🙂", "😢", "👑"] as const;
export type Emote = (typeof EMOTES)[number];

export type RelayMessage =
  | { type: "JOIN"; gameId: number; role: "white" | "black" }
  | { type: "PEER_CONNECTED" }
  | { type: "PEER_DISCONNECTED" }
  | { type: "MOVE"; moveNumber: number; userOutputState: any; gameEnded: boolean }
  | { type: "MOVE_PROVEN"; moveNumber: number; blockNumber: number }
  | { type: "MOVE_FAILED"; moveNumber: number; reason: string }
  | { type: "EMOTE"; emote: Emote };

// Hat type descriptions
export const HAT_TYPE_DESCRIPTIONS: Record<number, string> = {
  0: "Earned by defeating a much stronger opponent!",
  1: "Earned by defeating a stronger opponent.",
  2: "Earned in a fair, evenly matched battle.",
  3: "Earned against a slightly weaker opponent.",
  4: "Earned against a weaker opponent.",
  5: "Earned against a much weaker opponent.",
  6: "Earned against a significantly weaker opponent.",
};
