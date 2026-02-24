import { useState, useRef, useCallback, useEffect } from "react";
import type { RelayMessage, PlayerRole, Emote } from "../lib/types";
import relayConfig from "../config/relay.json";

interface UseRelayOptions {
  gameId: number | null;
  role: PlayerRole | null;
  phase: string;
  onMove: (msg: Extract<RelayMessage, { type: "MOVE" }>) => void;
  onMoveProven: (msg: Extract<RelayMessage, { type: "MOVE_PROVEN" }>) => void;
  onMoveFailed: (msg: Extract<RelayMessage, { type: "MOVE_FAILED" }>) => void;
  onEmote: (msg: Extract<RelayMessage, { type: "EMOTE" }>) => void;
}

export function useRelay({
  gameId,
  role,
  phase,
  onMove,
  onMoveProven,
  onMoveFailed,
  onEmote,
}: UseRelayOptions) {
  const [isConnected, setIsConnected] = useState(false);
  const [isPeerConnected, setIsPeerConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(1000);
  // Store callbacks in refs to avoid reconnecting when they change
  const onMoveRef = useRef(onMove);
  const onMoveProvenRef = useRef(onMoveProven);
  const onMoveFailedRef = useRef(onMoveFailed);
  const onEmoteRef = useRef(onEmote);

  onMoveRef.current = onMove;
  onMoveProvenRef.current = onMoveProven;
  onMoveFailedRef.current = onMoveFailed;
  onEmoteRef.current = onEmote;

  const connect = useCallback(() => {
    if (gameId === null || !role || wsRef.current) {
      console.log(`[relay] Skipping connect: gameId=${gameId}, role=${role}, wsExists=${!!wsRef.current}`);
      return;
    }

    console.log(`[relay] Connecting to ${relayConfig.url} for game ${gameId} as ${role}...`);
    const ws = new WebSocket(relayConfig.url);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log(`[relay] Connected! Joining game ${gameId} as ${role}`);
      setIsConnected(true);
      reconnectDelayRef.current = 1000; // Reset backoff
      const joinMsg: RelayMessage = { type: "JOIN", gameId, role };
      ws.send(JSON.stringify(joinMsg));
    };

    ws.onmessage = (event) => {
      let msg: RelayMessage;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case "PEER_CONNECTED":
          setIsPeerConnected(true);
          break;
        case "PEER_DISCONNECTED":
          setIsPeerConnected(false);
          break;
        case "MOVE":
          onMoveRef.current(msg);
          break;
        case "MOVE_PROVEN":
          onMoveProvenRef.current(msg);
          break;
        case "MOVE_FAILED":
          onMoveFailedRef.current(msg);
          break;
        case "EMOTE":
          onEmoteRef.current(msg);
          break;
      }
    };

    ws.onclose = (event) => {
      console.log(`[relay] Disconnected (code=${event.code}, reason=${event.reason})`);
      wsRef.current = null;
      setIsConnected(false);
      setIsPeerConnected(false);

      // Reconnect with exponential backoff (if still in playing phase)
      if (phase === "playing") {
        const delay = reconnectDelayRef.current;
        reconnectDelayRef.current = Math.min(delay * 2, 30000);
        console.log(`[relay] Reconnecting in ${delay}ms...`);
        reconnectTimerRef.current = setTimeout(connect, delay);
      }
    };

    ws.onerror = (err) => {
      console.error("[relay] WebSocket error:", err);
      // onclose will fire after this, triggering reconnect
    };
  }, [gameId, role, phase]);

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsPeerConnected(false);
  }, []);

  // Connect when game starts playing, disconnect on game end
  useEffect(() => {
    console.log(`[relay] Phase changed: phase=${phase}, gameId=${gameId}, role=${role}`);
    if (phase === "playing" && gameId !== null && role) {
      connect();
    } else if (phase === "game_over" || phase === "lobby") {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [phase, gameId, role, connect, disconnect]);

  const send = useCallback((msg: RelayMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg, (_key, value) =>
        typeof value === "bigint" ? value.toString() : value
      ));
    }
  }, []);

  const sendMove = useCallback(
    (moveNumber: number, userOutputState: any, gameEnded: boolean) => {
      send({ type: "MOVE", moveNumber, userOutputState, gameEnded });
    },
    [send]
  );

  const sendMoveProven = useCallback(
    (moveNumber: number, blockNumber: number) => {
      send({ type: "MOVE_PROVEN", moveNumber, blockNumber });
    },
    [send]
  );

  const sendMoveFailed = useCallback(
    (moveNumber: number, reason: string) => {
      send({ type: "MOVE_FAILED", moveNumber, reason });
    },
    [send]
  );

  const sendEmote = useCallback(
    (emote: Emote) => {
      send({ type: "EMOTE", emote });
    },
    [send]
  );

  return {
    isConnected,
    isPeerConnected,
    sendMove,
    sendMoveProven,
    sendMoveFailed,
    sendEmote,
  };
}
