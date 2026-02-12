export type RelayMessage =
  | { type: "JOIN"; gameId: number; role: "white" | "black" }
  | { type: "PEER_CONNECTED" }
  | { type: "PEER_DISCONNECTED" }
  | { type: "MOVE"; moveNumber: number; userOutputState: any; gameEnded: boolean }
  | { type: "MOVE_PROVEN"; moveNumber: number; blockNumber: number }
  | { type: "MOVE_FAILED"; moveNumber: number; reason: string };
