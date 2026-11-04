import * as THREE from 'three';

export interface ProceduralTextures {
  asphalt: THREE.CanvasTexture;
  curb: THREE.CanvasTexture;
  terrain: THREE.CanvasTexture;
  contactShadow: THREE.CanvasTexture;
  checkered: THREE.CanvasTexture;
  dispose: () => void;
}

export function createProceduralTextures(maxAnisotropy: number): ProceduralTextures {
  // 1. Asphalt Road Texture (with racing groove, aggregate grain, dashed center line, white edge lines)
  const asphaltCanvas = document.createElement('canvas');
  asphaltCanvas.width = 512;
  asphaltCanvas.height = 512;
  const actx = asphaltCanvas.getContext('2d')!;

  actx.fillStyle = '#1f242d';
  actx.fillRect(0, 0, 512, 512);

  // Subtle darker racing grooves
  const grooveGrad = actx.createLinearGradient(0, 0, 512, 0);
  grooveGrad.addColorStop(0, 'rgba(12, 15, 20, 0.35)');
  grooveGrad.addColorStop(0.18, 'rgba(12, 15, 20, 0.05)');
  grooveGrad.addColorStop(0.32, 'rgba(10, 12, 16, 0.42)');
  grooveGrad.addColorStop(0.5, 'rgba(20, 24, 30, 0.05)');
  grooveGrad.addColorStop(0.68, 'rgba(10, 12, 16, 0.42)');
  grooveGrad.addColorStop(0.82, 'rgba(12, 15, 20, 0.05)');
  grooveGrad.addColorStop(1, 'rgba(12, 15, 20, 0.35)');
  actx.fillStyle = grooveGrad;
  actx.fillRect(0, 0, 512, 512);

  // Fine mineral aggregate noise
  for (let i = 0; i < 14000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = 24 + Math.floor(Math.random() * 28);
    actx.fillStyle = `rgb(${v},${v + 3},${v + 7})`;
    actx.fillRect(x, y, 2, 2);
  }

  // Crisp white track edge lines
  actx.fillStyle = '#e2e8f0';
  actx.fillRect(18, 0, 10, 512);
  actx.fillRect(484, 0, 10, 512);

  // Subtle dashed center line
  actx.fillStyle = 'rgba(226, 232, 240, 0.38)';
  for (let y = 16; y < 512; y += 64) {
    actx.fillRect(253, y, 6, 32);
  }

  const asphalt = new THREE.CanvasTexture(asphaltCanvas);
  asphalt.colorSpace = THREE.SRGBColorSpace;
  asphalt.wrapS = THREE.RepeatWrapping;
  asphalt.wrapT = THREE.RepeatWrapping;
  asphalt.anisotropy = maxAnisotropy;

  // 2. FIA Red-and-White Rumble Curb Texture
  const curbCanvas = document.createElement('canvas');
  curbCanvas.width = 128;
  curbCanvas.height = 256;
  const cctx = curbCanvas.getContext('2d')!;
  cctx.fillStyle = '#dc2626';
  cctx.fillRect(0, 0, 128, 128);
  cctx.fillStyle = '#f8fafc';
  cctx.fillRect(0, 128, 128, 128);
  // Subtle wear
  cctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  cctx.fillRect(0, 0, 18, 256);

  const curb = new THREE.CanvasTexture(curbCanvas);
  curb.colorSpace = THREE.SRGBColorSpace;
  curb.wrapS = THREE.RepeatWrapping;
  curb.wrapT = THREE.RepeatWrapping;
  curb.anisotropy = maxAnisotropy;

  // 3. Natural Twilight Grass & Gravel Terrain Texture
  const terrainCanvas = document.createElement('canvas');
  terrainCanvas.width = 512;
  terrainCanvas.height = 512;
  const tctx = terrainCanvas.getContext('2d')!;
  tctx.fillStyle = '#1b2822';
  tctx.fillRect(0, 0, 512, 512);

  for (let i = 0; i < 12000; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const shade = Math.random();
    if (shade < 0.5) {
      tctx.fillStyle = 'rgba(34, 52, 42, 0.45)';
    } else if (shade < 0.85) {
      tctx.fillStyle = 'rgba(20, 31, 26, 0.45)';
    } else {
      tctx.fillStyle = 'rgba(54, 68, 52, 0.3)';
    }
    tctx.fillRect(x, y, 3, 3);
  }

  const terrain = new THREE.CanvasTexture(terrainCanvas);
  terrain.colorSpace = THREE.SRGBColorSpace;
  terrain.wrapS = THREE.RepeatWrapping;
  terrain.wrapT = THREE.RepeatWrapping;
  terrain.repeat.set(90, 90);
  terrain.anisotropy = maxAnisotropy;

  // 4. Soft Radial Contact Shadow Texture
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = 256;
  shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d')!;
  const radGrad = sctx.createRadialGradient(128, 128, 24, 128, 128, 124);
  radGrad.addColorStop(0, 'rgba(5, 7, 12, 0.78)');
  radGrad.addColorStop(0.6, 'rgba(5, 7, 12, 0.42)');
  radGrad.addColorStop(1, 'rgba(5, 7, 12, 0.0)');
  sctx.fillStyle = radGrad;
  sctx.fillRect(0, 0, 256, 256);

  const contactShadow = new THREE.CanvasTexture(shadowCanvas);
  contactShadow.colorSpace = THREE.SRGBColorSpace;

  // 5. Checkered Start/Finish Texture
  const checkCanvas = document.createElement('canvas');
  checkCanvas.width = 256;
  checkCanvas.height = 64;
  const kctx = checkCanvas.getContext('2d')!;
  const sq = 16;
  for (let y = 0; y < 64; y += sq) {
    for (let x = 0; x < 256; x += sq) {
      const even = ((x / sq) + (y / sq)) % 2 === 0;
      kctx.fillStyle = even ? '#f8fafc' : '#0f172a';
      kctx.fillRect(x, y, sq, sq);
    }
  }
  const checkered = new THREE.CanvasTexture(checkCanvas);
  checkered.colorSpace = THREE.SRGBColorSpace;
  checkered.wrapS = THREE.RepeatWrapping;
  checkered.wrapT = THREE.RepeatWrapping;
  checkered.anisotropy = maxAnisotropy;

  return {
    asphalt,
    curb,
    terrain,
    contactShadow,
    checkered,
    dispose: () => {
      asphalt.dispose();
      curb.dispose();
      terrain.dispose();
      contactShadow.dispose();
      checkered.dispose();
    },
  };
}
