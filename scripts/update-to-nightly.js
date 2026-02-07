#!/usr/bin/env node

/**
 * Update aztec-chess-app to the latest Aztec nightly version.
 *
 * Usage:
 *   node scripts/update-to-nightly.js [--version VERSION] [--deploy] [--skip-aztec-up]
 */

import { readFileSync, writeFileSync, copyFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { globSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

// Color codes
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
};

function log(color, message) {
  console.log(`${color}${message}${COLORS.reset}`);
}

function exec(command, options = {}) {
  return execSync(command, {
    cwd: options.cwd || ROOT,
    stdio: options.silent ? "pipe" : "inherit",
    encoding: "utf-8",
    ...options,
  });
}

async function fetchLatestNightly() {
  log(COLORS.yellow, "Fetching latest nightly from npm...");
  try {
    const output = exec("npm view @aztec/aztec.js versions --json", { silent: true });
    const versions = JSON.parse(output);
    const nightlies = versions.filter((v) => v.match(/^4\.0\.0-nightly\.\d+$/));
    const latest = nightlies[nightlies.length - 1];
    if (!latest) {
      throw new Error("No nightly versions found");
    }
    return latest;
  } catch (error) {
    log(COLORS.red, "Failed to fetch latest nightly version from npm");
    log(COLORS.red, "Please specify a version with --version");
    process.exit(1);
  }
}

function updatePackageJson(version) {
  log(COLORS.yellow, "[1/6] Updating package.json...");
  const path = resolve(ROOT, "package.json");
  let content = readFileSync(path, "utf-8");

  // Update @aztec/* dependency versions
  content = content.replace(
    /("@aztec\/[^"]+": ")v4\.0\.0-nightly\.\d+"/g,
    `$1v${version}"`
  );

  writeFileSync(path, content, "utf-8");
  log(COLORS.green, "✓ package.json updated\n");
}

// Nargo.toml files that reference AztecProtocol repos
const NARGO_TOML_PATHS = [
  "aztec-contracts/contracts/chess/Nargo.toml",
  "aztec-contracts/contracts/hat_nft/Nargo.toml",
  "noir-libraries/fog_of_war_chess/Nargo.toml",
  "noir-libraries/mpclib/Nargo.toml",
];

function updateNargoToml(version) {
  log(COLORS.yellow, "[2/6] Updating Nargo.toml files...");

  for (const relPath of NARGO_TOML_PATHS) {
    const fullPath = resolve(ROOT, relPath);
    let content = readFileSync(fullPath, "utf-8");

    // Replace version tags on any line referencing an AztecProtocol repo.
    // Handles both orderings: tag before git, and git before tag.
    content = content.replace(/^(.+github\.com\/AztecProtocol\/.+)$/gm, (line) => {
      return line.replace(/tag\s*=\s*"[^"]+?"/, `tag = "v${version}"`);
    });

    writeFileSync(fullPath, content, "utf-8");
    log(COLORS.green, `  ✓ ${relPath}`);
  }
  log(COLORS.green, "✓ Nargo.toml files updated\n");
}

function installDependencies() {
  log(COLORS.yellow, "[3/6] Running npm install...");
  exec("npm install");
  log(COLORS.green, "✓ Dependencies installed\n");
}

function installAztecCLI(version) {
  log(COLORS.yellow, `[4/6] Installing Aztec CLI version ${version}...`);

  const isCI = !!process.env.CI;

  if (isCI) {
    log(COLORS.yellow, `Running version-specific installer for ${version}...`);
    process.env.FOUNDRY_DIR = `${process.env.HOME}/.foundry`;
    exec(`curl -fsSL "https://install.aztec.network/${version}/install" | VERSION="${version}" bash`);

    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/bin:${process.env.PATH}`;
    process.env.PATH = `${process.env.HOME}/.aztec/versions/${version}/node_modules/.bin:${process.env.PATH}`;
    log(COLORS.green, "✓ Aztec CLI installed (CI mode)\n");
  } else {
    try {
      exec("command -v aztec-up", { silent: true });
      exec(`aztec-up install ${version}`);
      log(COLORS.green, "✓ Aztec CLI updated\n");
    } catch {
      log(COLORS.red, `Warning: aztec-up not found in PATH. Please install manually with: aztec-up install ${version}\n`);
    }
  }
}

function compileAndCopyArtifacts() {
  log(COLORS.yellow, "[5/6] Compiling contracts and generating artifacts...");

  const contractsDir = resolve(ROOT, "aztec-contracts");
  const artifactsDir = resolve(ROOT, "app/artifacts");

  // Compile + transpile all workspace contracts
  log(COLORS.yellow, "  Compiling with aztec compile...");
  exec("aztec compile", { cwd: contractsDir });

  // Generate TypeScript artifacts from compiled JSON
  const targetDir = resolve(contractsDir, "target");
  log(COLORS.yellow, "  Generating TypeScript artifacts with aztec codegen...");
  exec(`aztec codegen ${targetDir} -o ${artifactsDir}`);

  log(COLORS.green, "✓ Contracts compiled and artifacts generated\n");
}

function deployContracts() {
  log(COLORS.yellow, "[6/6] Deploying contracts...");
  exec("npm run deploy");
  log(COLORS.green, "✓ Contracts deployed\n");
}

async function main() {
  log(COLORS.green, "=== Aztec Chess App Nightly Update Script ===\n");

  // Parse arguments
  const args = process.argv.slice(2);
  let version = null;
  let deploy = false;
  let skipAztecUp = false;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--version" && args[i + 1]) {
      version = args[i + 1].replace(/^v/, "");
      i++;
    } else if (args[i] === "--deploy") {
      deploy = true;
    } else if (args[i] === "--skip-aztec-up") {
      skipAztecUp = true;
    } else if (args[i] === "--help") {
      console.log("Usage: node scripts/update-to-nightly.js [OPTIONS]");
      console.log("\nOptions:");
      console.log("  --version VERSION    Specify nightly version (e.g., 4.0.0-nightly.20260206)");
      console.log("  --deploy             Deploy contracts to devnet after update");
      console.log("  --skip-aztec-up      Skip Aztec CLI installation");
      console.log("  --help               Show this help message");
      process.exit(0);
    }
  }

  // Fetch latest if not specified
  if (!version) {
    version = await fetchLatestNightly();
    log(COLORS.green, `Latest nightly version: v${version}\n`);
  } else {
    log(COLORS.green, `Updating to version: v${version}\n`);
  }

  // Run update steps
  updatePackageJson(version);
  updateNargoToml(version);
  installDependencies();

  if (!skipAztecUp) {
    installAztecCLI(version);
  } else {
    log(COLORS.yellow, "[4/6] Skipping Aztec CLI installation (--skip-aztec-up flag set)\n");
  }

  compileAndCopyArtifacts();

  if (deploy) {
    deployContracts();
  } else {
    log(COLORS.yellow, "[6/6] Skipping deployment (use --deploy flag to deploy)\n");
  }

  log(COLORS.green, "=== Update Complete ===");
  log(COLORS.green, `Version: v${version}`);
  if (!deploy) {
    log(COLORS.yellow, "To deploy, run: node scripts/update-to-nightly.js --deploy");
  }
}

main().catch((error) => {
  log(COLORS.red, `Error: ${error.message}`);
  process.exit(1);
});
