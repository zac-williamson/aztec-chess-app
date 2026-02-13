/**
 * Test: Oracle version compatibility.
 *
 * Verifies that compiled contract artifacts are compatible with the PXE's
 * oracle version. The aztec CLI (nargo) and npm packages must be at the
 * same version, otherwise the Noir-compiled oracle version constant won't
 * match the PXE's ORACLE_VERSION.
 *
 * Usage:
 *   npx tsx scripts/test-oracle-version.ts
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { Fr } from "@aztec/aztec.js/fields";
import { TestWallet } from "@aztec/test-wallet/server";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
} from "../app/artifacts/FogOfWarChess.js";
import {
  HatNFTContract,
  HatNFTContractArtifact,
} from "../app/artifacts/HatNFT.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envConfig = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../app/config/environment.json"), "utf-8")
);
const networkConfig = JSON.parse(
  fs.readFileSync(
    path.join(
      __dirname,
      `../app/config/networks/${envConfig.network === "local" ? "local" : "devnet"}.json`
    ),
    "utf-8"
  )
);
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || networkConfig.nodeUrl;

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Oracle Version Compatibility Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  const node = createAztecNodeClient(AZTEC_NODE_URL);
  console.log(`Node: ${AZTEC_NODE_URL}`);

  // Create wallet
  const wallet = await TestWallet.create(node, { proverEnabled: envConfig.proverEnabled });

  // Register SponsoredFPC
  const sponsoredFPC = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
  await wallet.registerContract(sponsoredFPC, SponsoredFPCContractArtifact);
  const feePaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPC.address);

  // Create account
  const secret = Fr.random();
  const accountManager = await wallet.createSchnorrAccount(secret, Fr.ZERO, deriveSigningKey(secret));
  const address = accountManager.address;

  let allPassed = true;

  // ─── Test 1: FogOfWarChess artifact oracle version ───
  console.log("\nTest 1: FogOfWarChess utility function oracle version...");
  try {
    const chessContract = await FogOfWarChessContract.deploy(wallet)
      .send({ from: address, fee: { paymentMethod: feePaymentMethod } });
    // Call a utility function — this triggers the oracle version check
    const state = await chessContract.methods
      .__empty_game_state()
      .simulate({ from: address });
    console.log("  ✅ FogOfWarChess oracle version compatible");
  } catch (e: any) {
    if (e.message?.includes("Incompatible oracle version")) {
      console.log(`  ❌ FogOfWarChess oracle version MISMATCH: ${e.message}`);
      allPassed = false;
    } else {
      console.log(`  ❌ FogOfWarChess unexpected error: ${e.message?.slice(0, 120)}`);
      allPassed = false;
    }
  }

  // ─── Test 2: HatNFT artifact oracle version ───
  console.log("\nTest 2: HatNFT utility function oracle version...");
  try {
    const hatContract = await HatNFTContract.deploy(wallet, address)
      .send({ from: address, fee: { paymentMethod: feePaymentMethod } });
    // Call a utility function — triggers oracle version check
    const supply = await hatContract.methods
      .total_supply()
      .simulate({ from: address });
    console.log(`  ✅ HatNFT oracle version compatible (total_supply: ${supply})`);
  } catch (e: any) {
    if (e.message?.includes("Incompatible oracle version")) {
      console.log(`  ❌ HatNFT oracle version MISMATCH: ${e.message}`);
      allPassed = false;
    } else {
      console.log(`  ❌ HatNFT unexpected error: ${e.message?.slice(0, 120)}`);
      allPassed = false;
    }
  }

  // ─── Results ───
  console.log("\n═══════════════════════════════════════════════════════════");
  if (allPassed) {
    console.log("  ✅ ALL TESTS PASSED — oracle versions are compatible");
  } else {
    console.log("  ❌ ORACLE VERSION MISMATCH");
    console.log("  Fix: update aztec CLI to match npm packages, then recompile:");
    console.log("    aztec-up install <version>");
    console.log("    aztec compile (from aztec-contracts/)");
    process.exit(1);
  }
  console.log("═══════════════════════════════════════════════════════════\n");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nTest failed:", e.message);
  process.exit(1);
});
