import { useState, useCallback, useRef, useEffect } from "react";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { TestWallet } from "@aztec/test-wallet/client/bundle";
import type { AztecAddress } from "@aztec/aztec.js/addresses";

const AZTEC_NODE_URL = "http://localhost:8080";

// Get player index from URL param (?player=0 or ?player=1), default to 0
function getPlayerIndexFromUrl(): number {
  if (typeof window === "undefined") return 0;
  const params = new URLSearchParams(window.location.search);
  const playerParam = params.get("player");
  if (playerParam === "1") return 1;
  return 0;
}

export function useAztec() {
  const [wallet, setWallet] = useState<any>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerIndex, setPlayerIndex] = useState<number>(getPlayerIndexFromUrl());
  const nodeRef = useRef<any>(null);
  const connectingRef = useRef(false);

  const connect = useCallback(async (index: number) => {
    // Prevent multiple simultaneous connections
    if (connectingRef.current) return;
    connectingRef.current = true;

    setIsConnecting(true);
    setError(null);
    try {
      const node = createAztecNodeClient(AZTEC_NODE_URL);
      nodeRef.current = node;

      const testWallet = await TestWallet.create(node);      const accounts = await getInitialTestAccountsData();

      if (index >= accounts.length) {
        throw new Error(`No test account at index ${index}. Available: ${accounts.length}`);
      }

      const account = await testWallet.createSchnorrAccount(
        accounts[index].secret,
        accounts[index].salt
      );
      const addr = (await account.getAccount()).getAddress();

      setWallet(testWallet);
      setAddress(addr);
      setPlayerIndex(index);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to connect";
      setError(msg);
      console.error("Aztec connection error:", e);
    } finally {
      setIsConnecting(false);
      connectingRef.current = false;
    }
  }, []);

  // Auto-connect on mount using URL parameter
  useEffect(() => {
    const index = getPlayerIndexFromUrl();
    connect(index);
  }, [connect]);

  return {
    wallet,
    address,
    node: nodeRef.current,
    isConnecting,
    error,
    playerIndex,
    connect,
  };
}
