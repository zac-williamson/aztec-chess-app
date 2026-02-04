import React, { useRef, useEffect, useCallback, useState } from 'react';

interface FlappyPawnProps {
  playerColor: 'white' | 'black';
  disabled?: boolean;
}

const CANVAS_WIDTH = 280;
const CANVAS_HEIGHT = 400;

export function FlappyPawn({ playerColor, disabled = false }: FlappyPawnProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [score, setScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);

  // Initialize worker and transfer canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Check if OffscreenCanvas is supported
    if (!canvas.transferControlToOffscreen) {
      console.warn('OffscreenCanvas not supported, falling back to main thread');
      // Fall back to main thread rendering if not supported
      return;
    }

    try {
      const offscreen = canvas.transferControlToOffscreen();

      // Create worker
      const worker = new Worker(
        new URL('../workers/flappyPawnWorker.ts', import.meta.url),
        { type: 'module' }
      );
      workerRef.current = worker;

      // Handle messages from worker
      worker.onmessage = (event) => {
        const { type, score: newScore, gameOver: isGameOver } = event.data;
        if (type === 'scoreUpdate') {
          setScore(newScore);
        } else if (type === 'gameOverUpdate') {
          setGameOver(isGameOver);
        }
      };

      // Initialize the worker with the canvas
      worker.postMessage(
        { type: 'init', data: { canvas: offscreen, playerColor } },
        [offscreen]
      );

      return () => {
        worker.postMessage({ type: 'stop' });
        worker.terminate();
        workerRef.current = null;
      };
    } catch (error) {
      console.error('Failed to initialize FlappyPawn worker:', error);
    }
  }, []); // Only run once on mount

  // Update player color in worker when it changes
  useEffect(() => {
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'setColor', data: { playerColor } });
    }
  }, [playerColor]);

  const jump = useCallback(() => {
    if (disabled) return;
    if (workerRef.current) {
      workerRef.current.postMessage({ type: 'jump' });
    }
  }, [disabled]);

  // Handle keyboard input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (disabled) return;
      if (e.code === 'Space' || e.key === ' ') {
        e.preventDefault();
        jump();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [jump, disabled]);

  return (
    <div className="flappy-pawn-container">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        onClick={disabled ? undefined : jump}
        style={{
          cursor: disabled ? 'default' : 'pointer',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
          opacity: disabled ? 0.5 : 1,
          transition: 'opacity 0.3s ease',
        }}
      />
    </div>
  );
}
