import { useState, useCallback, useRef } from "react";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { TestWallet } from "@aztec/test-wallet/client/bundle";
import type { AztecAddress } from "@aztec/aztec.js/addresses";

const AZTEC_NODE_URL = "http://localhost:8080";

export function useAztec() {
  const [wallet, setWallet] = useState<any>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodeRef = useRef<any>(null);

  const connect = useCallback(async (playerIndex: number) => {
    setIsConnecting(true);
    setError(null);
    try {
      const node = createAztecNodeClient(AZTEC_NODE_URL);
      nodeRef.current = node;

      const testWallet = await TestWallet.create(node);
      const accounts = await getInitialTestAccountsData();

      if (playerIndex >= accounts.length) {
        throw new Error(`No test account at index ${playerIndex}`);
      }

      const account = await testWallet.createSchnorrAccount(
        accounts[playerIndex].secret,
        accounts[playerIndex].salt
      );
      const addr = (await account.getAccount()).getAddress();

      setWallet(testWallet);
      setAddress(addr);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to connect";
      setError(msg);
      console.error("Aztec connection error:", e);
    } finally {
      setIsConnecting(false);
    }
  }, []);

  return {
    wallet,
    address,
    node: nodeRef.current,
    isConnecting,
    error,
    connect,
  };
}
