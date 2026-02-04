import React, { useRef, useEffect, useMemo } from 'react';
import * as THREE from 'three';

// Aztec brand colors
const COLORS = {
  white: {
    body: 0xf2eee1,      // Parchment
    accent: 0xd4ff28,    // Chartreuse
    eyes: 0x1a1400,      // Ink (pupils)
    eyeWhite: 0xffffff,
  },
  black: {
    body: 0x2a2015,      // Dark brown/ink
    accent: 0xff2df4,    // Orchid
    eyes: 0x1a1400,      // Dark pupils
    eyeWhite: 0xf2eee1,  // Parchment eye whites
  },
};

type PieceType = 'K' | 'Q' | 'R' | 'B' | 'N' | 'P';
type PieceColor = 'white' | 'black';

interface ChessPiece3DProps {
  piece: PieceType;
  color: PieceColor;
  size?: number;
  isSelected?: boolean;
}

// Create materials with a cute matte look
function createMaterials(color: PieceColor) {
  const colors = COLORS[color];
  return {
    body: new THREE.MeshStandardMaterial({
      color: colors.body,
      roughness: 0.8,
      metalness: 0.1,
    }),
    accent: new THREE.MeshStandardMaterial({
      color: colors.accent,
      roughness: 0.6,
      metalness: 0.2,
      emissive: colors.accent,
      emissiveIntensity: 0.1,
    }),
    eyeWhite: new THREE.MeshStandardMaterial({
      color: colors.eyeWhite,
      roughness: 0.3,
    }),
    pupil: new THREE.MeshStandardMaterial({
      color: colors.eyes,
      roughness: 0.5,
    }),
    blush: new THREE.MeshStandardMaterial({
      color: 0xff9999,
      transparent: true,
      opacity: 0.5,
      roughness: 0.9,
    }),
    tongue: new THREE.MeshStandardMaterial({
      color: 0xff6b9d,
      roughness: 0.7,
    }),
  };
}

// Add googly eyes to a piece
function addEyes(
  group: THREE.Group,
  materials: ReturnType<typeof createMaterials>,
  yPos: number,
  zPos: number,
  eyeSpacing: number = 0.15,
  eyeSize: number = 0.12,
  expression: 'normal' | 'worried' | 'smug' | 'derpy' | 'scheming' | 'innocent' = 'normal'
) {
  const eyeGeom = new THREE.SphereGeometry(eyeSize, 16, 16);
  const pupilGeom = new THREE.SphereGeometry(eyeSize * 0.55, 12, 12);

  // Left eye
  const leftEye = new THREE.Mesh(eyeGeom, materials.eyeWhite);
  leftEye.position.set(-eyeSpacing, yPos, zPos);

  const leftPupil = new THREE.Mesh(pupilGeom, materials.pupil);

  // Right eye
  const rightEye = new THREE.Mesh(eyeGeom, materials.eyeWhite);
  rightEye.position.set(eyeSpacing, yPos, zPos);

  const rightPupil = new THREE.Mesh(pupilGeom, materials.pupil);

  // Position pupils based on expression
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

// Add blush cheeks
function addBlush(group: THREE.Group, materials: ReturnType<typeof createMaterials>, yPos: number, spacing: number = 0.25) {
  const blushGeom = new THREE.SphereGeometry(0.07, 12, 12);
  blushGeom.scale(1.8, 1, 0.5);

  const leftBlush = new THREE.Mesh(blushGeom, materials.blush);
  leftBlush.position.set(-spacing, yPos, 0.18);

  const rightBlush = new THREE.Mesh(blushGeom, materials.blush);
  rightBlush.position.set(spacing, yPos, 0.18);

  group.add(leftBlush, rightBlush);
}

// Create King piece
function createKing(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.38, 0.42, 0.15, 32);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.075;
  group.add(base);

  // Body
  const bodyGeom = new THREE.CylinderGeometry(0.32, 0.38, 0.5, 32);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.4;
  group.add(body);

  // Head
  const headGeom = new THREE.SphereGeometry(0.32, 32, 32);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.85;
  group.add(head);

  // Crown base - oversized and tilted
  const crownBaseGeom = new THREE.CylinderGeometry(0.38, 0.32, 0.18, 6);
  const crownBase = new THREE.Mesh(crownBaseGeom, materials.accent);
  crownBase.position.y = 1.15;
  crownBase.rotation.z = 0.18;
  crownBase.rotation.x = 0.05;
  group.add(crownBase);

  // Crown points
  for (let i = 0; i < 5; i++) {
    const pointGeom = new THREE.ConeGeometry(0.07, 0.18, 8);
    const point = new THREE.Mesh(pointGeom, materials.accent);
    const angle = (i / 5) * Math.PI * 2;
    point.position.set(
      Math.cos(angle) * 0.24 + 0.02,
      1.3,
      Math.sin(angle) * 0.24
    );
    point.rotation.z = 0.18;
    group.add(point);
  }

  // Worried eyes
  addEyes(group, materials, 0.9, 0.25, 0.14, 0.11, 'worried');
  addBlush(group, materials, 0.8, 0.28);

  // Worried frown
  const mouthGeom = new THREE.TorusGeometry(0.08, 0.02, 8, 16, Math.PI);
  const mouth = new THREE.Mesh(mouthGeom, materials.pupil);
  mouth.position.set(0, 0.68, 0.28);
  mouth.rotation.x = Math.PI;
  mouth.rotation.z = Math.PI;
  group.add(mouth);

  return group;
}

// Create Queen piece
function createQueen(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.35, 0.4, 0.12, 32);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.06;
  group.add(base);

  // Body - elegant tapered
  const bodyGeom = new THREE.CylinderGeometry(0.26, 0.35, 0.55, 32);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.4;
  group.add(body);

  // Head
  const headGeom = new THREE.SphereGeometry(0.28, 32, 32);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.85;
  group.add(head);

  // Tiara
  const tiaraGeom = new THREE.TorusGeometry(0.24, 0.05, 8, 32, Math.PI * 1.2);
  const tiara = new THREE.Mesh(tiaraGeom, materials.accent);
  tiara.position.set(0, 1.05, 0);
  tiara.rotation.x = -0.4;
  tiara.rotation.y = Math.PI * 0.1;
  group.add(tiara);

  // Tiara gems
  for (let i = 0; i < 3; i++) {
    const gemGeom = new THREE.OctahedronGeometry(0.06 + (i === 1 ? 0.03 : 0));
    const gem = new THREE.Mesh(gemGeom, materials.accent);
    gem.position.set(-0.15 + i * 0.15, 1.12 + (i === 1 ? 0.05 : 0), 0.12);
    group.add(gem);
  }

  // Smug eyes
  addEyes(group, materials, 0.88, 0.22, 0.12, 0.1, 'smug');
  addBlush(group, materials, 0.8, 0.24);

  // Smirk
  const smirkGeom = new THREE.TorusGeometry(0.07, 0.018, 8, 16, Math.PI * 0.5);
  const smirk = new THREE.Mesh(smirkGeom, materials.pupil);
  smirk.position.set(0.04, 0.7, 0.24);
  smirk.rotation.z = -0.4;
  group.add(smirk);

  return group;
}

// Create Rook piece
function createRook(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.BoxGeometry(0.6, 0.12, 0.6);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.06;
  group.add(base);

  // Body - blocky castle
  const bodyGeom = new THREE.BoxGeometry(0.52, 0.55, 0.52);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.395;
  group.add(body);

  // Battlements
  const battlementGeom = new THREE.BoxGeometry(0.18, 0.22, 0.18);
  const positions = [
    [-0.17, 0.78, -0.17], [0.17, 0.78, -0.17],
    [-0.17, 0.78, 0.17], [0.17, 0.78, 0.17]
  ];
  positions.forEach(([x, y, z]) => {
    const battlement = new THREE.Mesh(battlementGeom, materials.body);
    battlement.position.set(x, y, z);
    group.add(battlement);
  });

  // Brick accent lines
  for (let i = 0; i < 3; i++) {
    const lineGeom = new THREE.BoxGeometry(0.54, 0.025, 0.54);
    const line = new THREE.Mesh(lineGeom, materials.accent);
    line.position.y = 0.2 + i * 0.2;
    group.add(line);
  }

  // Vacant stare eyes
  addEyes(group, materials, 0.5, 0.27, 0.14, 0.11, 'normal');

  // Flat neutral mouth
  const mouthGeom = new THREE.BoxGeometry(0.15, 0.025, 0.025);
  const mouth = new THREE.Mesh(mouthGeom, materials.pupil);
  mouth.position.set(0, 0.35, 0.27);
  group.add(mouth);

  return group;
}

// Create Bishop piece
function createBishop(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.35, 0.4, 0.12, 32);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.06;
  group.add(base);

  // Body
  const bodyGeom = new THREE.CylinderGeometry(0.24, 0.35, 0.5, 32);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.37;
  group.add(body);

  // Head
  const headGeom = new THREE.SphereGeometry(0.26, 32, 32);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.78;
  group.add(head);

  // Mitre (bishop hat) - tilted askew
  const mitreGeom = new THREE.ConeGeometry(0.22, 0.45, 4);
  const mitre = new THREE.Mesh(mitreGeom, materials.accent);
  mitre.position.y = 1.18;
  mitre.rotation.y = Math.PI / 4;
  mitre.rotation.z = 0.15;
  mitre.rotation.x = 0.08;
  group.add(mitre);

  // Mitre slit
  const slitGeom = new THREE.BoxGeometry(0.02, 0.2, 0.1);
  const slit = new THREE.Mesh(slitGeom, materials.body);
  slit.position.set(0, 1.1, 0.15);
  slit.rotation.z = 0.15;
  group.add(slit);

  // Scheming side-eye
  addEyes(group, materials, 0.82, 0.2, 0.11, 0.1, 'scheming');
  addBlush(group, materials, 0.74, 0.22);

  // Sly grin
  const grinGeom = new THREE.TorusGeometry(0.06, 0.018, 8, 16, Math.PI * 0.6);
  const grin = new THREE.Mesh(grinGeom, materials.pupil);
  grin.position.set(0.03, 0.62, 0.22);
  grin.rotation.z = 0.25;
  group.add(grin);

  return group;
}

// Create Knight piece
function createKnight(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.32, 0.38, 0.15, 32);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.075;
  group.add(base);

  // Neck/body
  const neckGeom = new THREE.CylinderGeometry(0.22, 0.32, 0.35, 32);
  const neck = new THREE.Mesh(neckGeom, materials.body);
  neck.position.y = 0.32;
  neck.rotation.x = 0.2;
  group.add(neck);

  // Horse head
  const headGeom = new THREE.SphereGeometry(0.3, 32, 32);
  headGeom.scale(0.85, 1.1, 1);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.set(0, 0.7, 0.1);
  head.rotation.x = 0.25;
  group.add(head);

  // Snout
  const snoutGeom = new THREE.SphereGeometry(0.18, 16, 16);
  snoutGeom.scale(1, 0.75, 1.3);
  const snout = new THREE.Mesh(snoutGeom, materials.body);
  snout.position.set(0, 0.48, 0.32);
  group.add(snout);

  // Ears
  const earGeom = new THREE.ConeGeometry(0.09, 0.22, 8);
  const leftEar = new THREE.Mesh(earGeom, materials.body);
  leftEar.position.set(-0.16, 1.0, 0);
  leftEar.rotation.z = 0.35;
  const rightEar = new THREE.Mesh(earGeom, materials.body);
  rightEar.position.set(0.16, 1.0, 0);
  rightEar.rotation.z = -0.35;
  group.add(leftEar, rightEar);

  // Mane
  for (let i = 0; i < 6; i++) {
    const maneGeom = new THREE.SphereGeometry(0.09 - i * 0.008, 8, 8);
    const mane = new THREE.Mesh(maneGeom, materials.accent);
    mane.position.set(0, 0.95 - i * 0.13, -0.12 - i * 0.03);
    group.add(mane);
  }

  // Derpy crossed eyes
  addEyes(group, materials, 0.75, 0.25, 0.13, 0.11, 'derpy');

  // Tongue sticking out!
  const tongueGeom = new THREE.SphereGeometry(0.1, 12, 12);
  tongueGeom.scale(1, 0.5, 1.6);
  const tongue = new THREE.Mesh(tongueGeom, materials.tongue);
  tongue.position.set(0.06, 0.38, 0.48);
  tongue.rotation.x = 0.35;
  group.add(tongue);

  // Nostrils
  const nostrilGeom = new THREE.SphereGeometry(0.035, 8, 8);
  const leftNostril = new THREE.Mesh(nostrilGeom, materials.pupil);
  leftNostril.position.set(-0.07, 0.44, 0.45);
  const rightNostril = new THREE.Mesh(nostrilGeom, materials.pupil);
  rightNostril.position.set(0.07, 0.44, 0.45);
  group.add(leftNostril, rightNostril);

  return group;
}

// Create Pawn piece
function createPawn(materials: ReturnType<typeof createMaterials>): THREE.Group {
  const group = new THREE.Group();

  // Base
  const baseGeom = new THREE.CylinderGeometry(0.3, 0.35, 0.1, 32);
  const base = new THREE.Mesh(baseGeom, materials.body);
  base.position.y = 0.05;
  group.add(base);

  // Body - small round
  const bodyGeom = new THREE.SphereGeometry(0.28, 32, 32);
  bodyGeom.scale(1, 0.85, 1);
  const body = new THREE.Mesh(bodyGeom, materials.body);
  body.position.y = 0.32;
  group.add(body);

  // Head - oversized for cute proportions
  const headGeom = new THREE.SphereGeometry(0.26, 32, 32);
  const head = new THREE.Mesh(headGeom, materials.body);
  head.position.y = 0.68;
  group.add(head);

  // Little cap
  const capGeom = new THREE.SphereGeometry(0.12, 16, 16);
  const cap = new THREE.Mesh(capGeom, materials.accent);
  cap.position.y = 0.92;
  group.add(cap);

  // Innocent wide eyes
  addEyes(group, materials, 0.72, 0.2, 0.1, 0.09, 'innocent');
  addBlush(group, materials, 0.64, 0.2);

  // Small 'o' mouth
  const mouthGeom = new THREE.TorusGeometry(0.04, 0.015, 8, 16);
  const mouth = new THREE.Mesh(mouthGeom, materials.pupil);
  mouth.position.set(0, 0.55, 0.22);
  group.add(mouth);

  return group;
}

// Main component
export function ChessPiece3D({ piece, color, size = 70, isSelected = false }: ChessPiece3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const pieceGroupRef = useRef<THREE.Group | null>(null);
  const animationRef = useRef<number>(0);
  const timeRef = useRef<number>(0);

  const materials = useMemo(() => createMaterials(color), [color]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Camera - orthographic for consistent size
    const aspect = 1;
    const frustumSize = 1.8;
    const camera = new THREE.OrthographicCamera(
      -frustumSize * aspect / 2,
      frustumSize * aspect / 2,
      frustumSize / 2,
      -frustumSize / 2,
      0.1,
      100
    );
    camera.position.set(0, 0.6, 4);
    camera.lookAt(0, 0.5, 0);

    // Renderer with transparency
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.0);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-2, 2, -1);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xd4ff28, 0.3);
    rimLight.position.set(0, 0, -3);
    scene.add(rimLight);

    // Create the piece
    let pieceGroup: THREE.Group;
    switch (piece) {
      case 'K': pieceGroup = createKing(materials); break;
      case 'Q': pieceGroup = createQueen(materials); break;
      case 'R': pieceGroup = createRook(materials); break;
      case 'B': pieceGroup = createBishop(materials); break;
      case 'N': pieceGroup = createKnight(materials); break;
      case 'P': pieceGroup = createPawn(materials); break;
      default: pieceGroup = createPawn(materials);
    }

    pieceGroupRef.current = pieceGroup;
    scene.add(pieceGroup);

    // Animation loop - ALWAYS runs
    const animate = () => {
      timeRef.current += 0.016; // ~60fps
      const time = timeRef.current;

      if (pieceGroupRef.current) {
        // Idle animation - gentle sway (always active)
        pieceGroupRef.current.rotation.y = Math.sin(time * 1.5) * 0.15;

        // Gentle bobbing
        pieceGroupRef.current.position.y = Math.sin(time * 2) * 0.02;

        // Selected state - more pronounced bounce
        if (isSelected) {
          pieceGroupRef.current.position.y = Math.abs(Math.sin(time * 5)) * 0.08;
          pieceGroupRef.current.scale.setScalar(1.1);
        } else {
          pieceGroupRef.current.scale.setScalar(1.0);
        }
      }

      renderer.render(scene, camera);
      animationRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(animationRef.current);
      renderer.dispose();

      // Dispose materials
      Object.values(materials).forEach(mat => mat.dispose());

      if (containerRef.current && renderer.domElement.parentNode === containerRef.current) {
        containerRef.current.removeChild(renderer.domElement);
      }
    };
  }, [piece, color, size, materials]);

  // Update isSelected without recreating scene
  useEffect(() => {
    // isSelected changes are handled in the animation loop
  }, [isSelected]);

  return (
    <div
      ref={containerRef}
      style={{
        width: size,
        height: size,
        pointerEvents: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    />
  );
}
