/**
 * Profile gate counts for all FogOfWarChess contract functions.
 *
 * Deploys the contract, creates a game, joins, and plays a move —
 * profiling each transaction to report per-circuit gate counts.
 *
 * Usage:
 *   npx tsx scripts/profile-contracts.ts
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { getPublicEvents } from "@aztec/aztec.js/events";
import { Fr } from "@aztec/aztec.js/fields";
import {
  FogOfWarChessContract,
  FogOfWarChessContractArtifact,
  type MoveEvent,
  type NewGame,
} from "../app/artifacts/FogOfWarChess.js";

import { getPXEConfig } from "@aztec/pxe/config";
import { TestWallet } from "@aztec/test-wallet/server";
import { createLogger } from "@aztec/foundation/log";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";
import { AztecAddress } from "@aztec/stdlib/aztec-address";
import type { TxProfileResult } from "@aztec/stdlib/tx";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../app/config/environment.json"), "utf-8"));
const networkConfig = JSON.parse(fs.readFileSync(path.join(__dirname, `../app/config/networks/${envConfig.network === "local" ? "local" : "devnet"}.json`), "utf-8"));
const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || networkConfig.nodeUrl;

const SQUARES = {
  d2: { x: 3, y: 1 },
  d4: { x: 3, y: 3 },
  e7: { x: 4, y: 6 },
  e5: { x: 4, y: 4 },
};

async function getSponsoredFPCContract() {
  return await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
}

async function createTestWallet(node: any, accountSecret: Fr, label: string) {
  const config = getPXEConfig();
  config.proverEnabled = envConfig.proverEnabled;

  const wallet = await TestWallet.create(node, config, {
    proverOrOptions: {
      logger: createLogger(`bb:${label}`),
    },
  });

  const sponsoredFPCContract = await getSponsoredFPCContract();
  await wallet.registerContract(sponsoredFPCContract, SponsoredFPCContractArtifact);
  const feePaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPCContract.address);

  const signingKey = deriveSigningKey(accountSecret);
  const accountManager = await wallet.createSchnorrAccount(accountSecret, Fr.ZERO, signingKey);

  // Profile the account deployment
  const deployMethod = await accountManager.getDeployMethod();
  const profileOpts = { profileMode: "gates" as const, skipProofGeneration: true };
  const deployProfile = await deployMethod.profile({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: feePaymentMethod },
    skipClassPublication: true,
    skipInstancePublication: true,
    ...profileOpts,
  });

  printProfileResult(`deploy_account (${label})`, deployProfile);

  // Actually deploy so the signing key note exists on-chain
  await deployMethod.send({
    from: AztecAddress.ZERO,
    fee: { paymentMethod: feePaymentMethod },
    skipClassPublication: true,
    skipInstancePublication: true,
    wait: { timeout: 300 },
  });
  console.log(`  ${label} account deployed: ${accountManager.address.toString().slice(0, 20)}...`);

  return { wallet, address: accountManager.address, feePaymentMethod, deployProfile };
}

function printProfileResult(label: string, result: TxProfileResult) {
  console.log(`\n┌─── ${label} ───`);
  console.log("│");

  let totalGates = 0;
  for (const step of result.executionSteps) {
    const gates = step.gateCount ?? 0;
    totalGates += gates;
    const gatesStr = gates > 0 ? gates.toLocaleString() : "N/A";
    console.log(`│  ${step.functionName.padEnd(50)} ${gatesStr.padStart(12)} gates`);
  }

  console.log("│");
  console.log(`│  ${"TOTAL".padEnd(50)} ${totalGates.toLocaleString().padStart(12)} gates`);
  console.log(`└${"─".repeat(70)}`);
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Fog of War Chess — Contract Gate Count Profiling");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log(`Node: ${AZTEC_NODE_URL}\n`);
  const node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("Creating wallets...");
  const whiteSecret = Fr.random();
  const blackSecret = Fr.random();

  const { wallet: whiteWallet, address: whiteAddr, feePaymentMethod: whiteFee, deployProfile: whiteDeployProfile } =
    await createTestWallet(node, whiteSecret, "white");
  const { wallet: blackWallet, address: blackAddr, feePaymentMethod: blackFee, deployProfile: blackDeployProfile } =
    await createTestWallet(node, blackSecret, "black");

  console.log(`White: ${whiteAddr.toString().slice(0, 20)}...`);
  console.log(`Black: ${blackAddr.toString().slice(0, 20)}...\n`);

  // ─── Deploy ───
  console.log("Deploying FogOfWarChess contract...");
  const contract = await FogOfWarChessContract.deploy(whiteWallet)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });
  console.log(`Deployed: ${contract.address.toString().slice(0, 20)}...\n`);

  // Register with black
  const contractInstance = await node.getContract(contract.address);
  if (!contractInstance) throw new Error("Contract not found after deploy");
  await blackWallet.registerContract(contractInstance, FogOfWarChessContractArtifact);
  const blackContract = FogOfWarChessContract.at(contract.address, blackWallet);

  const profileOpts = { profileMode: "gates" as const, skipProofGeneration: true };

  // ═══════════════════════════════════════════════
  // Profile: create_game_private
  // ═══════════════════════════════════════════════
  console.log("Profiling create_game_private...");

  const blackEncrypt = Fr.random();
  const blackMask = Fr.random();

  let blackGs = await blackContract.methods.__empty_game_state().simulate({ from: blackAddr });
  let blackUs = await blackContract.methods.__empty_black_state().simulate({ from: blackAddr });
  blackUs.encrypt_secret = blackEncrypt;
  blackUs.mask_secret = blackMask;
  blackGs = await blackContract.methods
    .__commit_to_user_secrets(blackGs, blackEncrypt, blackMask, 1)
    .simulate({ from: blackAddr });

  const createProfile = await blackContract.methods
    .create_game_private(blackEncrypt, blackMask, 0)
    .profile({ from: blackAddr, fee: { paymentMethod: blackFee }, ...profileOpts });

  printProfileResult("create_game_private (Black creates game)", createProfile);

  // Actually send the tx so we can continue the game flow
  const createReceipt = await blackContract.methods
    .create_game_private(blackEncrypt, blackMask, 0)
    .send({ from: blackAddr, fee: { paymentMethod: blackFee } });

  const newGameEvents = await getPublicEvents<NewGame>(
    node,
    FogOfWarChessContract.events.NewGame,
    { fromBlock: createReceipt.blockNumber!, toBlock: (createReceipt.blockNumber! + 1) as any }
  );
  const gameId = newGameEvents.length > 0 ? Number(newGameEvents[0].event.game_id) : 0;
  console.log(`Game created: #${gameId}\n`);

  // ═══════════════════════════════════════════════
  // Profile: join_game_private
  // ═══════════════════════════════════════════════
  console.log("Profiling join_game_private...");

  const whiteEncrypt = Fr.random();
  const whiteMask = Fr.random();

  const secretHashes = await contract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: whiteAddr });
  const blackSecretHashes = [secretHashes[2], secretHashes[3]];

  let whiteGs = await contract.methods.__empty_game_state().simulate({ from: whiteAddr });
  let whiteUs = await contract.methods.__empty_white_state().simulate({ from: whiteAddr });
  whiteUs.encrypt_secret = whiteEncrypt;
  whiteUs.mask_secret = whiteMask;

  whiteGs.mpc_state.user_encrypt_secret_hashes[1] = blackSecretHashes[0];
  whiteGs.mpc_state.user_mask_secret_hashes[1] = blackSecretHashes[1];
  whiteGs = await contract.methods
    .__commit_to_user_secrets(whiteGs, whiteEncrypt, whiteMask, 0)
    .simulate({ from: whiteAddr });

  const joinProfile = await contract.methods
    .join_game_private(gameId, whiteEncrypt, whiteMask, blackSecretHashes, 0)
    .profile({ from: whiteAddr, fee: { paymentMethod: whiteFee }, ...profileOpts });

  printProfileResult("join_game_private (White joins game)", joinProfile);

  // Actually send
  const joinReceipt = await contract.methods
    .join_game_private(gameId, whiteEncrypt, whiteMask, blackSecretHashes, 0)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });
  console.log(`White joined in block ${joinReceipt.blockNumber}\n`);

  // Sync black's state after white joined
  const secretHashesAfter = await blackContract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: blackAddr });

  blackGs = await blackContract.methods.__empty_game_state().simulate({ from: blackAddr });
  blackGs.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  blackGs.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  blackGs.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  blackGs.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  blackUs = await blackContract.methods.__empty_black_state().simulate({ from: blackAddr });
  blackUs.encrypt_secret = blackEncrypt;
  blackUs.mask_secret = blackMask;

  // Sync white's state with both hashes
  whiteGs = await contract.methods.__empty_game_state().simulate({ from: whiteAddr });
  whiteGs.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  whiteGs.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  whiteGs.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  whiteGs.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  whiteUs = await contract.methods.__empty_white_state().simulate({ from: whiteAddr });
  whiteUs.encrypt_secret = whiteEncrypt;
  whiteUs.mask_secret = whiteMask;

  // ═══════════════════════════════════════════════
  // Profile: make_move_white_private (White d2->d4)
  // ═══════════════════════════════════════════════
  console.log("Profiling make_move_white_private (d2 -> d4)...");

  const move1 = await contract.methods
    .__create_move(SQUARES.d2.x, SQUARES.d2.y, SQUARES.d4.x, SQUARES.d4.y)
    .simulate({ from: whiteAddr });

  const moveWhiteProfile = await contract.methods
    .make_move_white_private(gameId, whiteGs, whiteUs, move1)
    .profile({ from: whiteAddr, fee: { paymentMethod: whiteFee }, ...profileOpts });

  printProfileResult("make_move_white_private (White: d2 -> d4)", moveWhiteProfile);

  // Actually send
  const move1Receipt = await contract.methods
    .make_move_white_private(gameId, whiteGs, whiteUs, move1)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });

  const move1Events = await getPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    { fromBlock: move1Receipt.blockNumber!, toBlock: (move1Receipt.blockNumber! + 1) as any }
  );
  if (move1Events.length === 0) throw new Error("No MoveEvent for white's move");

  // Update states for both players
  const isFirstTwo1 = Number(whiteGs.move_count) < 2;
  whiteUs = await contract.methods
    .__update_user_state_from_move(isFirstTwo1, whiteUs, move1, 0)
    .simulate({ from: whiteAddr });
  whiteGs = await contract.methods
    .__update_game_state_from_move(whiteGs, move1Events[0].event.state, 0)
    .simulate({ from: whiteAddr });

  blackGs = await blackContract.methods
    .__update_game_state_from_move(blackGs, move1Events[0].event.state, 0)
    .simulate({ from: blackAddr });
  blackUs = await blackContract.methods
    .__consume_opponent_move(blackGs, blackUs, 1)
    .simulate({ from: blackAddr });

  console.log(`White moved in block ${move1Receipt.blockNumber}\n`);

  // ═══════════════════════════════════════════════
  // Profile: make_move_black_private (Black e7->e5)
  // ═══════════════════════════════════════════════
  console.log("Profiling make_move_black_private (e7 -> e5)...");

  const move2 = await blackContract.methods
    .__create_move(SQUARES.e7.x, SQUARES.e7.y, SQUARES.e5.x, SQUARES.e5.y)
    .simulate({ from: blackAddr });

  const moveBlackProfile = await blackContract.methods
    .make_move_black_private(gameId, blackGs, blackUs, move2)
    .profile({ from: blackAddr, fee: { paymentMethod: blackFee }, ...profileOpts });

  printProfileResult("make_move_black_private (Black: e7 -> e5)", moveBlackProfile);

  // ═══════════════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Summary");
  console.log("═══════════════════════════════════════════════════════════\n");

  const results = [
    { label: "deploy_account", profile: whiteDeployProfile },
    { label: "create_game_private", profile: createProfile },
    { label: "join_game_private", profile: joinProfile },
    { label: "make_move_white_private", profile: moveWhiteProfile },
    { label: "make_move_black_private", profile: moveBlackProfile },
  ];

  for (const { label, profile } of results) {
    const appSteps = profile.executionSteps.filter(
      (s) => !s.functionName.includes("kernel")
    );
    const kernelSteps = profile.executionSteps.filter(
      (s) => s.functionName.includes("kernel")
    );
    const appGates = appSteps.reduce((sum, s) => sum + (s.gateCount ?? 0), 0);
    const kernelGates = kernelSteps.reduce((sum, s) => sum + (s.gateCount ?? 0), 0);
    const totalGates = appGates + kernelGates;

    console.log(
      `  ${label.padEnd(30)} app: ${appGates.toLocaleString().padStart(12)}   kernel: ${kernelGates.toLocaleString().padStart(12)}   total: ${totalGates.toLocaleString().padStart(12)}`
    );
  }

  console.log("\nDone!");
  process.exit(0);
}

main().catch((e) => {
  console.error("\nProfiling failed:", e.message);
  console.error(e);
  process.exit(1);
});
