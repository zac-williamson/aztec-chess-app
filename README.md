# Aztec Fog of War Chess

A web application for playing fog-of-war chess on the [Aztec Network](https://aztec.network/) — an Ethereum L2 with native privacy via zero-knowledge proofs.

In fog of war chess, each player can only see squares that their pieces have vision over. The Aztec smart contract uses multiparty computation (MPC) to ensure neither player can cheat by seeing more than they should.

## Prerequisites

- Node.js v18+
- [Aztec Sandbox](https://docs.aztec.network/guides/developer_guides/getting_started) running locally

### Starting the Aztec Sandbox

```bash
aztec start --sandbox
```

The sandbox should be running on `http://localhost:8080` before starting the app.

## Installation

```bash
npm install
```

## Running the App

```bash
npm run dev
```

Open http://localhost:3000 in your browser.

## How to Play

### Creating a Game (White Player)

1. Open http://localhost:3000 in a browser tab
2. Click **"Connect as White"**
3. Wait for the wallet to connect to the Aztec sandbox
4. Enter a password (any number) and click **"Create New Game"**
5. Wait for the contract to deploy and the game to be created
6. Share the **Contract Address** and **Game ID** with your opponent
7. Click **"Start Playing"** once your opponent has joined

### Joining a Game (Black Player)

1. Open http://localhost:3000 in a **separate** browser tab
2. Click **"Connect as Black"**
3. Enter the Contract Address, Game ID, and the same password
4. Click **"Join Game"**

### Making Moves

- Click on one of your pieces to select it
- Click on a destination square to move
- Gray squares indicate areas you might be able to see once your opponent moves
- Dark squares are completely outside your vision

### Game End

The game ends when a king is captured. Both players will see a "Game over" message.

## Architecture

- **Frontend**: React + TypeScript + Webpack
- **Blockchain**: Aztec Network (L2 with privacy)
- **Smart Contract**: [aztec-chess](https://github.com/zac-williamson/aztec-chess) Noir contract

Each browser tab runs its own Private eXecution Environment (PXE) via `@aztec/test-wallet`. The PXE handles proof generation and private state management locally.

### Fog of War Mechanics

Vision is computed based on piece positions:
- **Sliding pieces** (Bishop, Rook, Queen): See along their movement lines until blocked
- **Knight**: Sees L-shaped squares (not blocked by pieces)
- **King**: Sees all adjacent squares
- **Pawn**: Sees one square forward plus diagonals; two forward from starting rank

Due to the MPC protocol, visibility updates lag by one turn. When you move, you must wait for your opponent's response before your new vision is confirmed. The UI shows "potentially visible" squares in gray until the MPC confirms them as empty or reveals an opponent piece.

## Development

The app uses webpack-dev-server with hot reloading:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

## License

MIT
