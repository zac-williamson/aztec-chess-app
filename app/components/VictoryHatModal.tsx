import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';
import type { Hat } from '../lib/types';
import { HAT_TYPE_NAMES, HAT_QUALITY_NAMES, HAT_TYPE_DESCRIPTIONS } from '../lib/types';

interface VictoryHatModalProps {
  hat: Hat;
  onPlayAgain: () => void;
}

// Hat quality colors matching ChessboardCanvas
const HAT_QUALITY_COLORS = [
  { base: 0x666666, emissive: 0x000000 },  // 0: Tattered
  { base: 0x8B4513, emissive: 0x000000 },  // 1: Plain
  { base: 0x4169E1, emissive: 0x000000 },  // 2: Plain
  { base: 0xC0C0C0, emissive: 0x111111 },  // 3: Fine
  { base: 0xFFD700, emissive: 0x222200 },  // 4: Elegant
  { base: 0x9932CC, emissive: 0x220033 },  // 5: Majestic
  { base: 0xFF4500, emissive: 0x331100 },  // 6: Legendary
  { base: 0x00FFFF, emissive: 0x003333 },  // 7: Mythic
];

function getHatMaterial(quality: number): THREE.MeshStandardMaterial {
  const colors = HAT_QUALITY_COLORS[Math.min(quality, 7)];
  return new THREE.MeshStandardMaterial({
    color: colors.base,
    emissive: colors.emissive,
    emissiveIntensity: quality >= 5 ? 0.4 : 0.15,
    roughness: quality >= 4 ? 0.3 : 0.7,
    metalness: quality >= 3 ? 0.5 : 0.1,
  });
}

// Copy of hat creation functions (simplified for modal display)
function createCrown(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const bandGeom = new THREE.CylinderGeometry(0.5, 0.45, 0.2, 24);
  const band = new THREE.Mesh(bandGeom, mat);
  group.add(band);

  for (let i = 0; i < 5; i++) {
    const spikeGeom = new THREE.ConeGeometry(0.12, 0.4, 12);
    const spike = new THREE.Mesh(spikeGeom, mat);
    const angle = (i / 5) * Math.PI * 2;
    spike.position.set(Math.cos(angle) * 0.35, 0.3, Math.sin(angle) * 0.35);
    group.add(spike);

    if (quality >= 4) {
      const gemGeom = new THREE.OctahedronGeometry(0.06);
      const gemMat = new THREE.MeshStandardMaterial({
        color: quality >= 6 ? 0xFF0000 : 0x00FF00,
        emissive: quality >= 6 ? 0x550000 : 0x005500,
        emissiveIntensity: 0.6,
      });
      const gem = new THREE.Mesh(gemGeom, gemMat);
      gem.position.set(Math.cos(angle) * 0.35, 0.52, Math.sin(angle) * 0.35);
      group.add(gem);
    }
  }

  return group;
}

function createLaurelWreath(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const torusGeom = new THREE.TorusGeometry(0.4, 0.05, 12, 24);
  const torus = new THREE.Mesh(torusGeom, mat);
  torus.rotation.x = Math.PI / 2;
  group.add(torus);

  for (let i = 0; i < 16; i++) {
    const leafGeom = new THREE.SphereGeometry(0.08, 8, 8);
    leafGeom.scale(0.5, 1, 2);
    const leaf = new THREE.Mesh(leafGeom, mat);
    const angle = (i / 16) * Math.PI * 2;
    leaf.position.set(Math.cos(angle) * 0.4, 0.06, Math.sin(angle) * 0.4);
    leaf.rotation.y = angle;
    leaf.rotation.x = 0.3;
    group.add(leaf);
  }

  return group;
}

function createWizardHat(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const coneGeom = new THREE.ConeGeometry(0.4, 0.9, 24);
  const cone = new THREE.Mesh(coneGeom, mat);
  cone.position.y = 0.45;
  cone.rotation.z = 0.15;
  group.add(cone);

  const brimGeom = new THREE.CylinderGeometry(0.6, 0.6, 0.05, 24);
  const brim = new THREE.Mesh(brimGeom, mat);
  group.add(brim);

  if (quality >= 3) {
    const starMat = new THREE.MeshStandardMaterial({
      color: 0xFFFF00,
      emissive: 0x555500,
      emissiveIntensity: 0.6,
    });
    for (let i = 0; i < 4; i++) {
      const starGeom = new THREE.OctahedronGeometry(0.05);
      const star = new THREE.Mesh(starGeom, starMat);
      star.position.set(0.18 - i * 0.08, 0.2 + i * 0.2, 0.2);
      group.add(star);
    }
  }

  return group;
}

function createTopHat(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const cylGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.6, 24);
  const cyl = new THREE.Mesh(cylGeom, mat);
  cyl.position.y = 0.3;
  group.add(cyl);

  const brimGeom = new THREE.CylinderGeometry(0.55, 0.55, 0.05, 24);
  const brim = new THREE.Mesh(brimGeom, mat);
  group.add(brim);

  const bandGeom = new THREE.CylinderGeometry(0.36, 0.36, 0.08, 24);
  const bandMat = new THREE.MeshStandardMaterial({
    color: quality >= 4 ? 0xFFD700 : 0x8B0000,
  });
  const band = new THREE.Mesh(bandGeom, bandMat);
  band.position.y = 0.06;
  group.add(band);

  return group;
}

function createBowlerHat(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const domeGeom = new THREE.SphereGeometry(0.35, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const dome = new THREE.Mesh(domeGeom, mat);
  dome.position.y = 0.1;
  group.add(dome);

  const cylGeom = new THREE.CylinderGeometry(0.35, 0.35, 0.1, 24);
  const cyl = new THREE.Mesh(cylGeom, mat);
  cyl.position.y = 0.05;
  group.add(cyl);

  const brimGeom = new THREE.CylinderGeometry(0.5, 0.5, 0.05, 24);
  const brim = new THREE.Mesh(brimGeom, mat);
  group.add(brim);

  return group;
}

function createBaseballCap(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const capGeom = new THREE.SphereGeometry(0.4, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.Mesh(capGeom, mat);
  group.add(cap);

  const billGeom = new THREE.CylinderGeometry(0.2, 0.3, 0.02, 24, 1, false, 0, Math.PI);
  const bill = new THREE.Mesh(billGeom, mat);
  bill.rotation.x = Math.PI / 2;
  bill.position.set(0, 0, 0.35);
  group.add(bill);

  const buttonGeom = new THREE.SphereGeometry(0.05, 12, 12);
  const button = new THREE.Mesh(buttonGeom, mat);
  button.position.y = 0.4;
  group.add(button);

  return group;
}

function createDunceCap(quality: number): THREE.Group {
  const group = new THREE.Group();
  const mat = getHatMaterial(quality);

  const coneGeom = new THREE.ConeGeometry(0.35, 0.8, 16);
  const cone = new THREE.Mesh(coneGeom, mat);
  cone.position.y = 0.4;
  group.add(cone);

  if (quality >= 2) {
    const textMat = new THREE.MeshStandardMaterial({ color: 0x000000 });
    const textGeom = new THREE.SphereGeometry(0.08, 12, 12);
    textGeom.scale(2, 1, 0.3);
    const text = new THREE.Mesh(textGeom, textMat);
    text.position.set(0, 0.35, 0.3);
    group.add(text);
  }

  return group;
}

function createHat(hatType: number, hatQuality: number): THREE.Group {
  switch (hatType) {
    case 0: return createCrown(hatQuality);
    case 1: return createLaurelWreath(hatQuality);
    case 2: return createWizardHat(hatQuality);
    case 3: return createTopHat(hatQuality);
    case 4: return createBowlerHat(hatQuality);
    case 5: return createBaseballCap(hatQuality);
    case 6: return createDunceCap(hatQuality);
    default: return createWizardHat(hatQuality);
  }
}

export function VictoryHatModal({ hat, onPlayAgain }: VictoryHatModalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const animationRef = useRef<number>(0);

  useEffect(() => {
    if (!containerRef.current) return;

    // Setup scene
    const scene = new THREE.Scene();

    // Camera
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 0.5, 2.5);
    camera.lookAt(0, 0.2, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
    });
    renderer.setSize(250, 250);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    containerRef.current.appendChild(renderer.domElement);

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.2);
    keyLight.position.set(2, 4, 3);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-2, 2, -1);
    scene.add(fillLight);

    // Add glow for high-quality hats
    if (hat.hatQuality >= 5) {
      const glowLight = new THREE.PointLight(
        HAT_QUALITY_COLORS[hat.hatQuality].base,
        1,
        5
      );
      glowLight.position.set(0, 0, 1);
      scene.add(glowLight);
    }

    // Create and add hat
    const hatGroup = createHat(hat.hatType, hat.hatQuality);
    scene.add(hatGroup);

    // Animation loop
    let time = 0;
    const animate = () => {
      time += 0.016;

      // Rotate hat slowly
      hatGroup.rotation.y = time * 0.5;

      // Gentle bobbing
      hatGroup.position.y = Math.sin(time * 2) * 0.05;

      // Special effects for high quality
      if (hat.hatQuality >= 7) {
        hatGroup.scale.setScalar(1 + Math.sin(time * 3) * 0.05);
      }

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
  }, [hat]);

  const hatName = HAT_TYPE_NAMES[hat.hatType] || "Hat";
  const qualityName = HAT_QUALITY_NAMES[hat.hatQuality] || "Plain";
  const description = HAT_TYPE_DESCRIPTIONS[hat.hatType] || "";

  return (
    <div className="modal-overlay">
      <div className="modal victory-hat-modal animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="victory-header">
          <div className="game-result-icon">🏆</div>
          <h2 className="victory-title">Victory!</h2>
          <p className="victory-subtitle">You captured the opponent's king!</p>
        </div>
        <div className="hat-reward">
          <p className="hat-reward-label">You earned a hat!</p>
          <div className="hat-display" ref={containerRef} />
          <div className="hat-info">
            <h3 className="hat-name">{qualityName} {hatName}</h3>
            <p className="hat-description">{description}</p>
          </div>
        </div>
        <button className="btn btn-primary" onClick={onPlayAgain}>
          Play Again
        </button>
      </div>
    </div>
  );
}
