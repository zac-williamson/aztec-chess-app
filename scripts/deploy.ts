/**
 * Deployment script for the FogOfWarChess contract.
 *
 * Usage:
 *   npx tsx scripts/deploy.ts
 *
 * This deploys a single canonical chess contract and saves the address
 * to app/config/contract-address.json for the web app to use.
 */

import { createAztecNodeClient } from "@aztec/aztec.js/node";
import { TestWallet } from "@aztec/test-wallet/server";
import { getInitialTestAccountsData } from "@aztec/accounts/testing";
import { FogOfWarChessContract } from "../app/artifacts/FogOfWarChess.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || "http://localhost:8080";
const CONFIG_PATH = path.join(__dirname, "../app/config/contract-address.json");

async function main() {
  console.log("=== FogOfWarChess Contract Deployment ===\n");
  console.log(`Connecting to Aztec node at ${AZTEC_NODE_URL}...`);

  const node = createAztecNodeClient(AZTEC_NODE_URL);

  console.log("Creating wallet...");
  const wallet = await TestWallet.create(node);

  // Use the first test account as the deployer
  const [deployerData] = await getInitialTestAccountsData();
  const deployerAccount = await wallet.createSchnorrAccount(
    deployerData.secret,
    deployerData.salt
  );
  const deployerAddress = (await deployerAccount.getAccount()).getAddress();

  console.log(`Deployer address: ${deployerAddress.toString()}\n`);

  console.log("Deploying FogOfWarChess contract...");
  const contract = await FogOfWarChessContract.deploy(wallet)
    .send({ from: deployerAddress })
    .deployed();

  const contractAddress = contract.address.toString();
  console.log(`\n✅ Contract deployed successfully!`);
  console.log(`   Address: ${contractAddress}\n`);

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
  console.log(`📝 Contract address saved to: ${CONFIG_PATH}`);
  console.log("\nYou can now start the web app with 'npm run dev'");
}

main().catch((e) => {
  console.error("Deployment failed:", e);
  process.exit(1);
});
