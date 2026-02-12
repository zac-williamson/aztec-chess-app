/**
 * Deployment script for the FogOfWarChess and HatNFT contracts.
 *
 * Usage:
 *   npx tsx scripts/deploy.ts
 *
 * Environment variables:
 *   AZTEC_NODE_URL - Override the Aztec node URL (default: devnet)
 *   ACCOUNT_SECRET - Override the deployer account secret (default: Fr.ZERO)
 *
 * This deploys:
 * 1. FogOfWarChess contract - the main chess game contract
 * 2. HatNFT contract - the NFT contract for victory hats
 *
 * The contracts are linked together so chess victories can mint hats.
 * Addresses are saved to app/config/ for the web app to use.
 */

import { SponsoredFPCContractArtifact } from '@aztec/noir-contracts.js/SponsoredFPC';
import { AztecAddress } from '@aztec/stdlib/aztec-address';
import { SchnorrAccountContract } from "@aztec/accounts/schnorr/lazy";
import { deriveSigningKey } from "@aztec/stdlib/keys";
import { Fr } from "@aztec/aztec.js/fields";
import { FogOfWarChessContract } from "../app/artifacts/FogOfWarChess.js";
import { HatNFTContract } from "../app/artifacts/HatNFT.js";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import { getPXEConfig, type PXEConfig } from "@aztec/pxe/config";
import { createPXE } from "@aztec/pxe/client/lazy";
import { AccountManager } from "@aztec/aztec.js/wallet";
import { TestWallet } from "@aztec/test-wallet/server";
import { SponsoredFeePaymentMethod } from '@aztec/aztec.js/fee';
import { createAztecNodeClient, type AztecNode } from '@aztec/aztec.js/node';
import { createLogger } from '@aztec/foundation/log';
import { SPONSORED_FPC_SALT } from '@aztec/constants';
import { getContractInstanceFromInstantiationParams } from '@aztec/stdlib/contract';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read environment config — single source of truth for network + prover settings
const ENV_CONFIG_PATH = path.join(__dirname, "../app/config/environment.json");
const envConfig = JSON.parse(fs.readFileSync(ENV_CONFIG_PATH, "utf-8"));
const NETWORK_CONFIG_PATH = path.join(__dirname, `../app/config/networks/${envConfig.network === "local" ? "local" : "devnet"}.json`);
const networkConfig = JSON.parse(fs.readFileSync(NETWORK_CONFIG_PATH, "utf-8"));

const AZTEC_NODE_URL = process.env.AZTEC_NODE_URL || networkConfig.nodeUrl;

const CHESS_CONFIG_PATH = path.join(__dirname, "../app/config/contract-address.json");
const NFT_CONFIG_PATH = path.join(__dirname, "../app/config/nft-address.json");
const DEVNET_CONFIG_PATH = NETWORK_CONFIG_PATH;

const PXE_STORE_DIR = path.join(import.meta.dirname, '.pxe-store');

const PROVER_ENABLED = process.env.PROVER_ENABLED !== undefined
  ? process.env.PROVER_ENABLED !== 'false'
  : envConfig.proverEnabled;

console.log('prover enabled = ', PROVER_ENABLED);
async function setupWallet(aztecNode: AztecNode) {
  fs.rmSync(PXE_STORE_DIR, { recursive: true, force: true });

  const config = getPXEConfig();
  //config.dataDirectory = PXE_STORE_DIR;
  config.proverEnabled = PROVER_ENABLED;

  return await TestWallet.create(aztecNode, config, {
    proverOrOptions: {
      logger: createLogger('bb:native'),
    },
  });
}

async function getSponsoredPFCContract() {
  const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, {
    salt: new Fr(SPONSORED_FPC_SALT),
  });

  return instance;
}

async function createAccount(wallet: TestWallet) {
  const salt = Fr.random();
  const secretKey = Fr.random();
  const signingKey = deriveSigningKey(secretKey);
  const accountManager = await wallet.createSchnorrAccount(secretKey, salt, signingKey);

  const deployMethod = await accountManager.getDeployMethod();
  const sponsoredPFCContract = await getSponsoredPFCContract();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredPFCContract.address);
  const deployOpts = {
    from: AztecAddress.ZERO,
    fee: {
      paymentMethod,
    },
    skipClassPublication: true,
    skipInstancePublication: true,
    wait: { timeout: 120 },
  };
  await deployMethod.send(deployOpts);

  return {
    address: accountManager.address,
    salt,
    secretKey,
  };
}



async function deployContracts(wallet: TestWallet, deployer: AztecAddress) {
  const sponsoredPFCContract = await getSponsoredPFCContract();
  const paymentMethod = new SponsoredFeePaymentMethod(sponsoredPFCContract.address);

  const contractAddressSalt = Fr.random();

    const chessContract = await FogOfWarChessContract.deploy(wallet)
    .send({ from: deployer, fee: { paymentMethod }});


  const chessContractAddress = chessContract.address.toString();
  console.log(`✅ FogOfWarChess deployed: ${chessContractAddress}\n`);

  // Deploy HatNFT contract with chess contract as the authorized minter
  console.log("Deploying HatNFT contract...");
  const hatNFTContract = await HatNFTContract.deploy(wallet, chessContract.address)
    .send({ from: deployer,fee: { paymentMethod } });

  const hatNFTContractAddress = hatNFTContract.address.toString();
  console.log(`✅ HatNFT deployed: ${hatNFTContractAddress}\n`);

  // Link the contracts: tell chess contract about the NFT contract
  console.log("Linking contracts (setting NFT address on chess contract)...");
  await chessContract.methods
    .set_hat_nft_address(hatNFTContract.address)
    .send({ from: deployer , fee: { paymentMethod }});
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

  // Also update the devnet.json with contract addresses
//  if (AZTEC_NODE_URL === DEFAULT_NODE_URL) {
    try {
      const devnetConfig = JSON.parse(fs.readFileSync(DEVNET_CONFIG_PATH, 'utf-8'));
      devnetConfig.contracts.fogOfWarChess = chessContractAddress;
      devnetConfig.contracts.hatNFT = hatNFTContractAddress;
      fs.writeFileSync(DEVNET_CONFIG_PATH, JSON.stringify(devnetConfig, null, 2));
      console.log(`📝 Devnet config updated: ${DEVNET_CONFIG_PATH}`);
    } catch (e) {
      console.warn("Could not update devnet.json:", e);
    }
  //}
}

async function createAccountAndDeployContract() {
  const aztecNode = createAztecNodeClient(AZTEC_NODE_URL);
  const wallet = await setupWallet(aztecNode);

  const { rollupVersion, l1ChainId: chainId } = await aztecNode.getNodeInfo();

  // Register the SponsoredFPC contract (for sponsored fee payments)
  await wallet.registerContract(await getSponsoredPFCContract(), SponsoredFPCContractArtifact);

  // Create a new account
  const { address: deployer } = await createAccount(wallet);

  // Deploy the contract
  const contractDeploymentInfo = await deployContracts(wallet, deployer);

  // Clean up the PXE store
  process.exit(0);
}

async function main() {

await createAccountAndDeployContract();
}

main().catch((e) => {
  console.error("Deployment failed:", e);
  process.exit(1);
});
