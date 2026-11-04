import * as THREE from 'three';

export interface RaceCarRig {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  frontLeftSteer: THREE.Group;
  frontRightSteer: THREE.Group;
  wheelSpinMeshes: THREE.Group[];
  brakeLightMat: THREE.MeshStandardMaterial;
  flameLeft: THREE.Mesh;
  flameRight: THREE.Mesh;
  bodyPaintMat: THREE.MeshPhysicalMaterial;
  accentPaintMat: THREE.MeshPhysicalMaterial;
}

export function buildRaceCar(options: {
  primaryColor: number;
  accentColor: number;
  contactShadowTexture: THREE.Texture;
}): RaceCarRig {
  const root = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  root.add(bodyTiltGroup);

  // Materials with calibrated PBR roughness/metalness contrast
  const bodyPaintMat = new THREE.MeshPhysicalMaterial({
    color: options.primaryColor,
    metalness: 0.72,
    roughness: 0.2,
    clearcoat: 1.0,
    clearcoatRoughness: 0.1,
  });

  const accentPaintMat = new THREE.MeshPhysicalMaterial({
    color: options.accentColor,
    metalness: 0.55,
    roughness: 0.25,
    clearcoat: 0.9,
  });

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x161920,
    metalness: 0.25,
    roughness: 0.58,
  });

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0f172a,
    metalness: 0.15,
    roughness: 0.08,
    clearcoat: 1.0,
    clearcoatRoughness: 0.05,
  });

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd4d8e0,
    metalness: 0.92,
    roughness: 0.18,
  });

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x141619,
    metalness: 0.05,
    roughness: 0.86,
  });

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff3d1,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  const brakeLightMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xdc2626,
    emissiveIntensity: 1.2,
    roughness: 0.25,
  });

  // 1. Sculpted Aerodynamic Main Hull (ExtrudeGeometry side profile)
  // Car faces -Z (forward), +Z (rear), +X (right), -X (left)
  const hullShape = new THREE.Shape();
  hullShape.moveTo(-2.15, 0.24); // front nose tip
  hullShape.lineTo(-1.85, 0.48); // front hood slope
  hullShape.lineTo(-0.95, 0.64); // base of windshield
  hullShape.lineTo(-0.25, 1.04); // roof peak
  hullShape.lineTo(0.85, 0.98);  // fastback rear slope
  hullShape.lineTo(1.95, 0.72);  // rear deck
  hullShape.lineTo(2.12, 0.36);  // rear fascia
  hullShape.lineTo(1.75, 0.22);  // rear diffuser undercut
  hullShape.lineTo(-1.85, 0.22); // flat underbody
  hullShape.closePath();

  const hullGeo = new THREE.ExtrudeGeometry(hullShape, {
    depth: 1.72,
    bevelEnabled: true,
    bevelThickness: 0.09,
    bevelSize: 0.08,
    bevelSegments: 3,
  });
  // Rotate so extrusion depth is along X, profile is along Z-Y
  hullGeo.rotateY(Math.PI / 2);
  hullGeo.translate(-0.86, 0, 0);
  hullGeo.computeVertexNormals();

  const hullMesh = new THREE.Mesh(hullGeo, bodyPaintMat);
  hullMesh.castShadow = true;
  hullMesh.receiveShadow = true;
  bodyTiltGroup.add(hullMesh);

  // 2. Center Racing Livery Stripe (Hood & Roof)
  const stripeGeo = new THREE.BoxGeometry(0.46, 0.025, 3.85);
  const stripeMesh = new THREE.Mesh(stripeGeo, accentPaintMat);
  stripeMesh.position.set(0, 0.66, -0.05);
  // Tilt slightly to follow hood, plus roof stripe
  const hoodStripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 1.15), accentPaintMat);
  hoodStripe.position.set(0, 0.57, -1.42);
  hoodStripe.rotation.x = 0.17;
  bodyTiltGroup.add(hoodStripe);

  const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.02, 1.1), accentPaintMat);
  roofStripe.position.set(0, 1.08, 0.28);
  roofStripe.rotation.x = -0.05;
  bodyTiltGroup.add(roofStripe);

  // 3. Tinted Cockpit Canopy / Windshield
  const canopyGeo = new THREE.BoxGeometry(1.42, 0.38, 1.75);
  const canopyMesh = new THREE.Mesh(canopyGeo, glassMat);
  canopyMesh.position.set(0, 0.86, 0.12);
  bodyTiltGroup.add(canopyMesh);

  // 4. Front Carbon-Fiber Splitter & Aero Chin
  const splitterGeo = new THREE.BoxGeometry(1.94, 0.06, 0.58);
  const splitterMesh = new THREE.Mesh(splitterGeo, carbonMat);
  splitterMesh.position.set(0, 0.21, -2.02);
  splitterMesh.castShadow = true;
  bodyTiltGroup.add(splitterMesh);

  // 5. Sculpted Sidepods & Aero Skirts
  const sidepodGeo = new THREE.BoxGeometry(1.98, 0.28, 1.95);
  const sidepodMesh = new THREE.Mesh(sidepodGeo, carbonMat);
  sidepodMesh.position.set(0, 0.34, 0.05);
  sidepodMesh.castShadow = true;
  bodyTiltGroup.add(sidepodMesh);

  // 6. Rear GT Wing & Twin Endplates
  const wingBladeGeo = new THREE.BoxGeometry(1.96, 0.05, 0.34);
  const wingBlade = new THREE.Mesh(wingBladeGeo, carbonMat);
  wingBlade.position.set(0, 1.16, 1.88);
  wingBlade.rotation.x = 0.12;
  wingBlade.castShadow = true;
  bodyTiltGroup.add(wingBlade);

  const strutGeo = new THREE.BoxGeometry(0.06, 0.42, 0.22);
  const leftStrut = new THREE.Mesh(strutGeo, chromeMat);
  leftStrut.position.set(-0.52, 0.94, 1.86);
  const rightStrut = new THREE.Mesh(strutGeo, chromeMat);
  rightStrut.position.set(0.52, 0.94, 1.86);
  bodyTiltGroup.add(leftStrut, rightStrut);

  const endplateGeo = new THREE.BoxGeometry(0.04, 0.24, 0.44);
  const leftEndplate = new THREE.Mesh(endplateGeo, accentPaintMat);
  leftEndplate.position.set(-0.98, 1.16, 1.88);
  const rightEndplate = new THREE.Mesh(endplateGeo, accentPaintMat);
  rightEndplate.position.set(0.98, 1.16, 1.88);
  bodyTiltGroup.add(leftEndplate, rightEndplate);

  // 7. Rear Diffuser & Twin Chrome Exhausts
  const diffuserGeo = new THREE.BoxGeometry(1.68, 0.16, 0.32);
  const diffuserMesh = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuserMesh.position.set(0, 0.26, 2.04);
  bodyTiltGroup.add(diffuserMesh);

  const exhaustGeo = new THREE.CylinderGeometry(0.065, 0.075, 0.26, 12);
  exhaustGeo.rotateX(Math.PI / 2);
  const leftExhaust = new THREE.Mesh(exhaustGeo, chromeMat);
  leftExhaust.position.set(-0.42, 0.3, 2.12);
  const rightExhaust = new THREE.Mesh(exhaustGeo, chromeMat);
  rightExhaust.position.set(0.42, 0.3, 2.12);
  bodyTiltGroup.add(leftExhaust, rightExhaust);

  // Nitro Flame Cones
  const flameGeo = new THREE.ConeGeometry(0.085, 0.75, 10);
  flameGeo.rotateX(Math.PI / 2);
  flameGeo.translate(0, 0, 0.38);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.9,
  });
  const flameLeft = new THREE.Mesh(flameGeo, flameMat);
  flameLeft.position.set(-0.42, 0.3, 2.2);
  flameLeft.visible = false;
  const flameRight = new THREE.Mesh(flameGeo, flameMat);
  flameRight.position.set(0.42, 0.3, 2.2);
  flameRight.visible = false;
  bodyTiltGroup.add(flameLeft, flameRight);

  // 8. Front LED Headlights & Rear LED Taillight Bar
  const hlGeo = new THREE.BoxGeometry(0.36, 0.06, 0.12);
  const leftHL = new THREE.Mesh(hlGeo, headlightMat);
  leftHL.position.set(-0.66, 0.42, -2.14);
  const rightHL = new THREE.Mesh(hlGeo, headlightMat);
  rightHL.position.set(0.66, 0.42, -2.14);
  bodyTiltGroup.add(leftHL, rightHL);

  const tailBarGeo = new THREE.BoxGeometry(1.66, 0.07, 0.08);
  const tailBar = new THREE.Mesh(tailBarGeo, brakeLightMat);
  tailBar.position.set(0, 0.62, 2.14);
  bodyTiltGroup.add(tailBar);

  // 9. Four Independent Articulated Wheel Assemblies
  const wheelRadius = 0.35;
  const wheelWidth = 0.28;
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelWidth, 20);
  tireGeo.rotateZ(Math.PI / 2);

  const rimGeo = new THREE.CylinderGeometry(wheelRadius * 0.62, wheelRadius * 0.62, wheelWidth + 0.015, 14);
  rimGeo.rotateZ(Math.PI / 2);

  const spokeGeo = new THREE.BoxGeometry(wheelWidth + 0.025, wheelRadius * 1.1, 0.045);

  const wheelSpinMeshes: THREE.Group[] = [];

  const createWheel = (x: number, z: number, isFront: boolean) => {
    const steerGroup = new THREE.Group();
    steerGroup.position.set(x, wheelRadius, z);

    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    const rim = new THREE.Mesh(rimGeo, chromeMat);
    const spoke1 = new THREE.Mesh(spokeGeo, chromeMat);
    const spoke2 = new THREE.Mesh(spokeGeo, chromeMat);
    spoke2.rotation.x = Math.PI / 2;

    spinGroup.add(tire, rim, spoke1, spoke2);
    steerGroup.add(spinGroup);
    root.add(steerGroup);

    wheelSpinMeshes.push(spinGroup);
    return steerGroup;
  };

  const frontLeftSteer = createWheel(-0.94, -1.36, true);
  const frontRightSteer = createWheel(0.94, -1.36, true);
  createWheel(-0.96, 1.34, false);
  createWheel(0.96, 1.34, false);

  // 10. Grounded Soft Radial Contact Shadow Plane
  const shadowPlaneGeo = new THREE.PlaneGeometry(2.7, 4.9);
  shadowPlaneGeo.rotateX(-Math.PI / 2);
  const shadowPlaneMat = new THREE.MeshBasicMaterial({
    map: options.contactShadowTexture,
    transparent: true,
    depthWrite: false,
  });
  const shadowPlane = new THREE.Mesh(shadowPlaneGeo, shadowPlaneMat);
  shadowPlane.position.y = 0.022;
  root.add(shadowPlane);

  return {
    root,
    bodyTiltGroup,
    frontLeftSteer,
    frontRightSteer,
    wheelSpinMeshes,
    brakeLightMat,
    flameLeft,
    flameRight,
    bodyPaintMat,
    accentPaintMat,
  };
}
