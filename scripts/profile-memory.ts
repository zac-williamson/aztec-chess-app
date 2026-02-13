/**
 * Profile memory consumption during account creation.
 *
 * Mirrors the browser flow in useAztec.ts and logs heap/RSS
 * at each step so we can identify where memory spikes occur.
 *
 * Usage:
 *   npx tsx scripts/profile-memory.ts
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { Fr } from "@aztec/aztec.js/fields";
import { TestWallet } from "@aztec/test-wallet/server";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import { SchnorrAccountContract } from "@aztec/accounts/schnorr/lazy";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/config/environment.json"), "utf-8"));
const networkConfig = JSON.parse(fs.readFileSync(path.join(__dirname, `../app/config/networks/${envConfig.network === "local" ? "local" : "devnet"}.json`), "utf-8"));
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || networkConfig.nodeUrl;

interface MemorySnapshot {
  label: string;
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
  arrayBuffers: number;
}

const snapshots: MemorySnapshot[] = [];

function takeSnapshot(label: string): MemorySnapshot {
  // Force GC if available (run with --expose-gc)
  if (global.gc) {
    global.gc();
  }

  const mem = process.memoryUsage();
  const snapshot: MemorySnapshot = {
    label,
    rss: mem.rss,
    heapTotal: mem.heapTotal,
    heapUsed: mem.heapUsed,
    external: mem.external,
    arrayBuffers: mem.arrayBuffers,
  };
  snapshots.push(snapshot);

  const fmt = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  console.log(
    `  [MEM] ${label.padEnd(45)} RSS: ${fmt(mem.rss).padStart(10)}   Heap: ${fmt(mem.heapUsed).padStart(10)} / ${fmt(mem.heapTotal).padStart(10)}   External: ${fmt(mem.external).padStart(10)}   ArrayBuffers: ${fmt(mem.arrayBuffers).padStart(10)}`
  );

  return snapshot;
}

function printSummary() {
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Memory Profile Summary");
  console.log("═══════════════════════════════════════════════════════════\n");

  const fmt = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  const fmtDelta = (bytes: number) => {
    const mb = bytes / 1024 / 1024;
    return mb >= 0 ? `+${mb.toFixed(1)} MB` : `${mb.toFixed(1)} MB`;
  };

  console.log(
    `  ${"Step".padEnd(45)} ${"RSS".padStart(10)}  ${"Delta".padStart(10)}  ${"Heap Used".padStart(10)}  ${"External".padStart(10)}  ${"ArrayBuf".padStart(10)}`
  );
  console.log(`  ${"─".repeat(45)} ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}  ${"─".repeat(10)}`);

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i];
    const delta = i > 0 ? s.rss - snapshots[i - 1].rss : 0;
    console.log(
      `  ${s.label.padEnd(45)} ${fmt(s.rss).padStart(10)}  ${fmtDelta(delta).padStart(10)}  ${fmt(s.heapUsed).padStart(10)}  ${fmt(s.external).padStart(10)}  ${fmt(s.arrayBuffers).padStart(10)}`
    );
  }

  const peak = snapshots.reduce((max, s) => (s.rss > max.rss ? s : max), snapshots[0]);
  const initial = snapshots[0];
  console.log(`\n  Peak RSS: ${fmt(peak.rss)} (at "${peak.label}")`);
  console.log(`  Total RSS growth: ${fmtDelta(peak.rss - initial.rss)}`);
  console.log(`  Peak Heap Used: ${fmt(Math.max(...snapshots.map((s) => s.heapUsed)))}`);
  console.log(`  Peak External: ${fmt(Math.max(...snapshots.map((s) => s.external)))}`);
  console.log(`  Peak ArrayBuffers: ${fmt(Math.max(...snapshots.map((s) => s.arrayBuffers)))}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Fog of War Chess — Memory Profiling (Account Creation)");
  console.log("═══════════════════════════════════════════════════════════\n");
  console.log(`Node: ${AZTEC_NODE_URL}\n`);

  takeSnapshot("Baseline (before anything)");

  // Step 1: Create node client
  const node = createAztecNodeClient(AZTEC_NODE_URL);
  takeSnapshot("After createAztecNodeClient");

  // Step 2: Create TestWallet (mirrors browser TestWallet.create)
  console.log("\nCreating PXE...");
  takeSnapshot("Before TestWallet.create");

  const wallet = await TestWallet.create(node, { proverEnabled: envConfig.proverEnabled });
  takeSnapshot("After TestWallet.create (PXE ready)");

  // Step 3: Register SponsoredFPC
  console.log("\nRegistering SponsoredFPC...");
  const sponsoredFPCContract = await getContractInstanceFromInstantiationParams(
    SponsoredFPCContractArtifact,
    { salt: new Fr(SPONSORED_FPC_SALT) }
  );
  takeSnapshot("After getContractInstanceFromInstantiationParams");

  await wallet.registerContract(sponsoredFPCContract, SponsoredFPCContractArtifact);
  const feePaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPCContract.address);
  takeSnapshot("After registerContract (SponsoredFPC)");

  // Step 4: Create account manager (mirrors createAccount)
  console.log("\nCreating account...");
  const accountSecret = Fr.random();
  const signingKey = deriveSigningKey(accountSecret);
  takeSnapshot("After deriveSigningKey");

  const accountManager = await wallet.createSchnorrAccount(accountSecret, Fr.ZERO, signingKey);
  takeSnapshot("After createSchnorrAccount");

  console.log(`Account address: ${accountManager.address.toString().slice(0, 20)}...`);

  // Step 5: Get deploy method
  console.log("\nPreparing deployment...");
  const deployMethod = await accountManager.getDeployMethod();
  takeSnapshot("After getDeployMethod");

  // Step 6: Deploy account (proof generation + send)
  console.log("\nDeploying account (proving + sending)...");

  // Take snapshots during proving by polling in background
  let proofDone = false;
  const memoryPoller = setInterval(() => {
    if (!proofDone) {
      const mem = process.memoryUsage();
      const fmt = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
      console.log(
        `  [MEM] ${"... proving in progress ...".padEnd(45)} RSS: ${fmt(mem.rss).padStart(10)}   Heap: ${fmt(mem.heapUsed).padStart(10)} / ${fmt(mem.heapTotal).padStart(10)}   External: ${fmt(mem.external).padStart(10)}   ArrayBuffers: ${fmt(mem.arrayBuffers).padStart(10)}`
      );
    }
  }, 2000);

  await deployMethod.send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: feePaymentMethod },
    skipClassPublication: true,
    skipInstancePublication: true,
    wait: { timeout: 300 },
  });

  proofDone = true;
  clearInterval(memoryPoller);
  takeSnapshot("After account deployment complete");

  console.log("Account deployed successfully.\n");

  printSummary();
  process.exit(0);
}

main().catch((e) => {
  console.error("\nMemory profiling failed:", e.message);
  console.error(e);
  printSummary();
  process.exit(1);
});
