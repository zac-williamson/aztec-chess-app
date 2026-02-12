#!/usr/bin/env bash
set -euo pipefail

# Deploy the relay server to Fly.io
# Usage: ./scripts/deploy-relay.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SERVER_DIR="$SCRIPT_DIR/../server"

echo "Deploying relay server to Fly.io..."
cd "$SERVER_DIR"
fly deploy
echo ""
echo "Relay server deployed to https://aztec-chess-relay.fly.dev"
