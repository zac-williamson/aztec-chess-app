/**
 * Integration test for the Fog of War Chess game.
 *
 * This script:
 * 1. Deploys the FogOfWarChess contract
 * 2. White creates a game
 * 3. Black joins the game
 * 4. Plays three moves:
 *    - White: d2 -> d4 (pawn advance)
 *    - Black: e7 -> e5 (pawn advance)
 *    - White: d4 x e5 (pawn captures)
 *
 * Usage:
 *   npx tsx scripts/test-game.ts
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { getDecodedPublicEvents } from "@aztec/aztec.js/events";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const CONFIG_PATH = path.join(__dirname, "../app/config/contract-address.json");

// Chess coordinate helpers
// Board coordinates: (0,0) is a1, (7,7) is h8
// d2 = (3, 1), d4 = (3, 3), e7 = (4, 6), e5 = (4, 4)
const SQUARES = {
  d2: { x: 3, y: 1 },
  d4: { x: 3, y: 3 },
  e7: { x: 4, y: 6 },
  e5: { x: 4, y: 4 },
};

const PIECE_IDS = {
  EMPTY: 0,
  WHITE_PAWN: 1,
  BLACK_PAWN: 2,
  KNIGHT: 3,
  BISHOP: 4,
  ROOK: 5,
  QUEEN: 6,
  KING: 7,
};

async function main() {
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Fog of War Chess - Integration Test");
  console.log("═══════════════════════════════════════════════════════════\n");

  // ─── Connect to Aztec node ───
  console.log(`Connecting to Aztec node at ${AZTEC_NODE_URL}...`);
  const node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("Creating wallet...");
  const wallet = await TestWallet.create(node);

  // Get test accounts
  const [whiteAccountData, blackAccountData] = await getInitialTestAccountsData();

  const whiteAccount = await wallet.createSchnorrAccount(
    whiteAccountData.secret,
    whiteAccountData.salt
  );
  const blackAccount = await wallet.createSchnorrAccount(
    blackAccountData.secret,
    blackAccountData.salt
  );

  const whiteAddress = (await whiteAccount.getAccount()).getAddress();
  const blackAddress = (await blackAccount.getAccount()).getAddress();

  console.log(`White address: ${whiteAddress.toString()}`);
  console.log(`Black address: ${blackAddress.toString()}\n`);

  // ─── Step 1: Deploy contract ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 1: Deploy Contract");
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("Deploying FogOfWarChess contract...");
  const contract = await FogOfWarChessContract.deploy(wallet)
    .send({ from: whiteAddress })
    .deployed();

  const contractAddress = contract.address.toString();
  console.log(`✅ Contract deployed at: ${contractAddress}\n`);

  // Save to config file
  const configDir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const config = {
    contractAddress,
    deployedAt: new Date().toISOString(),
    network: AZTEC_NODE_URL,
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
  console.log(`📝 Contract address saved to: ${CONFIG_PATH}\n`);

  // ─── Step 2: White creates game ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 2: White Creates Game");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Generate random secrets for white
  const whiteEncryptSecret = Fr.random();
  const whiteMaskSecret = Fr.random();
  console.log("White secrets generated (random Fr values)");

  // Initialize white's game state and user state
  let whiteGameState = await contract.methods
    .__empty_game_state()
    .simulate({ from: whiteAddress });
  let whiteUserState = await contract.methods
    .__empty_white_state()
    .simulate({ from: whiteAddress });

  // Set white's secrets
  whiteUserState.encrypt_secret = whiteEncryptSecret;
  whiteUserState.mask_secret = whiteMaskSecret;

  // Commit white's secrets to game state
  whiteGameState = await contract.methods
    .__commit_to_user_secrets(whiteGameState, whiteEncryptSecret, whiteMaskSecret, 0)
    .simulate({ from: whiteAddress });

  // Create game on-chain
  const password = 12345;
  console.log("Creating game on-chain...");
  const createReceipt = await contract.methods
    .create_game_private(whiteEncryptSecret, whiteMaskSecret, password)
    .send({ from: whiteAddress })
    .wait();

  // Parse NewGame event to get game_id
  const newGameEvents = await getDecodedPublicEvents<NewGame>(
    node,
    FogOfWarChessContract.events.NewGame,
    createReceipt.blockNumber!,
    createReceipt.blockNumber! + 1
  );

  const gameId = newGameEvents.length > 0 ? Number(newGameEvents[0].game_id) : 0;
  console.log(`✅ Game created! Game ID: ${gameId}\n`);

  // ─── Step 3: Black joins game ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 3: Black Joins Game");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Generate random secrets for black
  const blackEncryptSecret = Fr.random();
  const blackMaskSecret = Fr.random();
  console.log("Black secrets generated (random Fr values)");

  // Fetch white's secret hashes
  const secretHashesBefore = await contract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: blackAddress });

  const whiteSecretHashes = [secretHashesBefore[0], secretHashesBefore[1]];
  console.log("Fetched white's secret hashes from chain");

  // Initialize black's game state and user state
  let blackGameState = await contract.methods
    .__empty_game_state()
    .simulate({ from: blackAddress });
  let blackUserState = await contract.methods
    .__empty_black_state()
    .simulate({ from: blackAddress });

  // Set black's secrets
  blackUserState.encrypt_secret = blackEncryptSecret;
  blackUserState.mask_secret = blackMaskSecret;

  // Set white's secret hashes in black's game state
  blackGameState.mpc_state.user_encrypt_secret_hashes[0] = whiteSecretHashes[0];
  blackGameState.mpc_state.user_mask_secret_hashes[0] = whiteSecretHashes[1];

  // Commit black's secrets
  blackGameState = await contract.methods
    .__commit_to_user_secrets(blackGameState, blackEncryptSecret, blackMaskSecret, 1)
    .simulate({ from: blackAddress });

  // Join game on-chain
  console.log("Joining game on-chain...");
  const joinReceipt = await contract.methods
    .join_game_private(
      gameId,
      blackEncryptSecret,
      blackMaskSecret,
      whiteSecretHashes,
      password
    )
    .send({ from: blackAddress })
    .wait();
  console.log(`✅ Black joined game in block ${joinReceipt.blockNumber}\n`);

  // ─── White fetches updated secret hashes ───
  console.log("White fetching updated secret hashes...");
  const secretHashesAfter = await contract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: whiteAddress });

  // Rebuild white's game state with both players' hashes
  whiteGameState = await contract.methods
    .__empty_game_state()
    .simulate({ from: whiteAddress });
  whiteGameState.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  whiteGameState.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  whiteGameState.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  whiteGameState.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  // Rebuild white user state
  whiteUserState = await contract.methods
    .__empty_white_state()
    .simulate({ from: whiteAddress });
  whiteUserState.encrypt_secret = whiteEncryptSecret;
  whiteUserState.mask_secret = whiteMaskSecret;

  console.log("✅ White's state synchronized\n");

  // ─── Step 4: White moves pawn d2 -> d4 ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 4: White moves pawn d2 -> d4");
  console.log("═══════════════════════════════════════════════════════════\n");

  const move1 = await contract.methods
    .__create_move(SQUARES.d2.x, SQUARES.d2.y, SQUARES.d4.x, SQUARES.d4.y)
    .simulate({ from: whiteAddress });

  console.log("Sending move transaction...");
  const move1Receipt = await contract.methods
    .make_move_white_private(gameId, whiteGameState, whiteUserState, move1)
    .send({ from: whiteAddress })
    .wait();

  // Get MoveEvent
  const move1Events = await getDecodedPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    move1Receipt.blockNumber!,
    move1Receipt.blockNumber! + 1
  );

  if (move1Events.length === 0) {
    throw new Error("No MoveEvent found for white's move");
  }

  // Update white's states
  const isFirstTwo1 = Number(whiteGameState.move_count) < 2;
  whiteUserState = await contract.methods
    .__update_user_state_from_move(isFirstTwo1, whiteUserState, move1, 0)
    .simulate({ from: whiteAddress });
  whiteGameState = await contract.methods
    .__update_game_state_from_move(whiteGameState, move1Events[0].state, 0)
    .simulate({ from: whiteAddress });

  console.log(`✅ White moved d2 -> d4 in block ${move1Receipt.blockNumber}`);
  console.log(`   Move count: ${Number(whiteGameState.move_count)}\n`);

  // ─── Black consumes white's move ───
  console.log("Black consuming white's move...");
  blackGameState = await contract.methods
    .__update_game_state_from_move(blackGameState, move1Events[0].state, 0)
    .simulate({ from: blackAddress });
  blackUserState = await contract.methods
    .__consume_opponent_move(blackGameState, blackUserState, 1)
    .simulate({ from: blackAddress });
  console.log("✅ Black's state updated\n");

  // ─── Step 5: Black moves pawn e7 -> e5 ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 5: Black moves pawn e7 -> e5");
  console.log("═══════════════════════════════════════════════════════════\n");

  const move2 = await contract.methods
    .__create_move(SQUARES.e7.x, SQUARES.e7.y, SQUARES.e5.x, SQUARES.e5.y)
    .simulate({ from: blackAddress });

  console.log("Sending move transaction...");
  const move2Receipt = await contract.methods
    .make_move_black_private(gameId, blackGameState, blackUserState, move2)
    .send({ from: blackAddress })
    .wait();

  // Get MoveEvent
  const move2Events = await getDecodedPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    move2Receipt.blockNumber!,
    move2Receipt.blockNumber! + 1
  );

  if (move2Events.length === 0) {
    throw new Error("No MoveEvent found for black's move");
  }

  // Update black's states
  const isFirstTwo2 = Number(blackGameState.move_count) < 2;
  blackUserState = await contract.methods
    .__update_user_state_from_move(isFirstTwo2, blackUserState, move2, 1)
    .simulate({ from: blackAddress });
  blackGameState = await contract.methods
    .__update_game_state_from_move(blackGameState, move2Events[0].state, 1)
    .simulate({ from: blackAddress });

  console.log(`✅ Black moved e7 -> e5 in block ${move2Receipt.blockNumber}`);
  console.log(`   Move count: ${Number(blackGameState.move_count)}\n`);

  // ─── White consumes black's move ───
  console.log("White consuming black's move...");
  whiteGameState = await contract.methods
    .__update_game_state_from_move(whiteGameState, move2Events[0].state, 1)
    .simulate({ from: whiteAddress });
  whiteUserState = await contract.methods
    .__consume_opponent_move(whiteGameState, whiteUserState, 0)
    .simulate({ from: whiteAddress });
  console.log("✅ White's state updated\n");

  // ─── Step 6: White captures pawn d4 x e5 ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Step 6: White captures pawn d4 x e5");
  console.log("═══════════════════════════════════════════════════════════\n");

  // Verify the target square has black's pawn (from white's perspective)
  const targetIndex = SQUARES.e5.x + SQUARES.e5.y * 8;
  const targetPiece = whiteUserState.game_state[targetIndex];
  console.log(`Target square e5 (index ${targetIndex}):`);
  console.log(`  Piece ID: ${Number(targetPiece.id)} (expected: ${PIECE_IDS.BLACK_PAWN} = BLACK_PAWN)`);
  console.log(`  Player ID: ${Number(targetPiece.player_id)} (expected: 1 = Black)\n`);

  const move3 = await contract.methods
    .__create_move(SQUARES.d4.x, SQUARES.d4.y, SQUARES.e5.x, SQUARES.e5.y)
    .simulate({ from: whiteAddress });

  console.log("Sending capture transaction...");
  const move3Receipt = await contract.methods
    .make_move_white_private(gameId, whiteGameState, whiteUserState, move3)
    .send({ from: whiteAddress })
    .wait();

  // Get MoveEvent
  const move3Events = await getDecodedPublicEvents<MoveEvent>(
    node,
    FogOfWarChessContract.events.MoveEvent,
    move3Receipt.blockNumber!,
    move3Receipt.blockNumber! + 1
  );

  if (move3Events.length === 0) {
    throw new Error("No MoveEvent found for white's capture");
  }

  // Update white's states
  const isFirstTwo3 = Number(whiteGameState.move_count) < 2;
  whiteUserState = await contract.methods
    .__update_user_state_from_move(isFirstTwo3, whiteUserState, move3, 0)
    .simulate({ from: whiteAddress });
  whiteGameState = await contract.methods
    .__update_game_state_from_move(whiteGameState, move3Events[0].state, 0)
    .simulate({ from: whiteAddress });

  console.log(`✅ White captured d4 x e5 in block ${move3Receipt.blockNumber}`);
  console.log(`   Move count: ${Number(whiteGameState.move_count)}\n`);

  // Verify the capture
  const e5AfterCapture = whiteUserState.game_state[targetIndex];
  console.log("Verification - e5 square after capture:");
  console.log(`  Piece ID: ${Number(e5AfterCapture.id)} (expected: ${PIECE_IDS.WHITE_PAWN} = WHITE_PAWN)`);
  console.log(`  Player ID: ${Number(e5AfterCapture.player_id)} (expected: 0 = White)\n`);

  // ─── Final validation ───
  console.log("═══════════════════════════════════════════════════════════");
  console.log("  Final Validation");
  console.log("═══════════════════════════════════════════════════════════\n");

  let allPassed = true;

  // Check move count
  const finalMoveCount = Number(whiteGameState.move_count);
  if (finalMoveCount === 3) {
    console.log(`✅ Move count correct: ${finalMoveCount}`);
  } else {
    console.log(`❌ Move count incorrect: ${finalMoveCount} (expected 3)`);
    allPassed = false;
  }

  // Check game_ended is false
  const gameEnded =
    whiteGameState.game_ended === true ||
    (typeof whiteGameState.game_ended === "bigint" && whiteGameState.game_ended !== 0n) ||
    (typeof whiteGameState.game_ended === "number" && whiteGameState.game_ended !== 0);

  if (!gameEnded) {
    console.log("✅ Game not ended (correct - no king captured)");
  } else {
    console.log("❌ Game ended unexpectedly");
    allPassed = false;
  }

  // Check white pawn is on e5
  if (
    Number(e5AfterCapture.id) === PIECE_IDS.WHITE_PAWN &&
    Number(e5AfterCapture.player_id) === 0
  ) {
    console.log("✅ White pawn correctly on e5 after capture");
  } else {
    console.log("❌ White pawn not on e5 after capture");
    allPassed = false;
  }

  // Check d4 is empty
  const d4Index = SQUARES.d4.x + SQUARES.d4.y * 8;
  const d4AfterMove = whiteUserState.game_state[d4Index];
  if (Number(d4AfterMove.id) === PIECE_IDS.EMPTY) {
    console.log("✅ d4 is empty after pawn moved");
  } else {
    console.log(`❌ d4 not empty (piece id: ${Number(d4AfterMove.id)})`);
    allPassed = false;
  }

  console.log("\n═══════════════════════════════════════════════════════════");
  if (allPassed) {
    console.log("  ✅ ALL TESTS PASSED!");
  } else {
    console.log("  ❌ SOME TESTS FAILED");
    process.exit(1);
  }
  console.log("═══════════════════════════════════════════════════════════\n");

  console.log("Contract address for future use:", contractAddress);
}

main().catch((e) => {
  console.error("\n❌ Test failed with error:", e.message);
  console.error(e);
  process.exit(1);
});
