/**
 * Test: Proof ordering — validates that proofs submitted out of order
 * cause reverts, and that the correct ordering succeeds.
 *
 * This reproduces the bug where the relay decoupling allowed players to
 * queue multiple proofs, but submitting proof #N before proof #N-1 lands
 * on-chain causes a revert because:
 *   assert(game_hash == initial_hash)  // main.nr:286
 *
 * The test:
 * 1. Sets up a game (deploy, create, join)
 * 2. Test A: Submit white's move #0, then black's move #1 — should succeed (correct order)
 * 3. Test B: Try to submit white's move #2 BEFORE black's move #1 lands — should revert
 *
 * Usage:
 *   npx tsx scripts/test-proof-ordering.ts
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
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { getPXEConfig } from "@aztec/pxe/config";
import { TestWallet } from "@aztec/test-wallet/server";
import { createLogger } from "@aztec/foundation/log";
import { SponsoredFPCContractArtifact } from "@aztec/noir-contracts.js/SponsoredFPC";
import { SponsoredFeePaymentMethod } from "@aztec/aztec.js/fee";
import { SPONSORED_FPC_SALT } from "@aztec/constants";
import { getContractInstanceFromInstantiationParams } from "@aztec/stdlib/contract";

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
  e2: { x: 4, y: 1 },
  e4: { x: 4, y: 3 },
  d7: { x: 3, y: 6 },
  d5: { x: 3, y: 5 },
};

async function getSponsoredFPCContract() {
  return await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });
}

async function createTestWallet(
  node: any,
  accountSecret: Fr,
  label: string
): Promise<{ wallet: TestWallet; address: any; feePaymentMethod: SponsoredFeePaymentMethod }> {
  const config = getPXEConfig();
  config.proverEnabled = envConfig.proverEnabled;

  const wallet = await TestWallet.create(node, config, {
    proverOrOptions: { logger: createLogger(`bb:${label}`) },
  });

  const sponsoredFPCContract = await getSponsoredFPCContract();
  await wallet.registerContract(sponsoredFPCContract, SponsoredFPCContractArtifact);
  const feePaymentMethod = new SponsoredFeePaymentMethod(sponsoredFPCContract.address);

  const signingKey = deriveSigningKey(accountSecret);
  const accountManager = await wallet.createSchnorrAccount(accountSecret, Fr.ZERO, signingKey);
  const address = accountManager.address;

  return { wallet, address, feePaymentMethod };
}

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Proof Ordering Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  const node = createAztecNodeClient(AZTEC_NODE_URL);
  console.log(`Connected to ${AZTEC_NODE_URL}`);

  // ─── Setup wallets ───
  console.log("Creating wallets...");
  const whiteSecret = new Fr(10n);
  const blackSecret = new Fr(11n);

  const { wallet: whiteWallet, address: whiteAddr, feePaymentMethod: whiteFee } =
    await createTestWallet(node, whiteSecret, "white");
  const { wallet: blackWallet, address: blackAddr, feePaymentMethod: blackFee } =
    await createTestWallet(node, blackSecret, "black");

  console.log(`White: ${whiteAddr}`);
  console.log(`Black: ${blackAddr}\n`);

  // ─── Deploy contract ───
  console.log("Deploying contract...");
  const whiteContract = await FogOfWarChessContract.deploy(whiteWallet)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });
  console.log(`Contract: ${whiteContract.address}\n`);

  const contractInstance = await node.getContract(whiteContract.address);
  if (!contractInstance) throw new Error("Contract not found");
  await blackWallet.registerContract(contractInstance, FogOfWarChessContractArtifact);
  const blackContract = FogOfWarChessContract.at(whiteContract.address, blackWallet);

  // ─── Create and join game ───
  console.log("Creating game...");
  const whiteEncrypt = Fr.random();
  const whiteMask = Fr.random();
  const password = 99999;

  const createReceipt = await whiteContract.methods
    .create_game_private(whiteEncrypt, whiteMask, password)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });

  const newGameEvents = await getPublicEvents<NewGame>(
    node,
    FogOfWarChessContract.events.NewGame,
    { fromBlock: createReceipt.blockNumber!, toBlock: (createReceipt.blockNumber! + 1) as any }
  );
  const gameId = Number(newGameEvents[0].event.game_id);
  console.log(`Game ID: ${gameId}`);

  const blackEncrypt = Fr.random();
  const blackMask = Fr.random();

  const secretHashes = await blackContract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: blackAddr });

  console.log("Black joining...");
  await blackContract.methods
    .join_game_private(gameId, blackEncrypt, blackMask, [secretHashes[0], secretHashes[1]], password)
    .send({ from: blackAddr, fee: { paymentMethod: blackFee } });

  // ─── Initialize game state for both players ───
  const secretHashesAfter = await whiteContract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: whiteAddr });

  let wGs = await whiteContract.methods.__empty_game_state().simulate({ from: whiteAddr });
  let wUs = await whiteContract.methods.__empty_white_state().simulate({ from: whiteAddr });
  wUs.encrypt_secret = whiteEncrypt;
  wUs.mask_secret = whiteMask;
  wGs.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  wGs.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  wGs.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  wGs.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  let bGs = await blackContract.methods.__empty_game_state().simulate({ from: blackAddr });
  let bUs = await blackContract.methods.__empty_black_state().simulate({ from: blackAddr });
  bUs.encrypt_secret = blackEncrypt;
  bUs.mask_secret = blackMask;
  bGs.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  bGs.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  bGs.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  bGs.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  console.log("Game ready.\n");

  // ═══════════════════════════════════════════════════════════
  //  TEST A: Correct ordering — move #0 then move #1
  // ═══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  TEST A: Correct proof ordering (sequential)");
  console.log("═══════════════════════════════════════════════════════════\n");

  // White move #0: d2 -> d4
  const move0Data = await whiteContract.methods
    .__create_move(SQUARES.d2.x, SQUARES.d2.y, SQUARES.d4.x, SQUARES.d4.y)
    .simulate({ from: whiteAddr });

  // Snapshot state for proof (BEFORE updating local state)
  const wGs0 = { ...wGs };
  const wUs0 = { ...wUs };

  console.log("White: submitting move #0 proof (d2->d4)...");
  const move0Receipt = await whiteContract.methods
    .make_move_white_private(gameId, wGs0, wUs0, move0Data)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });
  console.log(`✅ Move #0 proven at block ${move0Receipt.blockNumber}`);

  // Get MoveEvent and update local state
  const move0Events = await getPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    { fromBlock: move0Receipt.blockNumber!, toBlock: (move0Receipt.blockNumber! + 1) as any }
  );
  const move0Output = move0Events[0].event.state;

  wUs = await whiteContract.methods
    .__update_user_state_from_move(true, wUs, move0Data, 0)
    .simulate({ from: whiteAddr });
  wGs = await whiteContract.methods
    .__update_game_state_from_move(wGs, move0Output, 0)
    .simulate({ from: whiteAddr });

  // Black consumes move #0
  bGs = await blackContract.methods
    .__update_game_state_from_move(bGs, move0Output, 0)
    .simulate({ from: blackAddr });
  bUs = await blackContract.methods
    .__consume_opponent_move(bGs, bUs, 1)
    .simulate({ from: blackAddr });

  // Black move #1: e7 -> e5
  const move1Data = await blackContract.methods
    .__create_move(SQUARES.e7.x, SQUARES.e7.y, SQUARES.e5.x, SQUARES.e5.y)
    .simulate({ from: blackAddr });

  const bGs1 = { ...bGs };
  const bUs1 = { ...bUs };

  console.log("Black: submitting move #1 proof (e7->e5)...");
  const move1Receipt = await blackContract.methods
    .make_move_black_private(gameId, bGs1, bUs1, move1Data)
    .send({ from: blackAddr, fee: { paymentMethod: blackFee } });
  console.log(`✅ Move #1 proven at block ${move1Receipt.blockNumber}`);

  // Update local state
  const move1Events = await getPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    { fromBlock: move1Receipt.blockNumber!, toBlock: (move1Receipt.blockNumber! + 1) as any }
  );
  const move1Output = move1Events[0].event.state;

  bUs = await blackContract.methods
    .__update_user_state_from_move(true, bUs, move1Data, 1)
    .simulate({ from: blackAddr });
  bGs = await blackContract.methods
    .__update_game_state_from_move(bGs, move1Output, 1)
    .simulate({ from: blackAddr });

  // White consumes move #1
  wGs = await whiteContract.methods
    .__update_game_state_from_move(wGs, move1Output, 1)
    .simulate({ from: whiteAddr });
  wUs = await whiteContract.methods
    .__consume_opponent_move(wGs, wUs, 0)
    .simulate({ from: whiteAddr });

  console.log("✅ TEST A PASSED: Sequential proofs succeed\n");

  // ═══════════════════════════════════════════════════════════
  //  TEST B: Wrong ordering — white move #2 BEFORE black move #1 is on-chain
  //  (We simulate this by preparing white's proof with current state, then
  //   submitting it without waiting for any intermediate opponent proof.)
  //
  //  In this test, we prepare TWO moves ahead and try to submit the second
  //  one with the game_hash from before the first one landed.
  // ═══════════════════════════════════════════════════════════
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  TEST B: Out-of-order proof should revert");
  console.log("═══════════════════════════════════════════════════════════\n");

  // White move #2: e2 -> e4  (prepare but DON'T submit yet)
  const move2Data = await whiteContract.methods
    .__create_move(SQUARES.e2.x, SQUARES.e2.y, SQUARES.e4.x, SQUARES.e4.y)
    .simulate({ from: whiteAddr });

  const wGs2 = { ...wGs };
  const wUs2 = { ...wUs };

  // Compute move #2 output locally (like the relay decoupling does)
  const move2Output = await whiteContract.methods
    .__compute_move_output(wGs2, wUs2, move2Data, 0)
    .simulate({ from: whiteAddr });

  // Update local state as if move #2 already happened (instant relay approach)
  wUs = await whiteContract.methods
    .__update_user_state_from_move(false, wUs, move2Data, 0)
    .simulate({ from: whiteAddr });
  wGs = await whiteContract.methods
    .__update_game_state_from_move(wGs, move2Output, 0)
    .simulate({ from: whiteAddr });

  // Black consumes move #2 via relay (locally, no on-chain proof yet)
  bGs = await blackContract.methods
    .__update_game_state_from_move(bGs, move2Output, 0)
    .simulate({ from: blackAddr });
  bUs = await blackContract.methods
    .__consume_opponent_move(bGs, bUs, 1)
    .simulate({ from: blackAddr });

  // Black move #3: d7 -> d5  (prepare locally)
  const move3Data = await blackContract.methods
    .__create_move(SQUARES.d7.x, SQUARES.d7.y, SQUARES.d5.x, SQUARES.d5.y)
    .simulate({ from: blackAddr });

  const bGs3 = { ...bGs };
  const bUs3 = { ...bUs };

  // Now try to submit black's move #3 proof BEFORE white's move #2 proof
  // This should FAIL because the on-chain game_hash still reflects move #1,
  // but black's proof #3 expects the hash after move #2.
  console.log("Black: submitting move #3 proof BEFORE move #2 is on-chain...");
  let outOfOrderReverted = false;
  try {
    await blackContract.methods
      .make_move_black_private(gameId, bGs3, bUs3, move3Data)
      .send({ from: blackAddr, fee: { paymentMethod: blackFee } });
    console.log("❌ Move #3 succeeded (should have reverted!)");
  } catch (e: any) {
    outOfOrderReverted = true;
    console.log(`✅ Move #3 correctly reverted: ${e.message?.slice(0, 100)}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  TEST C: Correct ordering after waiting — submit #2 first, then #3
  // ═══════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  TEST C: Submit proofs in correct order after gating");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Now submit white's move #2 proof (which was queued)
  console.log("White: submitting move #2 proof (e2->e4)...");
  const move2Receipt = await whiteContract.methods
    .make_move_white_private(gameId, wGs2, wUs2, move2Data)
    .send({ from: whiteAddr, fee: { paymentMethod: whiteFee } });
  console.log(`✅ Move #2 proven at block ${move2Receipt.blockNumber}`);

  // NOW submit black's move #3 — the on-chain hash should be correct
  console.log("Black: submitting move #3 proof (d7->d5) AFTER move #2 is on-chain...");
  let correctOrderSucceeded = false;
  try {
    const move3Receipt = await blackContract.methods
      .make_move_black_private(gameId, bGs3, bUs3, move3Data)
      .send({ from: blackAddr, fee: { paymentMethod: blackFee } });
    correctOrderSucceeded = true;
    console.log(`✅ Move #3 proven at block ${move3Receipt.blockNumber}`);
  } catch (e: any) {
    console.log(`❌ Move #3 failed unexpectedly: ${e.message?.slice(0, 100)}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  Results
  // ═══════════════════════════════════════════════════════════
  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("  Results");
  console.log("═══════════════════════════════════════════════════════════\n");

  let allPassed = true;

  if (outOfOrderReverted) {
    console.log("✅ TEST B: Out-of-order proof correctly reverted");
  } else {
    console.log("❌ TEST B: Out-of-order proof did NOT revert (BUG!)");
    allPassed = false;
  }

  if (correctOrderSucceeded) {
    console.log("✅ TEST C: Correctly-ordered proof succeeded after gating");
  } else {
    console.log("❌ TEST C: Correctly-ordered proof failed unexpectedly");
    allPassed = false;
  }

  console.log(`\n  Move count: 4 moves played (0, 1, 2, 3)`);
  console.log(`  The bug: submitting proof #3 before proof #2 causes revert`);
  console.log(`  The fix: proof processor gates on lastProvenMove, waits for`);
  console.log(`           opponent's MOVE_PROVEN before submitting next proof\n`);

  if (allPassed) {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ✅ ALL TESTS PASSED!");
    console.log("═══════════════════════════════════════════════════════════\n");
  } else {
    console.log("═══════════════════════════════════════════════════════════");
    console.log("  ❌ SOME TESTS FAILED");
    console.log("═══════════════════════════════════════════════════════════\n");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("\n❌ Test failed with error:", e.message);
  console.error(e);
  process.exit(1);
});
