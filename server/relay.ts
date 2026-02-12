import { WebSocketServer, WebSocket } from "ws";
import type { RelayMessage } from "./protocol";

const PORT = Number(process.env.PORT) || 8081;

interface GameRoom {
  white: WebSocket | null;
  black: WebSocket | null;
}

const rooms = new Map<number, GameRoom>();

const wss = new WebSocketServer({ port: PORT });
console.log(`Relay server listening on port ${PORT}`);

wss.on("connection", (ws) => {
  let joinedGameId: number | null = null;
  let joinedRole: "white" | "black" | null = null;

  ws.on("message", (data) => {
    let msg: RelayMessage;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }

    if (msg.type === "JOIN") {
      const { gameId, role } = msg;
      joinedGameId = gameId;
      joinedRole = role;

      if (!rooms.has(gameId)) {
        rooms.set(gameId, { white: null, black: null });
      }
      const room = rooms.get(gameId)!;

      // Disconnect previous occupant of this slot if any
      const prev = room[role];
      if (prev && prev !== ws && prev.readyState === WebSocket.OPEN) {
        prev.close();
      }

      room[role] = ws;

      // Notify peer if they're already connected
      const peerRole = role === "white" ? "black" : "white";
      const peer = room[peerRole];
      if (peer && peer.readyState === WebSocket.OPEN) {
        send(peer, { type: "PEER_CONNECTED" });
        send(ws, { type: "PEER_CONNECTED" });
      }
      return;
    }

    // All other messages are forwarded to the peer
    if (joinedGameId === null || joinedRole === null) return;
    const room = rooms.get(joinedGameId);
    if (!room) return;

    const peerRole = joinedRole === "white" ? "black" : "white";
    const peer = room[peerRole];
    if (peer && peer.readyState === WebSocket.OPEN) {
      peer.send(data.toString());
    }
  });

  ws.on("close", () => {
    if (joinedGameId !== null && joinedRole !== null) {
      const room = rooms.get(joinedGameId);
      if (room) {
        if (room[joinedRole] === ws) {
          room[joinedRole] = null;
        }
        // Notify peer of disconnect
        const peerRole = joinedRole === "white" ? "black" : "white";
        const peer = room[peerRole];
        if (peer && peer.readyState === WebSocket.OPEN) {
          send(peer, { type: "PEER_DISCONNECTED" });
        }
        // Clean up empty rooms
        if (!room.white && !room.black) {
          rooms.delete(joinedGameId);
        }
      }
    }
  });
});

function send(ws: WebSocket, msg: RelayMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}
