/**
 * Deployment script for the FogOfWarChess and HatNFT contracts.
 *
 * Usage:
 *   npx tsx scripts/deploy.ts
 *
 * This deploys:
 * 1. FogOfWarChess contract - the main chess game contract
 * 2. HatNFT contract - the NFT contract for victory hats
 *
 * The contracts are linked together so chess victories can mint hats.
 * Addresses are saved to app/config/ for the web app to use.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { FogOfWarChessContract } from "../app/artifacts/FogOfWarChess.js";
import { HatNFTContract } from "../app/artifacts/HatNFT.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const CHESS_CONFIG_PATH = path.join(__dirname, "../app/config/contract-address.json");
const NFT_CONFIG_PATH = path.join(__dirname, "../app/config/nft-address.json");

async function main() {
  console.log("=== FogOfWarChess & HatNFT Contract Deployment ===\n");
  console.log(`Connecting to Aztec node at ${AZTEC_NODE_URL}...`);

  const node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("Creating wallet...");
const wallet = await TestWallet.create(node, { proverEnabled: true });
  // Use the first test account as the deployer
  const [deployerData] = await getInitialTestAccountsData();
  const deployerAccount = await wallet.createSchnorrAccount(
    deployerData.secret,
    deployerData.salt
  );
  const deployerAddress = (await deployerAccount.getAccount()).getAddress();

  console.log(`Deployer address: ${deployerAddress.toString()}\n`);

  // Deploy FogOfWarChess contract
  console.log("Deploying FogOfWarChess contract...");
  const chessContract = await FogOfWarChessContract.deploy(wallet)
    .send({ from: deployerAddress });

  const chessContractAddress = chessContract.address.toString();
  console.log(`✅ FogOfWarChess deployed: ${chessContractAddress}\n`);

  // Deploy HatNFT contract with chess contract as the authorized minter
  console.log("Deploying HatNFT contract...");
  const hatNFTContract = await HatNFTContract.deploy(wallet, chessContract.address)
    .send({ from: deployerAddress });

  const hatNFTContractAddress = hatNFTContract.address.toString();
  console.log(`✅ HatNFT deployed: ${hatNFTContractAddress}\n`);

  // Link the contracts: tell chess contract about the NFT contract
  console.log("Linking contracts (setting NFT address on chess contract)...");
  await chessContract.methods
    .set_hat_nft_address(hatNFTContract.address)
    .send({ from: deployerAddress });
      console.log("✅ Contracts linked successfully!\n");

  // Save to config files
  const configDir = path.dirname(CHESS_CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const chessConfig = {
    contractAddress: chessContractAddress,
    deployedAt: new Date().toISOString(),
    network: AZTEC_NODE_URL,
  };

  const nftConfig = {
    nftContractAddress: hatNFTContractAddress,
    deployedAt: new Date().toISOString(),
    network: AZTEC_NODE_URL,
  };

  fs.writeFileSync(CHESS_CONFIG_PATH, JSON.stringify(chessConfig, null, 2));
  fs.writeFileSync(NFT_CONFIG_PATH, JSON.stringify(nftConfig, null, 2));

  console.log(`📝 Chess contract address saved to: ${CHESS_CONFIG_PATH}`);
  console.log(`📝 NFT contract address saved to: ${NFT_CONFIG_PATH}`);
  console.log("\nYou can now start the web app with 'npm run dev'");
}

main().catch((e) => {
  console.error("Deployment failed:", e);
  process.exit(1);
});
