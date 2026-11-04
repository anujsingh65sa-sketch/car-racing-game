import * as THREE from 'three';
import { ProceduralTextures } from './textures';

export interface TrackSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3; // perpendicular on XZ plane (pointing right of forward tangent)
  t: number;
}

export interface BoostPad {
  position: THREE.Vector3;
  t: number;
  mesh: THREE.Mesh;
}

export interface TrackQueryResult {
  sampleIndex: number;
  t: number;
  signedOffset: number; // + = right of center, - = left of center
  distanceFromCenter: number;
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
}

export const TRACK_HALF_WIDTH = 7.75; // 15.5m wide asphalt
export const BARRIER_HALF_WIDTH = 11.4; // 22.8m between guardrails

export class CircuitTrack {
  public readonly curve: THREE.CatmullRomCurve3;
  public readonly samples: TrackSample[] = [];
  public readonly totalLength: number;
  public readonly boostPads: BoostPad[] = [];
  public readonly countdownLights: THREE.MeshBasicMaterial[] = [];
  public readonly minimapTrack: Array<{ x: number; z: number }> = [];

  private readonly sampleCount = 720;

  constructor(scene: THREE.Scene, textures: ProceduralTextures) {
    // Classic Grand Prix closed-loop circuit control points
    const controlPoints = [
      new THREE.Vector3(0, 0, 140),
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -155),
      new THREE.Vector3(48, 0, -235),
      new THREE.Vector3(145, 0, -245),
      new THREE.Vector3(215, 0, -180),
      new THREE.Vector3(195, 0, -95),
      new THREE.Vector3(120, 0, -55),
      new THREE.Vector3(125, 0, 35),
      new THREE.Vector3(215, 0, 95),
      new THREE.Vector3(225, 0, 195),
      new THREE.Vector3(145, 0, 255),
      new THREE.Vector3(45, 0, 235),
    ];

    this.curve = new THREE.CatmullRomCurve3(controlPoints, true, 'catmullrom', 0.45);
    this.totalLength = this.curve.getLength();

    // Pre-sample evenly spaced frames
    for (let i = 0; i < this.sampleCount; i++) {
      const t = i / this.sampleCount;
      const point = this.curve.getPointAt(t);
      const tangent = this.curve.getTangentAt(t).normalize();
      // Right vector on XZ plane: tangent x UP (0,1,0)
      const right = new THREE.Vector3(-tangent.z, 0, tangent.x).normalize();
      this.samples.push({ point, tangent, right, t });
    }

    // Build normalized minimap points (90 samples)
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < 90; i++) {
      const p = this.samples[Math.floor((i / 90) * this.sampleCount)].point;
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.z < minZ) minZ = p.z;
      if (p.z > maxZ) maxZ = p.z;
    }
    const span = Math.max(maxX - minX, maxZ - minZ);
    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    for (let i = 0; i < 90; i++) {
      const p = this.samples[Math.floor((i / 90) * this.sampleCount)].point;
      this.minimapTrack.push({
        x: ((p.x - cx) / span) * 84 + 50,
        z: ((p.z - cz) / span) * 84 + 50,
      });
    }

    this.buildTerrain(scene, textures);
    this.buildRoadAndCurbs(scene, textures);
    this.buildGuardrails(scene);
    this.buildStartGantry(scene, textures);
    this.buildBoostPads(scene);
    this.buildTracksideProps(scene, cx, cz, span);
  }

  private buildTerrain(scene: THREE.Scene, textures: ProceduralTextures): void {
    const groundGeo = new THREE.PlaneGeometry(1800, 1800);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      map: textures.terrain,
      roughness: 0.92,
      metalness: 0.02,
    });
    const ground = new THREE.Mesh(groundGeo, groundMat);
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    scene.add(ground);
  }

  private buildRoadAndCurbs(scene: THREE.Scene, textures: ProceduralTextures): void {
    const N = this.sampleCount;
    const roadPositions: number[] = [];
    const roadNormals: number[] = [];
    const roadUvs: number[] = [];
    const roadIndices: number[] = [];

    const curbPositions: number[] = [];
    const curbNormals: number[] = [];
    const curbUvs: number[] = [];
    const curbIndices: number[] = [];

    const curbWidth = 1.15;
    const uvRepeatLength = this.totalLength / 18;

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const vCoord = (i / N) * uvRepeatLength;

      // Road left & right vertices
      const leftPt = s.point.clone().addScaledVector(s.right, -TRACK_HALF_WIDTH);
      const rightPt = s.point.clone().addScaledVector(s.right, TRACK_HALF_WIDTH);

      roadPositions.push(leftPt.x, 0.01, leftPt.z);
      roadPositions.push(rightPt.x, 0.01, rightPt.z);
      roadNormals.push(0, 1, 0, 0, 1, 0);
      roadUvs.push(0, vCoord, 1, vCoord);

      // Left curb & Right curb
      const lCurbOut = s.point.clone().addScaledVector(s.right, -(TRACK_HALF_WIDTH + curbWidth));
      const lCurbIn = leftPt;
      const rCurbIn = rightPt;
      const rCurbOut = s.point.clone().addScaledVector(s.right, TRACK_HALF_WIDTH + curbWidth);

      curbPositions.push(
        lCurbOut.x, 0.025, lCurbOut.z,
        lCurbIn.x, 0.025, lCurbIn.z,
        rCurbIn.x, 0.025, rCurbIn.z,
        rCurbOut.x, 0.025, rCurbOut.z
      );
      curbNormals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
      const curbV = (i / N) * (this.totalLength / 6);
      curbUvs.push(0, curbV, 1, curbV, 0, curbV, 1, curbV);

      if (i < N) {
        const rBase = i * 2;
        roadIndices.push(rBase, rBase + 1, rBase + 2);
        roadIndices.push(rBase + 1, rBase + 3, rBase + 2);

        const cBase = i * 4;
        // Left curb quad
        curbIndices.push(cBase, cBase + 1, cBase + 4);
        curbIndices.push(cBase + 1, cBase + 5, cBase + 4);
        // Right curb quad
        curbIndices.push(cBase + 2, cBase + 3, cBase + 6);
        curbIndices.push(cBase + 3, cBase + 7, cBase + 6);
      }
    }

    const roadGeo = new THREE.BufferGeometry();
    roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
    roadGeo.setAttribute('normal', new THREE.Float32BufferAttribute(roadNormals, 3));
    roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
    roadGeo.setIndex(roadIndices);

    const roadMat = new THREE.MeshStandardMaterial({
      map: textures.asphalt,
      roughness: 0.78,
      metalness: 0.08,
    });
    const roadMesh = new THREE.Mesh(roadGeo, roadMat);
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    const curbGeo = new THREE.BufferGeometry();
    curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
    curbGeo.setAttribute('normal', new THREE.Float32BufferAttribute(curbNormals, 3));
    curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUvs, 2));
    curbGeo.setIndex(curbIndices);

    const curbMat = new THREE.MeshStandardMaterial({
      map: textures.curb,
      roughness: 0.65,
      metalness: 0.05,
    });
    const curbMesh = new THREE.Mesh(curbGeo, curbMat);
    curbMesh.receiveShadow = true;
    scene.add(curbMesh);
  }

  private buildGuardrails(scene: THREE.Scene): void {
    const N = this.sampleCount;
    const railPositions: number[] = [];
    const railNormals: number[] = [];
    const railIndices: number[] = [];

    const railHeight = 0.62;
    const railBottom = 0.14;

    for (let i = 0; i <= N; i++) {
      const s = this.samples[i % N];
      const lPt = s.point.clone().addScaledVector(s.right, -BARRIER_HALF_WIDTH);
      const rPt = s.point.clone().addScaledVector(s.right, BARRIER_HALF_WIDTH);

      // Left barrier inner face (normal points +right)
      railPositions.push(
        lPt.x, railBottom, lPt.z,
        lPt.x, railHeight, lPt.z,
        rPt.x, railBottom, rPt.z,
        rPt.x, railHeight, rPt.z
      );
      railNormals.push(
        s.right.x, 0, s.right.z,
        s.right.x, 0, s.right.z,
        -s.right.x, 0, -s.right.z,
        -s.right.x, 0, -s.right.z
      );

      if (i < N) {
        const b = i * 4;
        // Left rail
        railIndices.push(b, b + 4, b + 1);
        railIndices.push(b + 1, b + 4, b + 5);
        // Right rail
        railIndices.push(b + 2, b + 3, b + 6);
        railIndices.push(b + 3, b + 7, b + 6);
      }
    }

    const railGeo = new THREE.BufferGeometry();
    railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
    railGeo.setAttribute('normal', new THREE.Float32BufferAttribute(railNormals, 3));
    railGeo.setIndex(railIndices);

    const railMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.75,
      roughness: 0.35,
      side: THREE.DoubleSide,
    });
    const railMesh = new THREE.Mesh(railGeo, railMat);
    railMesh.castShadow = true;
    railMesh.receiveShadow = true;
    scene.add(railMesh);
  }

  private buildStartGantry(scene: THREE.Scene, textures: ProceduralTextures): void {
    const startSample = this.samples[0];
    const gantryGroup = new THREE.Group();
    gantryGroup.position.copy(startSample.point);
    const angle = Math.atan2(-startSample.tangent.x, -startSample.tangent.z);
    gantryGroup.rotation.y = angle;

    // Checkered start/finish line on asphalt
    const lineGeo = new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2, 3.2);
    lineGeo.rotateX(-Math.PI / 2);
    const lineMat = new THREE.MeshStandardMaterial({
      map: textures.checkered,
      roughness: 0.7,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.position.y = 0.02;
    gantryGroup.add(lineMesh);

    // Gantry pillars & overhead bridge
    const pillarMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      metalness: 0.8,
      roughness: 0.3,
    });
    const pillarGeo = new THREE.BoxGeometry(0.65, 6.2, 0.65);
    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-TRACK_HALF_WIDTH - 1.2, 3.1, 0);
    leftPillar.castShadow = true;
    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(TRACK_HALF_WIDTH + 1.2, 3.1, 0);
    rightPillar.castShadow = true;
    gantryGroup.add(leftPillar, rightPillar);

    const bridgeGeo = new THREE.BoxGeometry(TRACK_HALF_WIDTH * 2 + 3.2, 1.35, 0.9);
    const bridgeMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      metalness: 0.6,
      roughness: 0.35,
    });
    const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
    bridge.position.set(0, 5.8, 0);
    bridge.castShadow = true;
    gantryGroup.add(bridge);

    // 3 Countdown Signal Lamps
    const lampGeo = new THREE.SphereGeometry(0.24, 16, 16);
    for (let i = -1; i <= 1; i++) {
      const lampMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });
      const lamp = new THREE.Mesh(lampGeo, lampMat);
      lamp.position.set(i * 1.1, 5.8, 0.48);
      gantryGroup.add(lamp);
      this.countdownLights.push(lampMat);
    }

    scene.add(gantryGroup);
  }

  private buildBoostPads(scene: THREE.Scene): void {
    const padTs = [0.08, 0.21, 0.35, 0.48, 0.62, 0.76, 0.88];
    const padGeo = new THREE.PlaneGeometry(2.8, 6.5);
    padGeo.rotateX(-Math.PI / 2);

    padTs.forEach((t, idx) => {
      const s = this.samples[Math.floor(t * this.sampleCount) % this.sampleCount];
      const lateral = (idx % 2 === 0 ? -1 : 1) * 2.4;
      const pos = s.point.clone().addScaledVector(s.right, lateral);
      pos.y = 0.026;

      const padMat = new THREE.MeshBasicMaterial({
        color: 0x06b6d4,
        transparent: true,
        opacity: 0.78,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });

      const mesh = new THREE.Mesh(padGeo, padMat);
      mesh.position.copy(pos);
      mesh.rotation.y = Math.atan2(-s.tangent.x, -s.tangent.z);
      scene.add(mesh);

      this.boostPads.push({ position: pos, t, mesh });
    });
  }

  private buildTracksideProps(scene: THREE.Scene, cx: number, cz: number, span: number): void {
    // 1. InstancedMesh Cypress Trees (220 instances with ±15% scale & tint variation)
    const treeCount = 220;
    const coneGeo = new THREE.ConeGeometry(2.1, 8.5, 7);
    coneGeo.translate(0, 4.25, 0);
    const treeMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.85,
      metalness: 0.05,
    });
    const treeInstanced = new THREE.InstancedMesh(coneGeo, treeMat, treeCount);
    treeInstanced.castShadow = true;
    treeInstanced.receiveShadow = true;

    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;
    let attempts = 0;

    while (placed < treeCount && attempts < 2000) {
      attempts++;
      const rx = cx + (Math.random() - 0.5) * (span + 260);
      const rz = cz + (Math.random() - 0.5) * (span + 260);

      // Ensure tree is safely outside the track & guardrails
      const info = this.getTrackInfo(rx, rz);
      if (info.distanceFromCenter < BARRIER_HALF_WIDTH + 6.5) continue;

      const scaleXZ = 0.85 + Math.random() * 0.3;
      const scaleY = 0.85 + Math.random() * 0.35;
      dummy.position.set(rx, -0.05, rz);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.scale.set(scaleXZ, scaleY, scaleXZ);
      dummy.updateMatrix();
      treeInstanced.setMatrixAt(placed, dummy.matrix);

      // Subtle foliage tint variation
      color.setHSL(0.36 + (Math.random() - 0.5) * 0.04, 0.34, 0.16 + Math.random() * 0.08);
      treeInstanced.setColorAt(placed, color);
      placed++;
    }
    treeInstanced.count = placed;
    treeInstanced.instanceMatrix.needsUpdate = true;
    if (treeInstanced.instanceColor) treeInstanced.instanceColor.needsUpdate = true;
    treeInstanced.computeBoundingSphere();
    scene.add(treeInstanced);

    // 2. InstancedMesh Trackside Light Poles (48 poles)
    const poleCount = 48;
    const poleGeo = new THREE.CylinderGeometry(0.12, 0.16, 7.5, 8);
    poleGeo.translate(0, 3.75, 0);
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      metalness: 0.8,
      roughness: 0.3,
    });
    const poleInstanced = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);

    const bulbGeo = new THREE.BoxGeometry(0.9, 0.18, 0.35);
    const bulbMat = new THREE.MeshBasicMaterial({ color: 0xfef3c7 });
    const bulbInstanced = new THREE.InstancedMesh(bulbGeo, bulbMat, poleCount);

    for (let i = 0; i < poleCount; i++) {
      const s = this.samples[Math.floor((i / poleCount) * this.sampleCount)];
      const side = i % 2 === 0 ? 1 : -1;
      const pos = s.point.clone().addScaledVector(s.right, side * (BARRIER_HALF_WIDTH + 1.2));
      const yaw = Math.atan2(-s.tangent.x, -s.tangent.z);

      dummy.position.set(pos.x, 0, pos.z);
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poleInstanced.setMatrixAt(i, dummy.matrix);

      const bulbPos = pos.clone().addScaledVector(s.right, -side * 0.45);
      dummy.position.set(bulbPos.x, 7.45, bulbPos.z);
      dummy.updateMatrix();
      bulbInstanced.setMatrixAt(i, dummy.matrix);
    }
    poleInstanced.instanceMatrix.needsUpdate = true;
    poleInstanced.computeBoundingSphere();
    bulbInstanced.instanceMatrix.needsUpdate = true;
    bulbInstanced.computeBoundingSphere();
    scene.add(poleInstanced, bulbInstanced);
  }

  public getTrackInfo(x: number, z: number, hintIndex?: number): TrackQueryResult {
    const N = this.sampleCount;
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined) {
      // Search local window of ±36 samples first
      const windowRadius = 36;
      for (let offset = -windowRadius; offset <= windowRadius; offset++) {
        const idx = (hintIndex + offset + N) % N;
        const p = this.samples[idx].point;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = idx;
        }
      }
      // Fallback to full scan if car jumped far
      if (bestDistSq > 900) {
        for (let i = 0; i < N; i++) {
          const p = this.samples[i].point;
          const dx = x - p.x;
          const dz = z - p.z;
          const dSq = dx * dx + dz * dz;
          if (dSq < bestDistSq) {
            bestDistSq = dSq;
            bestIdx = i;
          }
        }
      }
    } else {
      for (let i = 0; i < N; i++) {
        const p = this.samples[i].point;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestDistSq) {
          bestDistSq = dSq;
          bestIdx = i;
        }
      }
    }

    const s = this.samples[bestIdx];
    const dx = x - s.point.x;
    const dz = z - s.point.z;
    const signedOffset = dx * s.right.x + dz * s.right.z;

    return {
      sampleIndex: bestIdx,
      t: s.t,
      signedOffset,
      distanceFromCenter: Math.abs(signedOffset),
      point: s.point,
      tangent: s.tangent,
      right: s.right,
    };
  }
}
