// FlappyPawn Web Worker - runs game loop independently of main thread

const CANVAS_WIDTH = 280;
const CANVAS_HEIGHT = 400;
const GRAVITY = 0.4;
const JUMP_FORCE = -7;
const PIPE_WIDTH = 50;
const PIPE_GAP = 120;
const PIPE_SPEED = 2.5;
const PAWN_SIZE = 32;

interface Pipe {
  x: number;
  gapY: number;
  passed: boolean;
}

interface GameState {
  pawnY: number;
  pawnVelocity: number;
  pipes: Pipe[];
  score: number;
  gameOver: boolean;
  gameStarted: boolean;
  frameCount: number;
}

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let playerColor: 'white' | 'black' = 'white';
let animationId: number | null = null;

const gameState: GameState = {
  pawnY: CANVAS_HEIGHT / 2,
  pawnVelocity: 0,
  pipes: [],
  score: 0,
  gameOver: false,
  gameStarted: false,
  frameCount: 0,
};

function resetGame() {
  gameState.pawnY = CANVAS_HEIGHT / 2;
  gameState.pawnVelocity = 0;
  gameState.pipes = [];
  gameState.score = 0;
  gameState.gameOver = false;
  gameState.gameStarted = false;
  gameState.frameCount = 0;
  self.postMessage({ type: 'scoreUpdate', score: 0 });
  self.postMessage({ type: 'gameOverUpdate', gameOver: false });
}

function jump() {
  if (gameState.gameOver) {
    resetGame();
    return;
  }
  if (!gameState.gameStarted) {
    gameState.gameStarted = true;
  }
  gameState.pawnVelocity = JUMP_FORCE;
}

function getColors() {
  return playerColor === 'white'
    ? { body: '#f2eee1', accent: '#d4ff28', eyes: '#1a1400', eyeWhite: '#ffffff', stroke: '#ccc' }
    : { body: '#2a2015', accent: '#ff2df4', eyes: '#1a1400', eyeWhite: '#f2eee1', stroke: '#444' };
}

function drawPawn(x: number, y: number, velocity: number) {
  if (!ctx) return;
  const colors = getColors();

  ctx.save();
  ctx.translate(x, y);

  // Tilt based on velocity
  const tilt = Math.max(-0.5, Math.min(0.5, velocity * 0.05));
  ctx.rotate(tilt);

  // Body (oval)
  ctx.fillStyle = colors.body;
  ctx.beginPath();
  ctx.ellipse(0, 4, 12, 10, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = colors.stroke;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Head
  ctx.beginPath();
  ctx.arc(0, -8, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Cap (accent color)
  ctx.fillStyle = colors.accent;
  ctx.beginPath();
  ctx.arc(0, -16, 5, 0, Math.PI * 2);
  ctx.fill();

  // Eyes
  ctx.fillStyle = colors.eyeWhite;
  ctx.beginPath();
  ctx.ellipse(-4, -9, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(4, -9, 4, 5, 0, 0, Math.PI * 2);
  ctx.fill();

  // Pupils (look in direction of movement)
  ctx.fillStyle = colors.eyes;
  const pupilOffsetX = velocity > 0 ? 1 : velocity < -2 ? -1 : 0;
  const pupilOffsetY = velocity > 2 ? 1 : velocity < -2 ? -1 : 0;
  ctx.beginPath();
  ctx.arc(-4 + pupilOffsetX, -9 + pupilOffsetY, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(4 + pupilOffsetX, -9 + pupilOffsetY, 2.2, 0, Math.PI * 2);
  ctx.fill();

  // Blush
  ctx.fillStyle = 'rgba(255, 150, 150, 0.5)';
  ctx.beginPath();
  ctx.ellipse(-8, -5, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(8, -5, 3, 2, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function drawPipe(pipe: Pipe) {
  if (!ctx) return;

  const gradient = ctx.createLinearGradient(pipe.x, 0, pipe.x + PIPE_WIDTH, 0);
  gradient.addColorStop(0, '#2d5a27');
  gradient.addColorStop(0.5, '#4a8c3f');
  gradient.addColorStop(1, '#2d5a27');

  ctx.fillStyle = gradient;

  // Top pipe
  ctx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY - PIPE_GAP / 2);
  // Pipe cap top
  ctx.fillStyle = '#3d7a37';
  ctx.fillRect(pipe.x - 4, pipe.gapY - PIPE_GAP / 2 - 20, PIPE_WIDTH + 8, 20);

  // Bottom pipe
  ctx.fillStyle = gradient;
  ctx.fillRect(pipe.x, pipe.gapY + PIPE_GAP / 2, PIPE_WIDTH, CANVAS_HEIGHT - (pipe.gapY + PIPE_GAP / 2));
  // Pipe cap bottom
  ctx.fillStyle = '#3d7a37';
  ctx.fillRect(pipe.x - 4, pipe.gapY + PIPE_GAP / 2, PIPE_WIDTH + 8, 20);
}

function gameLoop() {
  if (!ctx || !canvas) return;

  // Clear canvas
  ctx.fillStyle = '#87CEEB';
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

  // Draw ground
  ctx.fillStyle = '#8B4513';
  ctx.fillRect(0, CANVAS_HEIGHT - 30, CANVAS_WIDTH, 30);
  ctx.fillStyle = '#228B22';
  ctx.fillRect(0, CANVAS_HEIGHT - 30, CANVAS_WIDTH, 8);

  if (gameState.gameStarted && !gameState.gameOver) {
    // Update pawn physics
    gameState.pawnVelocity += GRAVITY;
    gameState.pawnY += gameState.pawnVelocity;

    // Spawn pipes
    gameState.frameCount++;
    if (gameState.frameCount % 100 === 0) {
      const gapY = Math.random() * (CANVAS_HEIGHT - 200) + 100;
      gameState.pipes.push({ x: CANVAS_WIDTH, gapY, passed: false });
    }

    // Update pipes
    gameState.pipes = gameState.pipes.filter(pipe => pipe.x > -PIPE_WIDTH);
    for (const pipe of gameState.pipes) {
      pipe.x -= PIPE_SPEED;

      // Check for score
      if (!pipe.passed && pipe.x + PIPE_WIDTH < CANVAS_WIDTH / 2 - PAWN_SIZE / 2) {
        pipe.passed = true;
        gameState.score++;
        self.postMessage({ type: 'scoreUpdate', score: gameState.score });
      }

      // Collision detection
      const pawnLeft = CANVAS_WIDTH / 2 - PAWN_SIZE / 2 + 8;
      const pawnRight = CANVAS_WIDTH / 2 + PAWN_SIZE / 2 - 8;
      const pawnTop = gameState.pawnY - PAWN_SIZE / 2 + 4;
      const pawnBottom = gameState.pawnY + PAWN_SIZE / 2 - 4;

      if (pawnRight > pipe.x && pawnLeft < pipe.x + PIPE_WIDTH) {
        if (pawnTop < pipe.gapY - PIPE_GAP / 2 || pawnBottom > pipe.gapY + PIPE_GAP / 2) {
          gameState.gameOver = true;
          self.postMessage({ type: 'gameOverUpdate', gameOver: true });
        }
      }
    }

    // Check bounds
    if (gameState.pawnY > CANVAS_HEIGHT - 30 - PAWN_SIZE / 2 || gameState.pawnY < PAWN_SIZE / 2) {
      gameState.gameOver = true;
      self.postMessage({ type: 'gameOverUpdate', gameOver: true });
    }
  }

  // Draw pipes
  for (const pipe of gameState.pipes) {
    drawPipe(pipe);
  }

  // Draw pawn
  drawPawn(CANVAS_WIDTH / 2, gameState.pawnY, gameState.pawnVelocity);

  // Draw score
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 3;
  ctx.font = 'bold 28px Arial';
  ctx.textAlign = 'center';
  ctx.strokeText(gameState.score.toString(), CANVAS_WIDTH / 2, 50);
  ctx.fillText(gameState.score.toString(), CANVAS_WIDTH / 2, 50);

  // Draw start message
  if (!gameState.gameStarted) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('Click or Space to Start', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2);
    ctx.font = '14px Arial';
    ctx.fillText('Keep the pawn flying!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 30);
  }

  // Draw game over
  if (gameState.gameOver) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    ctx.fillStyle = '#ff6b6b';
    ctx.font = 'bold 28px Arial';
    ctx.fillText('Game Over!', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 - 20);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 20px Arial';
    ctx.fillText(`Score: ${gameState.score}`, CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 15);
    ctx.font = '14px Arial';
    ctx.fillText('Click to play again', CANVAS_WIDTH / 2, CANVAS_HEIGHT / 2 + 45);
  }

  // Schedule next frame - using setTimeout for consistent timing in worker
  animationId = self.setTimeout(gameLoop, 1000 / 60) as unknown as number;
}

// Handle messages from main thread
self.onmessage = (event: MessageEvent) => {
  const { type, data } = event.data;

  switch (type) {
    case 'init':
      canvas = data.canvas as OffscreenCanvas;
      ctx = canvas.getContext('2d');
      playerColor = data.playerColor || 'white';
      resetGame();
      gameLoop();
      break;

    case 'jump':
      jump();
      break;

    case 'setColor':
      playerColor = data.playerColor;
      break;

    case 'stop':
      if (animationId !== null) {
        clearTimeout(animationId);
        animationId = null;
      }
      break;
  }
};
