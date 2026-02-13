import { useState, useCallback, useRef, useEffect } from "react";
import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { Fr } from "@aztec/aztec.js/fields";
import { AztecAddress } from "@aztec/aztec.js/addresses";
import { TestWallet } from "@aztec/test-wallet/client/lazy";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import environmentConfig from "../config/environment.json";
import devnetConfig from "../config/networks/devnet.json";
import localConfig from "../config/networks/local.json";

const networkConfig = environmentConfig.network === "local" ? localConfig : devnetConfig;

const ACCOUNT_SECRET_KEY = "aztec-chess-account-secret";
const ACCOUNT_DEPLOYED_KEY = "aztec-chess-account-deployed";

// Get the SponsoredFPC contract instance (same pattern as deploy.ts)
async function getSponsoredFPCContract() {
  const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
  return instance;
}

// Get or create a persistent account secret in localStorage
// Returns { secret, isNew } where isNew indicates if this is a freshly generated secret
function getOrCreateAccountSecret(): { secret: Fr; isNew: boolean } {
  const stored = localStorage.getItem(ACCOUNT_SECRET_KEY);
  if (stored) {
    try {
      return { secret: Fr.fromString(stored), isNew: false };
    } catch (e) {
      console.warn("Invalid stored account secret, generating new one");
    }
  }

  const secret = Fr.random();
  localStorage.setItem(ACCOUNT_SECRET_KEY, secret.toString());
  return { secret, isNew: true };
}

// Check if account has been deployed (stored in localStorage after successful deployment)
function isAccountDeployed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(ACCOUNT_DEPLOYED_KEY) === "true";
}

// Mark account as deployed in localStorage
function markAccountDeployed(): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(ACCOUNT_DEPLOYED_KEY, "true");
  }
}

export function useAztec() {
  const [wallet, setWallet] = useState<TestWallet | null>(null);
  const [address, setAddress] = useState<AztecAddress | null>(null);
  const [feePaymentMethod, setFeePaymentMethod] = useState<SponsoredFeePaymentMethod | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nodeRef = useRef<any>(null);
  const connectingRef = useRef(false);

  const connect = useCallback(async () => {
    // Prevent multiple simultaneous connections
    if (connectingRef.current) return;
    connectingRef.current = true;

    setIsConnecting(true);
    setError(null);
    try {
      console.log(`Connecting to Aztec devnet at ${networkConfig.nodeUrl}...`);
      const node = createAztecNodeClient(networkConfig.nodeUrl);
      nodeRef.current = node;

      console.log("Creating wallet with client-side PXE...");
      const embeddedWallet = await TestWallet.create(node, {
        proverEnabled: environmentConfig.proverEnabled,
      });

      // Register the SponsoredFPC contract for fee payments
      console.log("Registering SponsoredFPC contract...");
      const sponsoredFPCContract = await getSponsoredFPCContract();
      await embeddedWallet.registerContract(sponsoredFPCContract, SponsoredFPCContractArtifact);
      const paymentMethod = new SponsoredFeePaymentMethod(sponsoredFPCContract.address);
      console.log(`SponsoredFPC registered at ${sponsoredFPCContract.address.toString()}`);

      // Get or create account secret from localStorage
      const { secret: accountSecret, isNew: isNewSecret } = getOrCreateAccountSecret();
      console.log(isNewSecret ? "Generated new account secret" : "Using existing account secret");
      console.log("account secret ", accountSecret);
      // Create account manager with persistent secret
      const signingKey = deriveSigningKey(accountSecret);
      const accountManager = await embeddedWallet.createSchnorrAccount(accountSecret, Fr.ZERO, signingKey);

      const addr = await accountManager.address;

      console.log(`Account address: ${addr.toString()}`);

      // Check on-chain if account is already deployed
      let needsDeploy = true;
      try {
        const { isContractInitialized } = await embeddedWallet!.getContractMetadata(addr);
        if (isContractInitialized) {
          console.log("Account already deployed on-chain");
          needsDeploy = false;
        } else {
          console.log("Account not found on-chain, needs deployment");
        }
      } catch (e) {
        console.log("Could not verify account on-chain, assuming needs deployment");
      }

      // Deploy account if needed
      if (needsDeploy) {
        console.log("Deploying account contract...");
        const deployMethod = await accountManager.getDeployMethod();
        await deployMethod.send({
          from: AztecAddress.ZERO,
          fee: { paymentMethod },
          skipClassPublication: true,
          skipInstancePublication: true,
          contractAddressSalt: Fr.ZERO
        });
        console.log("Account deployed successfully");
      }

      setWallet(embeddedWallet);
      setAddress(addr);
      setFeePaymentMethod(paymentMethod);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to connect";
      setError(msg);
      console.error("Aztec connection error:", e);
    } finally {
      setIsConnecting(false);
      connectingRef.current = false;
    }
  }, []);

  // Auto-connect on mount
  useEffect(() => {
    connect();
  }, [connect]);

  return {
    wallet,
    address,
    node: nodeRef.current,
    feePaymentMethod,
    isConnecting,
    error,
    connect,
  };
}
