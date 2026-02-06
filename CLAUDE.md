# Aztec Chess App

## Project Overview
A fog-of-war chess game built on the Aztec network using client-side proving (embedded PXE wallet). Players' moves and board state are kept private using Aztec's zero-knowledge proofs.

## Architecture
- **Frontend**: React + TypeScript, bundled with webpack
- **Blockchain**: Aztec Network (devnet), Noir smart contracts
- **Wallet**: Client-side embedded PXE (`app/lib/embedded_wallet.ts`) — no external wallet needed
- **Fee payments**: SponsoredFPC contract covers gas fees for players

## Key Files
- `app/hooks/useAztec.ts` — Wallet creation, account deployment, connection to Aztec node
- `app/hooks/useChessGame.ts` — Chess game logic and contract interactions
- `app/lib/embedded_wallet.ts` — `EmbeddedWallet` class extending `BaseWallet` with client-side PXE
- `app/components/App.tsx` — Main React app component
- `app/config/networks/devnet.json` — Devnet node URL and config
- `scripts/deploy.ts` — Contract deployment script

## Aztec SDK Patterns
- Use `wallet.getContractMetadata(address)` and check `isContractInitialized` to verify if a contract/account is deployed on-chain. Do NOT use `node.getContract()` for this.
- `AccountManager.address` is a direct property — no need to call `getAccount().getAddress()`.
- Always check on-chain state as the source of truth for deployment status. Don't rely solely on localStorage flags.
- Account secrets are persisted in localStorage for session continuity.
- Use `SchnorrAccountContract` with `deriveSigningKey(secret)` for account contracts.
- `SponsoredFeePaymentMethod` handles fee payment via the SponsoredFPC contract.

## Build & Run
- `npm install` — Install dependencies
- `npm start` — Start dev server (webpack)
- `npm run deploy` — Deploy contracts to devnet
