import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { BoardSquare, PlayerRole } from '../lib/types';

// Aztec brand colors
const COLORS = {
  white: {
    body: 0xf2eee1,
    accent: 0xd4ff28,
    eyes: 0x1a1400,
    eyeWhite: 0xffffff,
  },
  black: {
    body: 0x2a2015,
    accent: 0xff2df4,
    eyes: 0x1a1400,
    eyeWhite: 0xf2eee1,
  },
};

type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
type PieceColor = 'white' | 'black';

interface ChessboardCanvasProps {
  board: BoardSquare[][];
  selectedSquare: { row: number; col: number } | null;
  hoveredSquare: { row: number; col: number } | null;
  squareSize: number;
  perspective: 'white' | 'black';
}

// Shared geometry cache
const geometryCache = new Map<string, THREE.BufferGeometry>();
const materialCache = new Map<string, THREE.Material>();

function getOrCreateMaterial(key: string, factory: () => THREE.Material): THREE.Material {
  if (!materialCache.has(key)) {
    materialCache.set(key, factory());
  }
  return materialCache.get(key)!;
}

function getMaterials(color: PieceColor) {
  const colors = COLORS[color];
  return {
    body: getOrCreateMaterial(`body-${color}`, () => new THREE.MeshStandardMaterial({
      color: colors.body,
      roughness: 0.8,
      metalness: 0.1,
    })),
    accent: getOrCreateMaterial(`accent-${color}`, () => new THREE.MeshStandardMaterial({
      color: colors.accent,
      roughness: 0.6,
      metalness: 0.2,
      emissive: colors.accent,
      emissiveIntensity: 0.1,
    })),
    eyeWhite: getOrCreateMaterial(`eyeWhite-${color}`, () => new THREE.MeshStandardMaterial({
      color: colors.eyeWhite,
      roughness: 0.3,
    })),
    pupil: getOrCreateMaterial(`pupil-${color}`, () => new THREE.MeshStandardMaterial({
      color: colors.eyes,
      roughness: 0.5,
    })),
    blush: getOrCreateMaterial(`blush-${color}`, () => new THREE.MeshStandardMaterial({
      color: 0xff9999,
      transparent: true,
      opacity: 0.5,
      roughness: 0.9,
    })),
    tongue: getOrCreateMaterial(`tongue-${color}`, () => new THREE.MeshStandardMaterial({
      color: 0xff6b9d,
      roughness: 0.7,
    })),
  };
}

// Add eyes helper
function addEyes(
  group: THREE.Group,
  materials: ReturnType<typeof getMaterials>,
  yPos: number,
  zPos: number,
  eyeSpacing: number,
  eyeSize: number,
  expression: string
) {
  const eyeGeom = new THREE.SphereGeometry(eyeSize, 12, 12);
  const pupilGeom = new THREE.SphereGeometry(eyeSize * 0.55, 8, 8);

  const leftEye = new THREE.Mesh(eyeGeom, materials.eyeWhite);
  leftEye.position.set(-eyeSpacing, yPos, zPos);
  const rightEye = new THREE.Mesh(eyeGeom, materials.eyeWhite);
  rightEye.position.set(eyeSpacing, yPos, zPos);

  const leftPupil = new THREE.Mesh(pupilGeom, materials.pupil);
  const rightPupil = new THREE.Mesh(pupilGeom, materials.pupil);

  switch (expression) {
    case 'worried':
      leftPupil.position.set(-eyeSpacing - 0.02, yPos + 0.04, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing + 0.02, yPos + 0.04, zPos + eyeSize * 0.7);
      break;
    case 'smug':
      leftPupil.position.set(-eyeSpacing + 0.03, yPos - 0.02, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing + 0.03, yPos - 0.02, zPos + eyeSize * 0.7);
      leftEye.scale.y = 0.6;
      rightEye.scale.y = 0.6;
      break;
    case 'derpy':
      leftPupil.position.set(-eyeSpacing + 0.05, yPos + 0.02, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing - 0.05, yPos - 0.02, zPos + eyeSize * 0.7);
      break;
    case 'scheming':
      leftPupil.position.set(-eyeSpacing + 0.06, yPos, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing + 0.06, yPos, zPos + eyeSize * 0.7);
      leftEye.scale.y = 0.7;
      rightEye.scale.y = 0.7;
      break;
    case 'innocent':
      leftPupil.position.set(-eyeSpacing, yPos + 0.03, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing, yPos + 0.03, zPos + eyeSize * 0.7);
      leftEye.scale.set(1.3, 1.3, 1);
      rightEye.scale.set(1.3, 1.3, 1);
      break;
    default:
      leftPupil.position.set(-eyeSpacing, yPos, zPos + eyeSize * 0.7);
      rightPupil.position.set(eyeSpacing, yPos, zPos + eyeSize * 0.7);
  }

  group.add(leftEye, rightEye, leftPupil, rightPupil);
}

function addBlush(group: THREE.Group, materials: ReturnType<typeof getMaterials>, yPos: number, spacing: number) {
  const blushGeom = new THREE.SphereGeometry(0.06, 8, 8);
  blushGeom.scale(1.8, 1, 0.5);

  const leftBlush = new THREE.Mesh(blushGeom, materials.blush);
  leftBlush.position.set(-spacing, yPos, 0.16);
  const rightBlush = new THREE.Mesh(blushGeom, materials.blush);
  rightBlush.position.set(spacing, yPos, 0.16);

  group.add(leftBlush, rightBlush);
}

// Piece creation functions (simplified for performance)
function createKing(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const bodyGeom = new THREE.CylinderGeometry(0.3, 0.35, 0.5, 16);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.3;
  group.add(body);

  const headGeom = new THREE.SphereGeometry(0.28, 16, 16);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.72;
  group.add(head);

  const crownGeom = new THREE.CylinderGeometry(0.32, 0.26, 0.15, 6);
  const crown = new THREE.Mesh(crownGeom, materials.accent);
  crown.position.y = 0.98;
  crown.rotation.z = 0.15;
  group.add(crown);

  for (let i = 0; i < 5; i++) {
    const pointGeom = new THREE.ConeGeometry(0.05, 0.14, 6);
    const point = new THREE.Mesh(pointGeom, materials.accent);
    const angle = (i / 5) * Math.PI * 2;
    point.position.set(Math.cos(angle) * 0.2, 1.1, Math.sin(angle) * 0.2);
    point.rotation.z = 0.15;
    group.add(point);
  }

  addEyes(group, materials, 0.76, 0.22, 0.12, 0.09, 'worried');
  addBlush(group, materials, 0.68, 0.24);

  return group;
}

function createQueen(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const bodyGeom = new THREE.CylinderGeometry(0.24, 0.32, 0.5, 16);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.3;
  group.add(body);

  const headGeom = new THREE.SphereGeometry(0.25, 16, 16);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.72;
  group.add(head);

  const tiaraGeom = new THREE.TorusGeometry(0.2, 0.04, 6, 16, Math.PI * 1.2);
  const tiara = new THREE.Mesh(tiaraGeom, materials.accent);
  tiara.position.set(0, 0.9, 0);
  tiara.rotation.x = -0.4;
  group.add(tiara);

  const gemGeom = new THREE.OctahedronGeometry(0.07);
  const gem = new THREE.Mesh(gemGeom, materials.accent);
  gem.position.set(0, 0.98, 0.1);
  group.add(gem);

  addEyes(group, materials, 0.75, 0.2, 0.1, 0.08, 'smug');
  addBlush(group, materials, 0.68, 0.2);

  return group;
}

function createRook(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const bodyGeom = new THREE.BoxGeometry(0.45, 0.5, 0.45);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.3;
  group.add(body);

  const battlementGeom = new THREE.BoxGeometry(0.14, 0.18, 0.14);
  [[-0.14, 0.65, -0.14], [0.14, 0.65, -0.14], [-0.14, 0.65, 0.14], [0.14, 0.65, 0.14]].forEach(([x, y, z]) => {
    const b = new THREE.Mesh(battlementGeom, materials.body);
    b.position.set(x, y, z);
    group.add(b);
  });

  for (let i = 0; i < 3; i++) {
    const lineGeom = new THREE.BoxGeometry(0.47, 0.02, 0.47);
    const line = new THREE.Mesh(lineGeom, materials.accent);
    line.position.y = 0.15 + i * 0.17;
    group.add(line);
  }

  addEyes(group, materials, 0.42, 0.24, 0.12, 0.09, 'normal');

  return group;
}

function createBishop(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const bodyGeom = new THREE.CylinderGeometry(0.22, 0.3, 0.45, 16);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.28;
  group.add(body);

  const headGeom = new THREE.SphereGeometry(0.22, 16, 16);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.65;
  group.add(head);

  const mitreGeom = new THREE.ConeGeometry(0.18, 0.38, 4);
  const mitre = new THREE.Mesh(mitreGeom, materials.accent);
  mitre.position.y = 1.0;
  mitre.rotation.y = Math.PI / 4;
  mitre.rotation.z = 0.12;
  group.add(mitre);

  addEyes(group, materials, 0.68, 0.17, 0.09, 0.08, 'scheming');
  addBlush(group, materials, 0.6, 0.18);

  return group;
}

function createKnight(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const baseGeom = new THREE.CylinderGeometry(0.28, 0.32, 0.12, 16);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.06;
  group.add(base);

  const headGeom = new THREE.SphereGeometry(0.26, 16, 16);
  headGeom.scale(0.85, 1.1, 1);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.set(0, 0.55, 0.08);
  head.rotation.x = 0.2;
  group.add(head);

  const snoutGeom = new THREE.SphereGeometry(0.15, 12, 12);
  snoutGeom.scale(1, 0.75, 1.2);
  const snout = new THREE.Mesh(snoutGeom, materials.body);
  snout.position.set(0, 0.38, 0.28);
  group.add(snout);

  const earGeom = new THREE.ConeGeometry(0.07, 0.18, 6);
  const leftEar = new THREE.Mesh(earGeom, materials.body);
  leftEar.position.set(-0.14, 0.85, 0);
  leftEar.rotation.z = 0.3;
  const rightEar = new THREE.Mesh(earGeom, materials.body);
  rightEar.position.set(0.14, 0.85, 0);
  rightEar.rotation.z = -0.3;
  group.add(leftEar, rightEar);

  for (let i = 0; i < 5; i++) {
    const maneGeom = new THREE.SphereGeometry(0.07 - i * 0.006, 6, 6);
    const mane = new THREE.Mesh(maneGeom, materials.accent);
    mane.position.set(0, 0.8 - i * 0.11, -0.1 - i * 0.02);
    group.add(mane);
  }

  addEyes(group, materials, 0.6, 0.22, 0.11, 0.09, 'derpy');

  const tongueGeom = new THREE.SphereGeometry(0.08, 8, 8);
  tongueGeom.scale(1, 0.5, 1.4);
  const tongue = new THREE.Mesh(tongueGeom, materials.tongue);
  tongue.position.set(0.05, 0.3, 0.42);
  tongue.rotation.x = 0.3;
  group.add(tongue);

  return group;
}

function createPawn(materials: ReturnType<typeof getMaterials>): THREE.Group {
  const group = new THREE.Group();

  const bodyGeom = new THREE.SphereGeometry(0.24, 16, 16);
  bodyGeom.scale(1, 0.85, 1);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.26;
  group.add(body);

  const headGeom = new THREE.SphereGeometry(0.22, 16, 16);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.58;
  group.add(head);

  const capGeom = new THREE.SphereGeometry(0.1, 12, 12);
  const cap = new THREE.Mesh(capGeom, materials.accent);
  cap.position.y = 0.78;
  group.add(cap);

  addEyes(group, materials, 0.62, 0.17, 0.08, 0.07, 'innocent');
  addBlush(group, materials, 0.54, 0.16);

  return group;
}

function createPiece(piece: PieceType, color: PieceColor): THREE.Group {
  const materials = getMaterials(color);
  switch (piece) {
    case 'K': return createKing(materials);
    case 'Q': return createQueen(materials);
    case 'R': return createRook(materials);
    case 'B': return createBishop(materials);
    case 'N': return createKnight(materials);
    case 'P': return createPawn(materials);
    default: return createPawn(materials);
  }
}

export function ChessboardCanvas({ board, selectedSquare, hoveredSquare, squareSize, perspective }: ChessboardCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.OrthographicCamera | null>(null);
  const piecesRef = useRef<Map<string, THREE.Group>>(new Map());
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const hoveredSquareRef = useRef(hoveredSquare);
  const perspectiveRef = useRef(perspective);
  const boardRef = useRef(board);

  // Keep refs in sync
  hoveredSquareRef.current = hoveredSquare;
  perspectiveRef.current = perspective;
  boardRef.current = board;

  const canvasSize = squareSize * 8;

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Orthographic camera looking down at the board
    const frustumSize = 8;
    const camera = new THREE.OrthographicCamera(
      -frustumSize / 2,
      frustumSize / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100
    );
    // Adjusted camera position to center pieces better on squares
    camera.position.set(0, 10, 2.5);
    camera.lookAt(0, 0, 0.3);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(canvasSize, canvasSize);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(4, 8, 4);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-4, 4, -2);
    scene.add(fillLight);

    // Animation loop
    const animate = () => {
      timeRef.current += 0.016;
      const time = timeRef.current;
      const currentHovered = hoveredSquareRef.current;
      const currentPerspective = perspectiveRef.current;
      const currentBoard = boardRef.current;

      // Animate all pieces
      piecesRef.current.forEach((pieceGroup, key) => {
        const [row, col] = key.split('-').map(Number);
        const isSelected = selectedSquare?.row === row && selectedSquare?.col === col;
        const isHovered = currentHovered?.row === row && currentHovered?.col === col;

        // Check if this is the player's piece (only their pieces should look up)
        const square = currentBoard[row]?.[col];
        const isPlayerPiece = square?.pieceColor === currentPerspective;

        // Idle sway
        pieceGroup.rotation.y = Math.sin(time * 1.5 + row * 0.5 + col * 0.3) * 0.12;

        // "Look up" effect when hovering over player's own pieces
        // Tilt forward (negative X rotation makes piece look up at the camera)
        const targetTilt = (isHovered && isPlayerPiece) ? -0.8 : 0;
        const currentTilt = pieceGroup.userData.currentTilt || 0;
        const newTilt = currentTilt + (targetTilt - currentTilt) * 0.15; // Smooth interpolation
        pieceGroup.rotation.x = newTilt;
        pieceGroup.userData.currentTilt = newTilt;

        // Bobbing
        const baseY = pieceGroup.userData.baseY || 0;
        if (isSelected) {
          pieceGroup.position.y = baseY + Math.abs(Math.sin(time * 5)) * 0.15;
          pieceGroup.scale.setScalar(1.15);
        } else if (isHovered && isPlayerPiece) {
          // Subtle lift when hovering
          pieceGroup.position.y = baseY + 0.08;
          pieceGroup.scale.setScalar(1.05);
        } else {
          pieceGroup.position.y = baseY + Math.sin(time * 2 + row + col) * 0.03;
          pieceGroup.scale.setScalar(1.0);
        }
      });

      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();
      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [canvasSize]);

  // Update pieces when board changes
  useEffect(() => {
    if (!sceneRef.current) return;

    const scene = sceneRef.current;
    const currentPieces = piecesRef.current;
    const newPieceKeys = new Set<string>();

    // Add/update pieces
    board.forEach((row, rowIdx) => {
      row.forEach((square, colIdx) => {
        if (square.piece && square.pieceColor) {
          const key = `${rowIdx}-${colIdx}`;
          const pieceKey = `${key}-${square.piece}-${square.pieceColor}`;
          newPieceKeys.add(key);

          // Check if we need to create or update this piece
          const existingPiece = currentPieces.get(key);
          if (!existingPiece || existingPiece.userData.pieceKey !== pieceKey) {
            // Remove old piece if exists
            if (existingPiece) {
              scene.remove(existingPiece);
            }

            // Create new piece
            const piece = createPiece(
              square.piece as PieceType,
              square.pieceColor as PieceColor
            );

            // Position: convert row/col to 3D coordinates
            // Board is 8x8, centered at origin
            const x = colIdx - 3.5;
            const z = rowIdx - 3.5;
            piece.position.set(x, 0, z);
            piece.userData.baseY = 0;
            piece.userData.pieceKey = pieceKey;

            scene.add(piece);
            currentPieces.set(key, piece);
          }
        }
      });
    });

    // Remove pieces that are no longer on the board
    currentPieces.forEach((piece, key) => {
      if (!newPieceKeys.has(key)) {
        scene.remove(piece);
        currentPieces.delete(key);
      }
    });
  }, [board]);

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: canvasSize,
        height: canvasSize,
        pointerEvents: 'none',
        zIndex: 10,
      }}
    />
  );
}
