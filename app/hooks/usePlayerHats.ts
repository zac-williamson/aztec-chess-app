import { useState, useCallback, useEffect } from "react";
import type { AztecAddress } from "@aztec/aztec.js/addresses";
import {
  HatNFTContract,
  HatNFTContractArtifact,
} from "../artifacts/HatNFT";
import type { Hat } from "../lib/types";
import nftConfig from "../config/nft-address.json";

interface UsePlayerHatsReturn {
  hats: Hat[];
  bestHat: Hat | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  fetchHatForGame: (gameId: number) => Promise<Hat | null>;
}

export function usePlayerHats(
  wallet: any,
  address: AztecAddress | null,
  node: any
): UsePlayerHatsReturn {
  const [hats, setHats] = useState<Hat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHats = useCallback(async () => {
    if (!wallet || !address || !node || !nftConfig.nftContractAddress) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
      const nftContractAddr = AztecAddr.fromString(nftConfig.nftContractAddress);

      // Register contract with wallet
      const contractInstance = await node.getContract(nftContractAddr);
      if (!contractInstance) {
        console.log("Hat NFT contract not found at configured address");
        setIsLoading(false);
        return;
      }
      await wallet.registerContract(contractInstance, HatNFTContractArtifact);

      const contract = HatNFTContract.at(nftContractAddr, wallet);

      // Get total supply
      const totalSupplyResult = await contract.methods
        .total_supply()
        .simulate({ from: address });
      const totalSupply = Number(totalSupplyResult);

      if (totalSupply === 0) {
        setHats([]);
        setIsLoading(false);
        return;
      }

      // Check each token to see if the player owns it
      const playerHats: Hat[] = [];
      const playerAddrString = address.toString();

      for (let tokenId = 0; tokenId < totalSupply; tokenId++) {
        try {
          // Check owner
          const ownerResult = await contract.methods
            .owner_of(tokenId)
            .simulate({ from: address });

          // Compare owner address
          const ownerAddr = ownerResult?.inner
            ? ownerResult.inner.toString()
            : ownerResult?.toString?.() || "";

          if (ownerAddr === playerAddrString ||
              ownerAddr.toLowerCase() === playerAddrString.toLowerCase()) {
            // Get hat metadata - format: (game_id: u32, hat_type: u8, hat_quality: u8)
            const metadata = await contract.methods
              .get_hat_metadata(tokenId)
              .simulate({ from: address });

            playerHats.push({
              tokenId,
              gameId: Number(metadata.game_id ?? metadata[0] ?? 0),
              hatType: Number(metadata.hat_type ?? metadata[1] ?? 0),
              hatQuality: Number(metadata.hat_quality ?? metadata[2] ?? 0),
            });
          }
        } catch (e) {
          console.error(`Error checking token ${tokenId}:`, e);
        }
      }

      setHats(playerHats);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to fetch hats";
      setError(msg);
      console.error("Error fetching player hats:", e);
    } finally {
      setIsLoading(false);
    }
  }, [wallet, address, node]);

  // Find the best hat (highest quality, then lowest type for more impressive victories)
  const bestHat = hats.length > 0
    ? hats.reduce((best, hat) => {
        // Prioritize quality first, then hat type (lower type = more impressive upset)
        if (hat.hatQuality > best.hatQuality) return hat;
        if (hat.hatQuality === best.hatQuality && hat.hatType < best.hatType) return hat;
        return best;
      }, hats[0])
    : null;

  // Fetch a specific hat for a game ID (used after victory)
  const fetchHatForGame = useCallback(async (gameId: number): Promise<Hat | null> => {
    console.log("fetchHatForGame called for gameId:", gameId);
    console.log("NFT config:", nftConfig);

    if (!wallet || !address || !node) {
      console.log("Missing wallet, address, or node");
      return null;
    }

    if (!nftConfig.nftContractAddress) {
      console.log("No NFT contract address configured");
      return null;
    }

    try {
      const { AztecAddress: AztecAddr } = await import("@aztec/aztec.js/addresses");
      const nftContractAddr = AztecAddr.fromString(nftConfig.nftContractAddress);
      console.log("NFT contract address:", nftContractAddr.toString());

      // Register contract with wallet
      const contractInstance = await node.getContract(nftContractAddr);
      if (!contractInstance) {
        console.log("NFT contract not found at address");
        return null;
      }
      await wallet.registerContract(contractInstance, HatNFTContractArtifact);

      const contract = HatNFTContract.at(nftContractAddr, wallet);

      // Get total supply
      const totalSupplyResult = await contract.methods
        .total_supply()
        .simulate({ from: address });
      const totalSupply = Number(totalSupplyResult);
      console.log("Total NFT supply:", totalSupply);

      if (totalSupply === 0) {
        console.log("No hats have been minted yet");
        return null;
      }

      // Check recent tokens (newest first) to find one matching the game ID
      const playerAddrString = address.toString();
      console.log("Looking for hat for game", gameId, "owned by", playerAddrString);

      for (let tokenId = totalSupply - 1; tokenId >= Math.max(0, totalSupply - 10); tokenId--) {
        try {
          // Get hat metadata first to check game_id
          const metadata = await contract.methods
            .get_hat_metadata(tokenId)
            .simulate({ from: address });

          // Metadata format: (game_id: u32, hat_type: u8, hat_quality: u8)
          const hatGameId = Number(metadata.game_id ?? metadata[0] ?? 0);
          const hatType = Number(metadata.hat_type ?? metadata[1] ?? 0);
          const hatQuality = Number(metadata.hat_quality ?? metadata[2] ?? 0);
          console.log(`Token ${tokenId}: gameId=${hatGameId}, hatType=${hatType}, hatQuality=${hatQuality}, raw=`, metadata);

          if (hatGameId === gameId) {
            // Check if player owns this hat
            const ownerResult = await contract.methods
              .owner_of(tokenId)
              .simulate({ from: address });

            const ownerAddr = ownerResult?.inner
              ? ownerResult.inner.toString()
              : ownerResult?.toString?.() || "";
            console.log(`Token ${tokenId} matches game! Owner:`, ownerAddr);

            if (ownerAddr === playerAddrString ||
                ownerAddr.toLowerCase() === playerAddrString.toLowerCase()) {
              console.log("Found matching hat owned by player!");
              return {
                tokenId,
                gameId: hatGameId,
                hatType,
                hatQuality,
              };
            } else {
              console.log("Hat found for game but owned by someone else");
            }
          }
        } catch (e) {
          console.error(`Error checking token ${tokenId} for game ${gameId}:`, e);
        }
      }

      return null;
    } catch (e) {
      console.error("Error fetching hat for game:", e);
      return null;
    }
  }, [wallet, address, node]);

  // Fetch hats on mount and when address changes
  useEffect(() => {
    fetchHats();
  }, [fetchHats]);

  return {
    hats,
    bestHat,
    isLoading,
    error,
    refetch: fetchHats,
    fetchHatForGame,
  };
}
