/**
 * Test script to reproduce the makeMove transaction revert issue.
 * Run with: node --experimental-json-modules test-game.mjs
 *
 * Or copy to /tmp/aztec-chess and run from there with the working setup.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { EmbeddedWallet } from "@aztec/wallets/embedded";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { Fr } from "@aztec/aztec.js/fields";
import { getDecodedPublicEvents } from "@aztec/aztec.js/events";

// We'll dynamically import the contract
const { FogOfWarChessContract } = await import("./app/artifacts/FogOfWarChess.js");

async function main() {
  console.log("Connecting to Aztec node...");
  const node = createAztecNodeClient("http://localhost:8080");

  console.log("Creating wallet...");
  const wallet = await EmbeddedWallet.create(node, { ephemeral: true });

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

  console.log("White address:", whiteAddress.toString());
  console.log("Black address:", blackAddress.toString());

  // ─── Deploy contract ───
  console.log("\n=== Deploying contract ===");
  const contract = await FogOfWarChessContract.deploy(wallet)
    .send({ from: whiteAddress })
    .deployed();
  console.log("Contract deployed at:", contract.address.toString());

  // ─── White creates game ───
  console.log("\n=== White creating game ===");

  // Generate random secrets for white
  const whiteEncryptSecret = Fr.random();
  const whiteMaskSecret = Fr.random();
  console.log("White encrypt secret:", whiteEncryptSecret.toString());
  console.log("White mask secret:", whiteMaskSecret.toString());

  // Create game on-chain
  const password = 12345;
  const createReceipt = await contract.methods
    .create_game_private(whiteEncryptSecret, whiteMaskSecret, password)
    .send({ from: whiteAddress })
    .wait();
  console.log("Game created in block:", createReceipt.blockNumber);

  // Get game ID (should be 0 for first game)
  const gameId = 0;
  console.log("Game ID:", gameId);

  // ─── Black joins game ───
  console.log("\n=== Black joining game ===");

  // Generate random secrets for black
  const blackEncryptSecret = Fr.random();
  const blackMaskSecret = Fr.random();
  console.log("Black encrypt secret:", blackEncryptSecret.toString());
  console.log("Black mask secret:", blackMaskSecret.toString());

  // Fetch white's secret hashes
  const secretHashesBefore = await contract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: blackAddress });
  console.log("Secret hashes before join:", secretHashesBefore);

  const whiteSecretHashes = [secretHashesBefore[0], secretHashesBefore[1]];

  // Join game
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
  console.log("Black joined in block:", joinReceipt.blockNumber);

  // ─── Fetch updated secret hashes ───
  console.log("\n=== Fetching updated secret hashes ===");
  const secretHashesAfter = await contract.methods
    .__get_game_secret_hashes(gameId)
    .simulate({ from: whiteAddress });
  console.log("Secret hashes after join:");
  console.log("  [0] White encrypt hash:", secretHashesAfter[0].toString());
  console.log("  [1] White mask hash:", secretHashesAfter[1].toString());
  console.log("  [2] Black encrypt hash:", secretHashesAfter[2].toString());
  console.log("  [3] Black mask hash:", secretHashesAfter[3].toString());

  // ─── White prepares to play ───
  console.log("\n=== White preparing game state ===");

  // Build fresh game state (matching what black did when joining)
  let gameState = await contract.methods
    .__empty_game_state()
    .simulate({ from: whiteAddress });

  // Set both players' secret hashes
  gameState.mpc_state.user_encrypt_secret_hashes[0] = secretHashesAfter[0];
  gameState.mpc_state.user_mask_secret_hashes[0] = secretHashesAfter[1];
  gameState.mpc_state.user_encrypt_secret_hashes[1] = secretHashesAfter[2];
  gameState.mpc_state.user_mask_secret_hashes[1] = secretHashesAfter[3];

  console.log("Game state user_encrypt_secret_hashes:",
    gameState.mpc_state.user_encrypt_secret_hashes.map(h => h.toString()));
  console.log("Game state user_mask_secret_hashes:",
    gameState.mpc_state.user_mask_secret_hashes.map(h => h.toString()));

  // Build white user state
  let whiteState = await contract.methods
    .__empty_white_state()
    .simulate({ from: whiteAddress });
  whiteState.encrypt_secret = whiteEncryptSecret;
  whiteState.mask_secret = whiteMaskSecret;

  console.log("White user state secrets:", {
    encrypt: whiteState.encrypt_secret.toString(),
    mask: whiteState.mask_secret.toString(),
  });

  // ─── White makes move: d2 to d4 (pawn) ───
  console.log("\n=== White making move: d2 -> d4 ===");

  // d2 = (3, 1), d4 = (3, 3) in 0-indexed coordinates
  const fromX = 3, fromY = 1, toX = 3, toY = 3;

  const moveData = await contract.methods
    .__create_move(fromX, fromY, toX, toY)
    .simulate({ from: whiteAddress });
  console.log("Move data:", moveData);

  // Make the move
  console.log("Sending make_move_white_private transaction...");
  try {
    const moveReceipt = await contract.methods
      .make_move_white_private(gameId, gameState, whiteState, moveData)
      .send({ from: whiteAddress })
      .wait();
    console.log("Move successful! Block:", moveReceipt.blockNumber);

    // Get move event
    const moveEvents = await getDecodedPublicEvents(
      node,
      FogOfWarChessContract.events.MoveEvent,
      moveReceipt.blockNumber,
      moveReceipt.blockNumber + 1
    );
    console.log("Move events:", moveEvents.length);
  } catch (e) {
    console.error("\n❌ Move failed!");
    console.error("Error:", e.message);
    if (e.cause) {
      console.error("Cause:", e.cause);
    }
  }
}

main().catch(console.error);
