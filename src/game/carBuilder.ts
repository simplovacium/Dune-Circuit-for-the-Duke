import * as THREE from 'three';
import type { LiveryPattern, RimStyle, VehicleConfig } from '../shared/types.ts';

export interface CarModelRig {
  root: THREE.Group;
  bodyGroup: THREE.Group;
  frontWheels: THREE.Group[];
  allSpinWheels: THREE.Group[];
  taillightMat: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Group;
  shieldShell: THREE.Group;
  muzzleFlashes: THREE.Group;
  dispose: () => void;
}

function createLiveryTexture(
  primaryHex: string,
  accentHex: string,
  livery: LiveryPattern,
  maxAnisotropy: number
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = primaryHex;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = accentHex;
  if (livery === 'single_stripe') {
    ctx.fillRect(228, 0, 56, 512);
  } else if (livery === 'stripe') {
    ctx.fillRect(216, 0, 32, 512);
    ctx.fillRect(264, 0, 32, 512);
  } else if (livery === 'sweep') {
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(512, 220);
    ctx.lineTo(512, 310);
    ctx.lineTo(0, 140);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = 0.65;
    ctx.beginPath();
    ctx.moveTo(0, 360);
    ctx.lineTo(512, 430);
    ctx.lineTo(512, 470);
    ctx.lineTo(0, 410);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  } else if (livery === 'chevron') {
    for (let y = 40; y < 480; y += 140) {
      ctx.beginPath();
      ctx.moveTo(96, y + 60);
      ctx.lineTo(256, y);
      ctx.lineTo(416, y + 60);
      ctx.lineTo(416, y + 100);
      ctx.lineTo(256, y + 40);
      ctx.lineTo(96, y + 100);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Subtle panel seam lines for realism
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = 3;
  ctx.strokeRect(12, 12, 488, 488);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, 'rgba(0,0,0,0.68)');
  grad.addColorStop(0.65, 'rgba(0,0,0,0.28)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

function buildWheelAssembly(
  radius: number,
  width: number,
  rimStyle: RimStyle,
  rimMat: THREE.Material,
  tireMat: THREE.Material,
  caliperMat: THREE.Material,
  disposables: { geometries: THREE.BufferGeometry[] }
): { steerPivot: THREE.Group; spinGroup: THREE.Group } {
  const steerPivot = new THREE.Group();
  const spinGroup = new THREE.Group();
  steerPivot.add(spinGroup);

  // Rubber tire
  const tireGeo = new THREE.CylinderGeometry(radius, radius, width, 24);
  tireGeo.rotateZ(Math.PI / 2);
  disposables.geometries.push(tireGeo);
  const tireMesh = new THREE.Mesh(tireGeo, tireMat);
  tireMesh.castShadow = true;
  spinGroup.add(tireMesh);

  // Rim barrel
  const rimGeo = new THREE.CylinderGeometry(radius * 0.64, radius * 0.64, width * 1.03, 20);
  rimGeo.rotateZ(Math.PI / 2);
  disposables.geometries.push(rimGeo);
  const rimMesh = new THREE.Mesh(rimGeo, rimMat);
  spinGroup.add(rimMesh);

  // Spokes / Turbofan detail
  const spokeCount = rimStyle === 'mesh' ? 10 : rimStyle === 'forged' ? 5 : 1;
  if (rimStyle === 'turbofan') {
    const discGeo = new THREE.CylinderGeometry(radius * 0.61, radius * 0.61, width * 1.06, 20);
    discGeo.rotateZ(Math.PI / 2);
    disposables.geometries.push(discGeo);
    const disc = new THREE.Mesh(discGeo, rimMat);
    spinGroup.add(disc);
  } else {
    const spokeGeo = new THREE.BoxGeometry(width * 1.07, radius * 1.16, radius * 0.11);
    disposables.geometries.push(spokeGeo);
    for (let i = 0; i < spokeCount; i++) {
      const spoke = new THREE.Mesh(spokeGeo, rimMat);
      spoke.rotation.x = (i * Math.PI) / spokeCount;
      spinGroup.add(spoke);
    }
  }

  // Brake caliper accent (mounted on steerPivot so it stays upright)
  const caliperGeo = new THREE.BoxGeometry(width * 0.55, radius * 0.42, radius * 0.34);
  disposables.geometries.push(caliperGeo);
  const caliper = new THREE.Mesh(caliperGeo, caliperMat);
  caliper.position.set(0, radius * 0.16, -radius * 0.28);
  steerPivot.add(caliper);

  return { steerPivot, spinGroup };
}

export function buildVehicleModel(
  config: VehicleConfig,
  maxAnisotropy = 4,
  isSoftwareGl = false
): CarModelRig {
  const root = new THREE.Group();
  const bodyGroup = new THREE.Group();
  root.add(bodyGroup);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

  const liveryTex = createLiveryTexture(
    config.primaryColor,
    config.accentColor,
    config.livery,
    maxAnisotropy
  );
  textures.push(liveryTex);

  // Physically calibrated materials with >= 0.25 roughness contrast between body & trim
  const paintMat = new THREE.MeshPhysicalMaterial({
    map: liveryTex,
    metalness: config.finish === 'matte' ? 0.25 : 0.65,
    roughness: config.finish === 'matte' ? 0.72 : config.finish === 'pearl' ? 0.18 : 0.26,
    clearcoat: config.finish === 'matte' ? 0.04 : 1.0,
    clearcoatRoughness: config.finish === 'pearl' ? 0.08 : 0.14,
    iridescence: !isSoftwareGl && config.finish === 'pearl' ? 0.45 : 0,
  });
  materials.push(paintMat);

  const carbonMat = new THREE.MeshStandardMaterial({
    color: 0x16181d,
    metalness: 0.2,
    roughness: 0.68,
  });
  materials.push(carbonMat);

  const accentMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.accentColor),
    metalness: 0.5,
    roughness: 0.3,
  });
  materials.push(accentMat);

  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x0b1220,
    metalness: 0.15,
    roughness: 0.06,
    clearcoat: 1.0,
    transparent: true,
    opacity: 0.86,
  });
  materials.push(glassMat);

  const tireMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.05,
    roughness: 0.88,
  });
  materials.push(tireMat);

  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(config.rimColor),
    metalness: 0.88,
    roughness: 0.22,
  });
  materials.push(rimMat);

  const caliperMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    metalness: 0.4,
    roughness: 0.35,
  });
  materials.push(caliperMat);

  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.2,
    roughness: 0.1,
  });
  materials.push(headlightMat);

  const taillightMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xef4444,
    emissiveIntensity: 1.6,
    roughness: 0.2,
  });
  materials.push(taillightMat);

  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xd4d4d8,
    metalness: 0.94,
    roughness: 0.16,
  });
  materials.push(chromeMat);

  // Contact shadow grounding plane
  const shadowTex = createContactShadowTexture();
  textures.push(shadowTex);
  const shadowGeo = new THREE.PlaneGeometry(2.9, 5.4);
  shadowGeo.rotateX(-Math.PI / 2);
  geometries.push(shadowGeo);
  const shadowMat = new THREE.MeshBasicMaterial({
    map: shadowTex,
    transparent: true,
    depthWrite: false,
    opacity: 0.65,
  });
  materials.push(shadowMat);
  const contactShadow = new THREE.Mesh(shadowGeo, shadowMat);
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  // Optional Underglow
  if (config.underglow !== 'none') {
    const glowColors: Record<string, number> = {
      amber: 0xf59e0b,
      cyan: 0x06b6d4,
      crimson: 0xef4444,
      emerald: 0x10b981,
    };
    const glowGeo = new THREE.PlaneGeometry(2.55, 4.8);
    glowGeo.rotateX(-Math.PI / 2);
    geometries.push(glowGeo);
    const glowMat = new THREE.MeshBasicMaterial({
      color: glowColors[config.underglow] ?? 0x06b6d4,
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
      blending: THREE.AdditiveBlending,
    });
    materials.push(glowMat);
    const glowPlane = new THREE.Mesh(glowGeo, glowMat);
    glowPlane.position.y = 0.038;
    bodyGroup.add(glowPlane);
  }

  // Chassis-specific silhouette proportions (car faces -Z forward)
  const isEscort = config.chassis === 'escort';
  const isVortex = config.chassis === 'vortex';
  const isStratos = config.chassis === 'stratos';
  const isKurogane = config.chassis === 'kurogane';

  // 1. Carbon Lower Floor / Splitter / Diffuser
  const floorWidth = isVortex ? 1.55 : isEscort ? 1.82 : isKurogane ? 2.08 : 1.98;
  const floorLength = isStratos ? 4.65 : isEscort ? 4.12 : 4.45;
  const floorGeo = new THREE.BoxGeometry(floorWidth, 0.12, floorLength);
  geometries.push(floorGeo);
  const floorMesh = new THREE.Mesh(floorGeo, carbonMat);
  floorMesh.position.set(0, 0.24, 0);
  floorMesh.castShadow = true;
  bodyGroup.add(floorMesh);

  if (!isEscort) {
    // Front aero splitter lip
    const splitterGeo = new THREE.BoxGeometry(floorWidth + 0.08, 0.07, 0.52);
    geometries.push(splitterGeo);
    const splitter = new THREE.Mesh(splitterGeo, carbonMat);
    splitter.position.set(0, 0.2, -floorLength / 2 - 0.08);
    bodyGroup.add(splitter);
  }

  // 2. Sculpted Main Body (ExtrudeGeometry side profile rotated into X-Z)
  const bodyShape = new THREE.Shape();
  if (isEscort) {
    // Classic 2-door Ford Escort RS boxy coupe lower body
    bodyShape.moveTo(-2.06, 0.3);
    bodyShape.lineTo(-2.04, 0.69);
    bodyShape.lineTo(-0.74, 0.75);
    bodyShape.lineTo(1.22, 0.77);
    bodyShape.lineTo(1.98, 0.74);
    bodyShape.lineTo(2.02, 0.31);
    bodyShape.closePath();
  } else if (isVortex) {
    // Open-wheel needle nose + sidepods
    bodyShape.moveTo(-2.35, 0.24);
    bodyShape.lineTo(-1.1, 0.44);
    bodyShape.lineTo(0.8, 0.58);
    bodyShape.lineTo(2.1, 0.54);
    bodyShape.lineTo(2.15, 0.26);
    bodyShape.closePath();
  } else if (isStratos) {
    // Low Le Mans prototype wedge
    bodyShape.moveTo(-2.28, 0.24);
    bodyShape.quadraticCurveTo(-1.6, 0.62, -0.5, 0.68);
    bodyShape.lineTo(1.75, 0.72);
    bodyShape.lineTo(2.22, 0.62);
    bodyShape.lineTo(2.22, 0.25);
    bodyShape.closePath();
  } else {
    // GT3 / Widebody coupe
    bodyShape.moveTo(-2.2, 0.25);
    bodyShape.quadraticCurveTo(-1.85, 0.64, -0.75, 0.74);
    bodyShape.lineTo(1.65, 0.78);
    bodyShape.lineTo(2.18, 0.66);
    bodyShape.lineTo(2.18, 0.26);
    bodyShape.closePath();
  }

  const bodyWidth = isVortex ? 0.66 : isEscort ? 1.76 : isKurogane ? 1.96 : 1.88;
  const mainBodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
    depth: bodyWidth,
    bevelEnabled: true,
    bevelThickness: isEscort ? 0.05 : 0.08,
    bevelSize: isEscort ? 0.04 : 0.06,
    bevelSegments: isEscort ? 2 : 3,
  });
  // Extrude is in XY with Z depth -> rotate Y -90 deg so X-profile runs along Z (-Z front)
  mainBodyGeo.translate(0, 0, -bodyWidth / 2);
  mainBodyGeo.rotateY(-Math.PI / 2);
  geometries.push(mainBodyGeo);

  // Use solid primary paint on Escort hull so ExtrudeGeometry UVs never smear stripes;
  // Escort's crisp stripe(s) are applied as flush 3D painted bands along hood/roof/boot.
  const escortBaseMat = isEscort
    ? new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(config.primaryColor),
        metalness: config.finish === 'matte' ? 0.12 : 0.28,
        roughness: config.finish === 'matte' ? 0.72 : config.finish === 'pearl' ? 0.18 : 0.24,
        clearcoat: config.finish === 'matte' ? 0.04 : 1.0,
        clearcoatRoughness: 0.12,
      })
    : paintMat;
  if (isEscort) materials.push(escortBaseMat);

  const mainBody = new THREE.Mesh(mainBodyGeo, escortBaseMat);
  mainBody.castShadow = true;
  mainBody.receiveShadow = true;
  bodyGroup.add(mainBody);

  // Sidepods / Widebody Fenders / Escort Trims
  if (isEscort) {
    // Dark satin side sills + boxy rally fender flares
    const sillGeo = new THREE.BoxGeometry(0.1, 0.14, 2.05);
    geometries.push(sillGeo);
    const leftSill = new THREE.Mesh(sillGeo, carbonMat);
    leftSill.position.set(-bodyWidth / 2 - 0.03, 0.3, 0);
    const rightSill = new THREE.Mesh(sillGeo, carbonMat);
    rightSill.position.set(bodyWidth / 2 + 0.03, 0.3, 0);
    bodyGroup.add(leftSill, rightSill);

    const archGeo = new THREE.BoxGeometry(0.14, 0.22, 0.86);
    geometries.push(archGeo);
    for (const ax of [-bodyWidth / 2 - 0.04, bodyWidth / 2 + 0.04]) {
      for (const az of [-1.42, 1.38]) {
        const arch = new THREE.Mesh(archGeo, escortBaseMat);
        arch.position.set(ax, 0.54, az);
        arch.castShadow = true;
        bodyGroup.add(arch);
      }
    }

    // Classic chrome front & rear bumpers + matte grille + Ford oval emblem
    const bumperGeo = new THREE.BoxGeometry(1.86, 0.09, 0.12);
    geometries.push(bumperGeo);
    const frontBumper = new THREE.Mesh(bumperGeo, chromeMat);
    frontBumper.position.set(0, 0.34, -2.14);
    const rearBumper = new THREE.Mesh(bumperGeo, chromeMat);
    rearBumper.position.set(0, 0.34, 2.08);
    bodyGroup.add(frontBumper, rearBumper);

    const grilleGeo = new THREE.BoxGeometry(1.44, 0.23, 0.06);
    geometries.push(grilleGeo);
    const grille = new THREE.Mesh(grilleGeo, carbonMat);
    grille.position.set(0, 0.54, -2.09);
    bodyGroup.add(grille);

    const badgeGeo = new THREE.CylinderGeometry(0.065, 0.065, 0.03, 14);
    badgeGeo.rotateX(Math.PI / 2);
    badgeGeo.scale(1.5, 0.8, 1);
    geometries.push(badgeGeo);
    const badgeMat = new THREE.MeshStandardMaterial({
      color: 0x1d4ed8,
      metalness: 0.45,
      roughness: 0.25,
    });
    materials.push(badgeMat);
    const badge = new THREE.Mesh(badgeGeo, badgeMat);
    badge.position.set(0, 0.55, -2.125);
    bodyGroup.add(badge);
  } else if (isVortex) {
    const podGeo = new THREE.BoxGeometry(0.56, 0.34, 2.05);
    geometries.push(podGeo);
    const leftPod = new THREE.Mesh(podGeo, paintMat);
    leftPod.position.set(-0.66, 0.42, 0.35);
    leftPod.castShadow = true;
    const rightPod = new THREE.Mesh(podGeo, paintMat);
    rightPod.position.set(0.66, 0.42, 0.35);
    rightPod.castShadow = true;
    bodyGroup.add(leftPod, rightPod);

    // Front wing for open-wheel
    const fwGeo = new THREE.BoxGeometry(2.05, 0.06, 0.44);
    geometries.push(fwGeo);
    const fw = new THREE.Mesh(fwGeo, accentMat);
    fw.position.set(0, 0.23, -2.28);
    bodyGroup.add(fw);
  } else {
    const skirtGeo = new THREE.BoxGeometry(0.14, 0.2, 2.35);
    geometries.push(skirtGeo);
    const leftSkirt = new THREE.Mesh(skirtGeo, accentMat);
    leftSkirt.position.set(-bodyWidth / 2 - 0.06, 0.28, 0);
    const rightSkirt = new THREE.Mesh(skirtGeo, accentMat);
    rightSkirt.position.set(bodyWidth / 2 + 0.06, 0.28, 0);
    bodyGroup.add(leftSkirt, rightSkirt);
  }

  // 3. Cockpit Canopy (Escort uses painted white roof & pillars + inset dark windows)
  if (isEscort) {
    const cabinShape = new THREE.Shape();
    cabinShape.moveTo(-0.74, 0.74);
    cabinShape.lineTo(-0.24, 1.3);
    cabinShape.lineTo(0.84, 1.3);
    cabinShape.lineTo(1.36, 0.76);
    cabinShape.closePath();

    const cabinWidth = 1.38;
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
      depth: cabinWidth,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.03,
      bevelSegments: 2,
    });
    cabinGeo.translate(0, 0, -cabinWidth / 2);
    cabinGeo.rotateY(-Math.PI / 2);
    geometries.push(cabinGeo);

    const cabinRoofShell = new THREE.Mesh(cabinGeo, escortBaseMat);
    cabinRoofShell.castShadow = true;
    bodyGroup.add(cabinRoofShell);

    // Inset dark glass windshield, side windows, and rear window
    const wsGeo = new THREE.PlaneGeometry(1.22, 0.58);
    geometries.push(wsGeo);
    const windshield = new THREE.Mesh(wsGeo, glassMat);
    windshield.position.set(0, 1.04, -0.52);
    windshield.rotation.x = -0.74;
    bodyGroup.add(windshield);

    const rearWinGeo = new THREE.PlaneGeometry(1.2, 0.56);
    geometries.push(rearWinGeo);
    const rearWin = new THREE.Mesh(rearWinGeo, glassMat);
    rearWin.position.set(0, 1.04, 1.12);
    rearWin.rotation.x = 0.78;
    rearWin.rotation.y = Math.PI;
    bodyGroup.add(rearWin);

    const sideWinShape = new THREE.Shape();
    sideWinShape.moveTo(-0.56, 0.8);
    sideWinShape.lineTo(-0.18, 1.22);
    sideWinShape.lineTo(0.76, 1.22);
    sideWinShape.lineTo(1.16, 0.8);
    sideWinShape.closePath();
    const sideWinGeo = new THREE.ShapeGeometry(sideWinShape);
    sideWinGeo.rotateY(-Math.PI / 2);
    geometries.push(sideWinGeo);

    const leftWin = new THREE.Mesh(sideWinGeo, glassMat);
    leftWin.position.x = -cabinWidth / 2 - 0.035;
    leftWin.rotation.y = Math.PI;
    const rightWin = new THREE.Mesh(sideWinGeo, glassMat);
    rightWin.position.x = cabinWidth / 2 + 0.035;
    bodyGroup.add(leftWin, rightWin);

    // Escort Single Center Stripe (or Twin Stripes) in flush 3D accent bands
    if (config.livery === 'single_stripe' || config.livery === 'stripe') {
      const stripeOffsets = config.livery === 'single_stripe' ? [0] : [-0.14, 0.14];
      const stripeW = config.livery === 'single_stripe' ? 0.32 : 0.16;

      const hoodStripeGeo = new THREE.BoxGeometry(stripeW, 0.02, 1.32);
      const roofStripeGeo = new THREE.BoxGeometry(stripeW, 0.02, 1.08);
      const bootStripeGeo = new THREE.BoxGeometry(stripeW, 0.02, 0.64);
      const frontNoseStripeGeo = new THREE.BoxGeometry(stripeW, 0.28, 0.03);
      const rearTailStripeGeo = new THREE.BoxGeometry(stripeW, 0.42, 0.03);
      geometries.push(
        hoodStripeGeo,
        roofStripeGeo,
        bootStripeGeo,
        frontNoseStripeGeo,
        rearTailStripeGeo
      );

      for (const sx of stripeOffsets) {
        const hoodStripe = new THREE.Mesh(hoodStripeGeo, accentMat);
        hoodStripe.position.set(sx, 0.77, -1.4);
        hoodStripe.rotation.x = 0.042;

        const roofStripe = new THREE.Mesh(roofStripeGeo, accentMat);
        roofStripe.position.set(sx, 1.345, 0.3);

        const bootStripe = new THREE.Mesh(bootStripeGeo, accentMat);
        bootStripe.position.set(sx, 0.79, 1.69);
        bootStripe.rotation.x = -0.04;

        const noseStripe = new THREE.Mesh(frontNoseStripeGeo, accentMat);
        noseStripe.position.set(sx, 0.56, -2.09);

        const tailStripe = new THREE.Mesh(rearTailStripeGeo, accentMat);
        tailStripe.position.set(sx, 0.56, 2.065);

        bodyGroup.add(hoodStripe, roofStripe, bootStripe, noseStripe, tailStripe);
      }
    }
  } else {
    const cabinShape = new THREE.Shape();
    if (isVortex) {
      // Roll hoop + driver helmet fairing
      cabinShape.moveTo(-0.3, 0.54);
      cabinShape.quadraticCurveTo(0.15, 0.92, 0.72, 0.62);
      cabinShape.closePath();
    } else if (isStratos) {
      cabinShape.moveTo(-0.78, 0.68);
      cabinShape.quadraticCurveTo(-0.18, 1.06, 0.55, 0.98);
      cabinShape.lineTo(1.28, 0.7);
      cabinShape.closePath();
    } else {
      cabinShape.moveTo(-0.85, 0.72);
      cabinShape.quadraticCurveTo(-0.35, 1.18, 0.42, 1.15);
      cabinShape.lineTo(1.38, 0.76);
      cabinShape.closePath();
    }

    const cabinWidth = isVortex ? 0.44 : isStratos ? 1.18 : 1.38;
    const cabinGeo = new THREE.ExtrudeGeometry(cabinShape, {
      depth: cabinWidth,
      bevelEnabled: true,
      bevelThickness: 0.07,
      bevelSize: 0.05,
      bevelSegments: 2,
    });
    cabinGeo.translate(0, 0, -cabinWidth / 2);
    cabinGeo.rotateY(-Math.PI / 2);
    geometries.push(cabinGeo);

    const cabin = new THREE.Mesh(cabinGeo, glassMat);
    cabin.castShadow = true;
    bodyGroup.add(cabin);
  }

  // Roof intake / dorsal fin on Stratos & Vortex
  if (isStratos || isVortex) {
    const finGeo = new THREE.BoxGeometry(0.08, 0.28, 1.05);
    geometries.push(finGeo);
    const fin = new THREE.Mesh(finGeo, paintMat);
    fin.position.set(0, 0.94, 1.18);
    bodyGroup.add(fin);
  }

  // 4. Spoiler / Rear Wing
  const wingZ = isVortex ? 2.02 : isEscort ? 1.96 : 2.04;
  if (config.spoiler === 'lip') {
    const lipGeo = new THREE.BoxGeometry(bodyWidth * 0.92, 0.14, 0.24);
    geometries.push(lipGeo);
    const lip = new THREE.Mesh(lipGeo, carbonMat);
    lip.position.set(0, isEscort ? 0.82 : 0.82, wingZ);
    lip.rotation.x = 0.28;
    bodyGroup.add(lip);
  } else {
    const wingSpan = isVortex ? 1.88 : isEscort ? 1.78 : 1.98;
    const wingY = config.spoiler === 'twin' ? 1.24 : 1.12;
    const pylonGeo = new THREE.BoxGeometry(0.06, wingY - 0.68, 0.26);
    geometries.push(pylonGeo);
    const leftPylon = new THREE.Mesh(pylonGeo, carbonMat);
    leftPylon.position.set(-0.48, 0.68 + (wingY - 0.68) / 2, wingZ);
    const rightPylon = new THREE.Mesh(pylonGeo, carbonMat);
    rightPylon.position.set(0.48, 0.68 + (wingY - 0.68) / 2, wingZ);

    const bladeGeo = new THREE.BoxGeometry(wingSpan, 0.06, 0.34);
    geometries.push(bladeGeo);
    const blade = new THREE.Mesh(bladeGeo, isEscort ? escortBaseMat : paintMat);
    blade.position.set(0, wingY, wingZ + 0.04);
    blade.rotation.x = 0.12;
    blade.castShadow = true;

    const plateGeo = new THREE.BoxGeometry(0.05, 0.28, 0.42);
    geometries.push(plateGeo);
    const endL = new THREE.Mesh(plateGeo, accentMat);
    endL.position.set(-wingSpan / 2, wingY - 0.02, wingZ + 0.04);
    const endR = new THREE.Mesh(plateGeo, accentMat);
    endR.position.set(wingSpan / 2, wingY - 0.02, wingZ + 0.04);

    bodyGroup.add(leftPylon, rightPylon, blade, endL, endR);

    if (config.spoiler === 'twin') {
      const upperBladeGeo = new THREE.BoxGeometry(wingSpan * 0.96, 0.05, 0.22);
      geometries.push(upperBladeGeo);
      const upperBlade = new THREE.Mesh(upperBladeGeo, carbonMat);
      upperBlade.position.set(0, wingY + 0.16, wingZ + 0.12);
      upperBlade.rotation.x = 0.22;
      bodyGroup.add(upperBlade);
    }
  }

  // 5. Headlights & Taillights
  if (isEscort) {
    // Classic twin round Ford Escort headlights + rally fog lamps + rectangular tail lamps
    const roundHlGeo = new THREE.CylinderGeometry(0.125, 0.125, 0.07, 18);
    roundHlGeo.rotateX(Math.PI / 2);
    const bezelGeo = new THREE.CylinderGeometry(0.148, 0.148, 0.05, 18);
    bezelGeo.rotateX(Math.PI / 2);
    const fogGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.07, 16);
    fogGeo.rotateX(Math.PI / 2);
    geometries.push(roundHlGeo, bezelGeo, fogGeo);

    for (const side of [-1, 1]) {
      const bezel = new THREE.Mesh(bezelGeo, chromeMat);
      bezel.position.set(side * 0.62, 0.56, -2.09);
      const hl = new THREE.Mesh(roundHlGeo, headlightMat);
      hl.position.set(side * 0.62, 0.56, -2.11);
      const fog = new THREE.Mesh(fogGeo, headlightMat);
      fog.position.set(side * 0.3, 0.42, -2.14);
      bodyGroup.add(bezel, hl, fog);
    }

    const escortTlGeo = new THREE.BoxGeometry(0.42, 0.15, 0.06);
    geometries.push(escortTlGeo);
    const tlL = new THREE.Mesh(escortTlGeo, taillightMat);
    tlL.position.set(-0.62, 0.56, 2.06);
    const tlR = new THREE.Mesh(escortTlGeo, taillightMat);
    tlR.position.set(0.62, 0.56, 2.06);
    bodyGroup.add(tlL, tlR);
  } else {
    const hlGeo = new THREE.BoxGeometry(0.32, 0.1, 0.12);
    geometries.push(hlGeo);
    const hlOffset = isVortex ? 0.25 : 0.66;
    const hlL = new THREE.Mesh(hlGeo, headlightMat);
    hlL.position.set(-hlOffset, 0.48, isVortex ? -1.4 : -2.14);
    const hlR = new THREE.Mesh(hlGeo, headlightMat);
    hlR.position.set(hlOffset, 0.48, isVortex ? -1.4 : -2.14);
    bodyGroup.add(hlL, hlR);

    const tlGeo = new THREE.BoxGeometry(isVortex ? 0.45 : 1.55, 0.09, 0.08);
    geometries.push(tlGeo);
    const tlBar = new THREE.Mesh(tlGeo, taillightMat);
    tlBar.position.set(0, 0.62, isVortex ? 2.12 : 2.18);
    bodyGroup.add(tlBar);
  }

  // 6. Twin Exhausts & Nitro Flames
  const exGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.26, 12);
  exGeo.rotateX(Math.PI / 2);
  geometries.push(exGeo);
  const exL = new THREE.Mesh(exGeo, chromeMat);
  exL.position.set(-0.34, 0.3, 2.22);
  const exR = new THREE.Mesh(exGeo, chromeMat);
  exR.position.set(0.34, 0.3, 2.22);
  bodyGroup.add(exL, exR);

  const nitroFlames = new THREE.Group();
  const flameGeo = new THREE.ConeGeometry(0.11, 0.85, 10);
  flameGeo.rotateX(Math.PI / 2);
  geometries.push(flameGeo);
  const flameMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.88,
  });
  materials.push(flameMat);
  const flL = new THREE.Mesh(flameGeo, flameMat);
  flL.position.set(-0.34, 0.3, 2.7);
  const flR = new THREE.Mesh(flameGeo, flameMat);
  flR.position.set(0.34, 0.3, 2.7);
  nitroFlames.add(flL, flR);
  nitroFlames.visible = false;
  bodyGroup.add(nitroFlames);

  // 6b. Spice Harvest Protective Shield Shell (visible during 2-second powerup)
  const shieldShell = new THREE.Group();
  const innerShieldGeo = new THREE.SphereGeometry(2.55, 22, 14);
  innerShieldGeo.scale(0.68, 0.44, 1.12);
  const outerShieldGeo = new THREE.SphereGeometry(2.6, 12, 8);
  outerShieldGeo.scale(0.69, 0.45, 1.13);
  geometries.push(innerShieldGeo, outerShieldGeo);

  const innerShieldMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const outerShieldMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    wireframe: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
  });
  materials.push(innerShieldMat, outerShieldMat);

  const innerShieldMesh = new THREE.Mesh(innerShieldGeo, innerShieldMat);
  const outerShieldMesh = new THREE.Mesh(outerShieldGeo, outerShieldMat);
  shieldShell.add(innerShieldMesh, outerShieldMesh);
  shieldShell.position.set(0, 0.72, 0);
  shieldShell.visible = false;
  bodyGroup.add(shieldShell);

  // 6c. Twin Mounted Blaster Cannons & Muzzle Flashes
  const gunOffsetX = isVortex ? 0.34 : isEscort ? 0.52 : 0.62;
  const gunY = isVortex ? 0.48 : isEscort ? 0.31 : 0.68;
  const gunZ = isVortex ? -1.15 : isEscort ? -1.85 : -1.52;

  const gunHousingGeo = new THREE.BoxGeometry(0.14, 0.12, 0.42);
  const gunBarrelGeo = new THREE.CylinderGeometry(0.036, 0.044, 0.56, 8);
  gunBarrelGeo.rotateX(Math.PI / 2);
  const muzzleGeo = new THREE.ConeGeometry(0.11, 0.38, 8);
  muzzleGeo.rotateX(-Math.PI / 2);
  geometries.push(gunHousingGeo, gunBarrelGeo, muzzleGeo);

  const muzzleMat = new THREE.MeshBasicMaterial({
    color: 0xfbbf24,
    transparent: true,
    opacity: 0.92,
  });
  materials.push(muzzleMat);

  const muzzleFlashes = new THREE.Group();
  for (const side of [-1, 1]) {
    const housing = new THREE.Mesh(gunHousingGeo, carbonMat);
    housing.position.set(side * gunOffsetX, gunY, gunZ);
    const barrel = new THREE.Mesh(gunBarrelGeo, chromeMat);
    barrel.position.set(side * gunOffsetX, gunY + 0.01, gunZ - 0.36);
    bodyGroup.add(housing, barrel);

    const flash = new THREE.Mesh(muzzleGeo, muzzleMat);
    flash.position.set(side * gunOffsetX, gunY + 0.01, gunZ - 0.78);
    muzzleFlashes.add(flash);
  }
  muzzleFlashes.visible = false;
  bodyGroup.add(muzzleFlashes);

  // 7. Four Wheels (front steer + all spin)
  const wheelRadius = 0.36;
  const frontWidth = isVortex ? 0.32 : 0.28;
  const rearWidth = isVortex ? 0.4 : isEscort ? 0.31 : 0.34;
  const trackHalf = isVortex ? 0.96 : isEscort ? 0.88 : isKurogane ? 0.98 : 0.92;

  const frontWheels: THREE.Group[] = [];
  const allSpinWheels: THREE.Group[] = [];

  const positions: { x: number; z: number; front: boolean; w: number }[] = [
    { x: -trackHalf, z: -1.42, front: true, w: frontWidth },
    { x: trackHalf, z: -1.42, front: true, w: frontWidth },
    { x: -trackHalf, z: 1.38, front: false, w: rearWidth },
    { x: trackHalf, z: 1.38, front: false, w: rearWidth },
  ];

  for (const wp of positions) {
    const { steerPivot, spinGroup } = buildWheelAssembly(
      wheelRadius,
      wp.w,
      config.rimStyle,
      rimMat,
      tireMat,
      caliperMat,
      { geometries }
    );
    steerPivot.position.set(wp.x, wheelRadius, wp.z);
    if (wp.x > 0) {
      spinGroup.scale.x = -1;
    }
    root.add(steerPivot);
    allSpinWheels.push(spinGroup);
    if (wp.front) frontWheels.push(steerPivot);
  }

  return {
    root,
    bodyGroup,
    frontWheels,
    allSpinWheels,
    taillightMat,
    nitroFlames,
    shieldShell,
    muzzleFlashes,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
