import * as THREE from 'three';
import type { CustomSignSlots, TrackMeta } from '../shared/types.ts';
import { DEFAULT_SIGN_LOCATIONS, resolveSignSlots } from '../utils/defaultSignJpgs.ts';

export interface TrackSample {
  index: number;
  pos: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  progress: number;
  heading: number;
  curvature: number;
}

export interface BoostPadZone {
  progress: number;
  pos: THREE.Vector3;
  radius: number;
}

export interface SpiceCanisterNode {
  id: number;
  pos: THREE.Vector3;
  baseY: number;
  radius: number;
  mesh: THREE.Group;
  respawnTimer: number;
}

export interface BuiltTrack {
  meta: TrackMeta;
  group: THREE.Group;
  samples: TrackSample[];
  boostPads: BoostPadZone[];
  spiceCanisters: SpiceCanisterNode[];
  racingLineMesh: THREE.Mesh;
  findNearestSample: (x: number, z: number, hintIndex?: number) => {
    sample: TrackSample;
    lateralOffset: number;
    distSq: number;
  };
  dispose: () => void;
}

const SAMPLE_COUNT = 480;

function createAsphaltTexture(isNight: boolean, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = isNight ? '#1b1f29' : '#2b2e36';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt grain
  for (let i = 0; i < 4500; i++) {
    const x = Math.random() * 512;
    const y = Math.random() * 512;
    const v = isNight ? 28 + Math.random() * 28 : 38 + Math.random() * 36;
    ctx.fillStyle = `rgb(${v},${v + 2},${v + 5})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Outer white boundary lines
  ctx.fillStyle = isNight ? 'rgba(226, 232, 240, 0.82)' : 'rgba(244, 244, 245, 0.85)';
  ctx.fillRect(18, 0, 12, 512);
  ctx.fillRect(482, 0, 12, 512);

  // Dashed center lane divider
  ctx.fillStyle = isNight ? 'rgba(56, 189, 248, 0.55)' : 'rgba(250, 204, 21, 0.72)';
  ctx.fillRect(251, 32, 10, 190);
  ctx.fillRect(251, 288, 10, 190);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createCheckeredTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const size = 32;
  for (let y = 0; y < 128; y += size) {
    for (let x = 0; x < 256; x += size) {
      const even = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = even ? '#f8fafc' : '#18181b';
      ctx.fillRect(x, y, size, size);
    }
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createBoostTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#082f49';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = '#06b6d4';
  for (let y = 20; y < 240; y += 72) {
    ctx.beginPath();
    ctx.moveTo(28, y + 48);
    ctx.lineTo(128, y);
    ctx.lineTo(228, y + 48);
    ctx.lineTo(228, y + 70);
    ctx.lineTo(128, y + 22);
    ctx.lineTo(28, y + 70);
    ctx.closePath();
    ctx.fill();
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createCurbTexture(colorA: string, colorB: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = colorA;
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = colorB;
  ctx.fillRect(0, 128, 64, 128);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function createRoadSignTexture(quote: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  // Weathered desert bronze/obsidian sign background
  ctx.fillStyle = '#18110b';
  ctx.fillRect(0, 0, 512, 256);

  // Inner metallic border
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 10;
  ctx.strokeRect(14, 14, 484, 228);

  ctx.strokeStyle = 'rgba(251, 191, 36, 0.35)';
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 28, 456, 200);

  // Subtle Arrakis crest tag
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DEEP DESERT · ARRAKIS', 256, 58);

  // Quote text
  ctx.fillStyle = '#fef3c7';
  const fontSize = quote.length > 18 ? 38 : 54;
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillText(quote, 256, 148, 428);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createImageSignTexture(
  dataUrl: string,
  maxAnisotropy: number,
  isDisposed: () => boolean
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  const drawFrame = () => {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 14;
    ctx.strokeRect(10, 10, canvas.width - 20, canvas.height - 20);
    ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 24, canvas.width - 48, canvas.height - 48);
  };

  ctx.fillStyle = '#18110b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawFrame();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;

  const img = new Image();
  img.onload = () => {
    if (isDisposed()) return;
    ctx.fillStyle = '#140e09';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const pad = 28;
    const availW = canvas.width - pad * 2;
    const availH = canvas.height - pad * 2;
    const scale = Math.min(availW / img.width, availH / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = pad + (availW - drawW) * 0.5;
    const dy = pad + (availH - drawH) * 0.5;

    ctx.drawImage(img, dx, dy, drawW, drawH);
    drawFrame();
    tex.needsUpdate = true;
  };
  img.src = dataUrl;

  return tex;
}

function createRoadDecalTexture(text: string, maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Painted tarmac framing bars
  ctx.fillStyle = 'rgba(245, 158, 11, 0.85)';
  ctx.fillRect(64, 24, canvas.width - 128, 14);
  ctx.fillRect(64, canvas.height - 38, canvas.width - 128, 14);

  const words = text.trim().split(/\s+/);
  const lines =
    words.length >= 4
      ? [
          words.slice(0, Math.ceil(words.length / 2)).join(' '),
          words.slice(Math.ceil(words.length / 2)).join(' '),
        ]
      : [text];

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 18;
  ctx.strokeStyle = 'rgba(18, 13, 9, 0.78)';

  if (lines.length === 2) {
    ctx.font = '900 144px sans-serif';
    ctx.strokeText(lines[0], canvas.width / 2, 168, canvas.width - 100);
    ctx.fillStyle = 'rgba(254, 243, 199, 0.95)';
    ctx.fillText(lines[0], canvas.width / 2, 168, canvas.width - 100);

    ctx.strokeText(lines[1], canvas.width / 2, 344, canvas.width - 100);
    ctx.fillStyle = 'rgba(251, 191, 36, 0.97)';
    ctx.fillText(lines[1], canvas.width / 2, 344, canvas.width - 100);
  } else {
    ctx.font = '900 132px sans-serif';
    ctx.strokeText(lines[0], canvas.width / 2, canvas.height / 2, canvas.width - 100);
    ctx.fillStyle = 'rgba(254, 243, 199, 0.95)';
    ctx.fillText(lines[0], canvas.width / 2, canvas.height / 2, canvas.width - 100);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

export function buildTrackSamples(meta: TrackMeta): TrackSample[] {
  const pts = meta.controlPoints.map((p) => new THREE.Vector3(p.x, p.y, p.z));
  const curve = new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
  const spaced = curve.getSpacedPoints(SAMPLE_COUNT);
  const worldUp = new THREE.Vector3(0, 1, 0);

  const rawSamples: TrackSample[] = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const pos = spaced[i];
    const next = spaced[(i + 1) % SAMPLE_COUNT];
    const prev = spaced[(i - 1 + SAMPLE_COUNT) % SAMPLE_COUNT];
    const tangent = new THREE.Vector3().subVectors(next, prev).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, worldUp).normalize();
    const heading = Math.atan2(-tangent.x, -tangent.z);

    rawSamples.push({
      index: i,
      pos,
      tangent,
      right,
      progress: i / SAMPLE_COUNT,
      heading,
      curvature: 0,
    });
  }

  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const prevT = rawSamples[(i - 2 + SAMPLE_COUNT) % SAMPLE_COUNT].tangent;
    const nextT = rawSamples[(i + 2) % SAMPLE_COUNT].tangent;
    rawSamples[i].curvature = prevT.angleTo(nextT);
  }

  return rawSamples;
}

function buildRibbonGeometry(
  samples: TrackSample[],
  offsetLeft: number,
  offsetRight: number,
  yOffset: number,
  uvRepeatLen = 20
): THREE.BufferGeometry {
  const n = samples.length;
  const positions = new Float32Array((n + 1) * 2 * 3);
  const normals = new Float32Array((n + 1) * 2 * 3);
  const uvs = new Float32Array((n + 1) * 2 * 2);
  const indices: number[] = [];

  let accumDist = 0;
  for (let i = 0; i <= n; i++) {
    const s = samples[i % n];
    if (i > 0) {
      const prev = samples[(i - 1) % n];
      accumDist += s.pos.distanceTo(prev.pos);
    }
    const vCoord = accumDist / uvRepeatLen;

    const pL = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offsetLeft);
    const pR = new THREE.Vector3().copy(s.pos).addScaledVector(s.right, offsetRight);
    pL.y += yOffset;
    pR.y += yOffset;

    const idx = i * 2;
    positions[idx * 3] = pL.x;
    positions[idx * 3 + 1] = pL.y;
    positions[idx * 3 + 2] = pL.z;

    positions[(idx + 1) * 3] = pR.x;
    positions[(idx + 1) * 3 + 1] = pR.y;
    positions[(idx + 1) * 3 + 2] = pR.z;

    normals[idx * 3] = 0;
    normals[idx * 3 + 1] = 1;
    normals[idx * 3 + 2] = 0;
    normals[(idx + 1) * 3] = 0;
    normals[(idx + 1) * 3 + 1] = 1;
    normals[(idx + 1) * 3 + 2] = 0;

    uvs[idx * 2] = 0;
    uvs[idx * 2 + 1] = vCoord;
    uvs[(idx + 1) * 2] = 1;
    uvs[(idx + 1) * 2 + 1] = vCoord;

    if (i < n) {
      const a = idx;
      const b = idx + 1;
      const c = idx + 2;
      const d = idx + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

export function buildTrackScene(
  meta: TrackMeta,
  maxAnisotropy = 4,
  customSignSlots?: CustomSignSlots | null
): BuiltTrack {
  const group = new THREE.Group();
  const samples = buildTrackSamples(meta);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  let isDisposed = false;

  const halfW = meta.roadWidth / 2;

  // 1. Road Surface
  const asphaltTex = createAsphaltTexture(meta.isNight, maxAnisotropy);
  textures.push(asphaltTex);
  const roadGeo = buildRibbonGeometry(samples, -halfW, halfW, 0.04, 16);
  geometries.push(roadGeo);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: meta.isNight ? 0.34 : 0.78,
    metalness: meta.isNight ? 0.25 : 0.06,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  materials.push(roadMat);
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 1b. Auto Pilot Racing Line Guide Ribbon (toggled visible when Auto Pilot is active)
  const racingLineGeo = buildRibbonGeometry(samples, -0.32, 0.32, 0.065, 24);
  geometries.push(racingLineGeo);
  const racingLineMat = new THREE.MeshBasicMaterial({
    color: 0x38bdf8,
    transparent: true,
    opacity: 0.65,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  materials.push(racingLineMat);
  const racingLineMesh = new THREE.Mesh(racingLineGeo, racingLineMat);
  racingLineMesh.visible = false;
  group.add(racingLineMesh);

  // 2. Left & Right Rumble Curbs
  const curbTex = createCurbTexture(meta.curbColorA, meta.curbColorB, maxAnisotropy);
  textures.push(curbTex);
  const curbMat = new THREE.MeshStandardMaterial({
    map: curbTex,
    roughness: 0.65,
    metalness: 0.08,
    emissive: meta.isNight ? new THREE.Color(meta.curbColorA) : new THREE.Color(0x000000),
    emissiveIntensity: meta.isNight ? 0.25 : 0,
  });
  materials.push(curbMat);

  const leftCurbGeo = buildRibbonGeometry(samples, -halfW - 1.35, -halfW, 0.055, 6);
  const rightCurbGeo = buildRibbonGeometry(samples, halfW, halfW + 1.35, 0.055, 6);
  geometries.push(leftCurbGeo, rightCurbGeo);
  const leftCurb = new THREE.Mesh(leftCurbGeo, curbMat);
  const rightCurb = new THREE.Mesh(rightCurbGeo, curbMat);
  leftCurb.receiveShadow = true;
  rightCurb.receiveShadow = true;
  group.add(leftCurb, rightCurb);

  // 3. Elevated Road Bed / Skirt so track elevation hills sit on solid embankments
  const skirtMat = new THREE.MeshStandardMaterial({
    color: meta.isNight ? 0x1e293b : 0x3f3f46,
    roughness: 0.9,
    metalness: 0.1,
    side: THREE.DoubleSide,
  });
  materials.push(skirtMat);

  const wallGeoL = buildRibbonGeometry(samples, -halfW - 3.6, -halfW - 1.35, -0.35, 12);
  const wallGeoR = buildRibbonGeometry(samples, halfW + 1.35, halfW + 3.6, -0.35, 12);
  geometries.push(wallGeoL, wallGeoR);
  group.add(new THREE.Mesh(wallGeoL, skirtMat), new THREE.Mesh(wallGeoR, skirtMat));

  // 4. Outer Ground Terrain Mesh (contoured strictly below nearby road elevation)
  const terrainSize = 1100;
  const terrainSegs = 80;
  const terrainGeo = new THREE.PlaneGeometry(terrainSize, terrainSize, terrainSegs, terrainSegs);
  terrainGeo.rotateX(-Math.PI / 2);
  const posAttr = terrainGeo.attributes.position;
  for (let i = 0; i < posAttr.count; i++) {
    const vx = posAttr.getX(i);
    const vz = posAttr.getZ(i);
    let minD2 = Infinity;
    let nearestY = 0;
    for (let s = 0; s < samples.length; s += 4) {
      const sp = samples[s].pos;
      const dx = vx - sp.x;
      const dz = vz - sp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minD2) {
        minD2 = d2;
        nearestY = sp.y;
      }
    }
    const dist = Math.sqrt(minD2);
    const roadClearance = meta.hasDunes ? halfW + 5.5 : halfW + 8;
    let h = nearestY - 0.65;
    if (dist > roadClearance) {
      const t = Math.min(1, (dist - roadClearance) / (meta.hasDunes ? 75 : 140));
      if (meta.hasDunes) {
        const duneWaveA = Math.abs(Math.sin(vx * 0.022 + vz * 0.014)) * 22;
        const duneWaveB = Math.cos(vx * 0.013 - vz * 0.021) * 9;
        const ripple = Math.sin(vx * 0.075 + vz * 0.06) * 1.6;
        h = nearestY - 0.55 + t * (duneWaveA + duneWaveB + ripple);
      } else {
        const ridge =
          Math.sin(vx * 0.015) * Math.cos(vz * 0.015) * (meta.id === 'desert' ? 18 : 12) +
          Math.sin(vx * 0.04 + vz * 0.03) * 4;
        h = nearestY - 0.65 + t * (meta.hasWater ? -3.5 + Math.max(0, ridge) * 0.5 : Math.abs(ridge));
      }
    }
    posAttr.setY(i, h);
  }
  terrainGeo.computeVertexNormals();
  geometries.push(terrainGeo);

  const terrainMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(meta.groundColor),
    roughness: 0.92,
    metalness: 0.02,
  });
  materials.push(terrainMat);
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  // Optional Coastal Ocean Plane
  if (meta.hasWater) {
    const waterGeo = new THREE.PlaneGeometry(1800, 1800);
    waterGeo.rotateX(-Math.PI / 2);
    geometries.push(waterGeo);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.16,
      metalness: 0.45,
    });
    materials.push(waterMat);
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.8;
    group.add(waterMesh);
  }

  // 5. Start/Finish Checkered Line & Overhead Gantry
  const startSample = samples[0];
  const checkTex = createCheckeredTexture(maxAnisotropy);
  textures.push(checkTex);
  const checkGeo = new THREE.PlaneGeometry(meta.roadWidth, 4.2);
  checkGeo.rotateX(-Math.PI / 2);
  geometries.push(checkGeo);
  const checkMat = new THREE.MeshStandardMaterial({
    map: checkTex,
    roughness: 0.65,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  materials.push(checkMat);
  const checkMesh = new THREE.Mesh(checkGeo, checkMat);
  checkMesh.position.copy(startSample.pos);
  checkMesh.position.y += 0.07;
  checkMesh.rotation.y = startSample.heading;
  group.add(checkMesh);

  // Gantry arch
  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(startSample.pos);
  gantryGroup.rotation.y = startSample.heading;

  const pillarGeo = new THREE.BoxGeometry(1.1, 8.5, 1.1);
  geometries.push(pillarGeo);
  const gantryMat = new THREE.MeshStandardMaterial({
    color: 0x18181b,
    metalness: 0.75,
    roughness: 0.3,
  });
  materials.push(gantryMat);

  const leftPillar = new THREE.Mesh(pillarGeo, gantryMat);
  leftPillar.position.set(-halfW - 1.5, 4.25, 0);
  const rightPillar = new THREE.Mesh(pillarGeo, gantryMat);
  rightPillar.position.set(halfW + 1.5, 4.25, 0);
  const beamGeo = new THREE.BoxGeometry(meta.roadWidth + 4.4, 1.8, 1.4);
  geometries.push(beamGeo);
  const topBeam = new THREE.Mesh(beamGeo, gantryMat);
  topBeam.position.set(0, 8.2, 0);

  const bannerStripGeo = new THREE.BoxGeometry(meta.roadWidth + 2, 0.35, 1.48);
  geometries.push(bannerStripGeo);
  const bannerMat = new THREE.MeshStandardMaterial({
    color: meta.isNight ? 0x06b6d4 : 0xf59e0b,
    emissive: meta.isNight ? 0x06b6d4 : 0xf59e0b,
    emissiveIntensity: meta.isNight ? 1.5 : 0.45,
    roughness: 0.3,
  });
  materials.push(bannerMat);
  const bannerStrip = new THREE.Mesh(bannerStripGeo, bannerMat);
  bannerStrip.position.set(0, 8.2, 0);

  gantryGroup.add(leftPillar, rightPillar, topBeam, bannerStrip);
  group.add(gantryGroup);

  // 6. Glowing Speed Boost Pads
  const boostPads: BoostPadZone[] = [];
  const boostTex = createBoostTexture(maxAnisotropy);
  textures.push(boostTex);
  const boostGeo = new THREE.PlaneGeometry(5.2, 8.5);
  boostGeo.rotateX(-Math.PI / 2);
  geometries.push(boostGeo);
  const boostMat = new THREE.MeshStandardMaterial({
    map: boostTex,
    emissive: 0x06b6d4,
    emissiveMap: boostTex,
    emissiveIntensity: 1.4,
    roughness: 0.25,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  materials.push(boostMat);

  for (const prog of meta.boostProgressPoints) {
    const idx = Math.floor(prog * SAMPLE_COUNT) % SAMPLE_COUNT;
    const s = samples[idx];
    const pad = new THREE.Mesh(boostGeo, boostMat);
    pad.position.copy(s.pos);
    pad.position.y += 0.08;
    pad.rotation.y = s.heading;
    group.add(pad);
    boostPads.push({ progress: prog, pos: s.pos.clone(), radius: 4.5 });
  }

  // 6a. Painted Road Deck Text Decals (e.g. "the spice must flow" across the tarmac)
  if (meta.roadDecals && meta.roadDecals.length > 0) {
    const decalWidth = Math.max(8, meta.roadWidth - 3.0);
    const decalLength = 8.4;
    const decalGeo = new THREE.PlaneGeometry(decalWidth, decalLength);
    decalGeo.rotateX(-Math.PI / 2);
    geometries.push(decalGeo);

    const matCache = new Map<string, THREE.MeshBasicMaterial>();
    const normalVec = new THREE.Vector3();
    const negTangent = new THREE.Vector3();
    const basisMat = new THREE.Matrix4();

    for (const decal of meta.roadDecals) {
      let decalMat = matCache.get(decal.text);
      if (!decalMat) {
        const decalTex = createRoadDecalTexture(decal.text, maxAnisotropy);
        textures.push(decalTex);
        decalMat = new THREE.MeshBasicMaterial({
          map: decalTex,
          transparent: true,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -3,
          polygonOffsetUnits: -3,
        });
        materials.push(decalMat);
        matCache.set(decal.text, decalMat);
      }

      const idx = Math.floor(decal.progress * SAMPLE_COUNT) % SAMPLE_COUNT;
      const s = samples[idx];
      normalVec.crossVectors(s.right, s.tangent).normalize();
      negTangent.copy(s.tangent).negate();
      basisMat.makeBasis(s.right, normalVec, negTangent);

      const decalMesh = new THREE.Mesh(decalGeo, decalMat);
      decalMesh.position.copy(s.pos).addScaledVector(normalVec, 0.085);
      decalMesh.quaternion.setFromRotationMatrix(basisMat);
      group.add(decalMesh);
    }
  }

  // 6b. Spice Harvest Canisters (Composite 3D powerup nodes placed around the circuit)
  const spiceCanisters: SpiceCanisterNode[] = [];
  const spiceSpots: { prog: number; lat: number }[] = [
    { prog: 0.09, lat: -3.2 },
    { prog: 0.27, lat: 3.6 },
    { prog: 0.39, lat: -2.4 },
    { prog: 0.59, lat: 3.5 },
    { prog: 0.69, lat: -3.8 },
    { prog: 0.89, lat: 2.6 },
  ];

  const coreGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 14);
  const capGeo = new THREE.CylinderGeometry(0.52, 0.52, 0.16, 14);
  const ringGeo = new THREE.TorusGeometry(0.74, 0.055, 8, 24);
  const markerGeo = new THREE.RingGeometry(0.72, 0.96, 24);
  markerGeo.rotateX(-Math.PI / 2);
  geometries.push(coreGeo, capGeo, ringGeo, markerGeo);

  const spiceCoreMat = new THREE.MeshStandardMaterial({
    color: 0xffb347,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.5,
    roughness: 0.2,
    metalness: 0.15,
  });
  const spiceCapMat = new THREE.MeshStandardMaterial({
    color: 0x27272a,
    metalness: 0.85,
    roughness: 0.28,
  });
  const spiceRingMat = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x0ea5e9,
    emissiveIntensity: 1.25,
    metalness: 0.7,
    roughness: 0.2,
  });
  const markerMat = new THREE.MeshBasicMaterial({
    color: 0xf59e0b,
    transparent: true,
    opacity: 0.42,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  materials.push(spiceCoreMat, spiceCapMat, spiceRingMat, markerMat);

  spiceSpots.forEach((spot, idx) => {
    const sampleIdx = Math.floor(spot.prog * SAMPLE_COUNT) % SAMPLE_COUNT;
    const s = samples[sampleIdx];
    const worldPos = new THREE.Vector3()
      .copy(s.pos)
      .addScaledVector(s.right, spot.lat);

    const marker = new THREE.Mesh(markerGeo, markerMat);
    marker.position.set(worldPos.x, worldPos.y + 0.08, worldPos.z);
    group.add(marker);

    const canisterGroup = new THREE.Group();
    const baseY = worldPos.y + 1.15;
    canisterGroup.position.set(worldPos.x, baseY, worldPos.z);

    const core = new THREE.Mesh(coreGeo, spiceCoreMat);
    const topCap = new THREE.Mesh(capGeo, spiceCapMat);
    topCap.position.y = 0.56;
    const bottomCap = new THREE.Mesh(capGeo, spiceCapMat);
    bottomCap.position.y = -0.56;
    const ring = new THREE.Mesh(ringGeo, spiceRingMat);
    ring.rotation.x = Math.PI * 0.35;
    ring.rotation.z = Math.PI * 0.15;

    canisterGroup.add(core, topCap, bottomCap, ring);
    group.add(canisterGroup);

    spiceCanisters.push({
      id: idx,
      pos: worldPos,
      baseY,
      radius: 1.85,
      mesh: canisterGroup,
      respawnTimer: 0,
    });
  });

  // 6c. Roadside Dune Quote & 3 JPG Picture Billboards
  const baseSigns = meta.roadSigns ?? [];
  const resolvedJpgSlots = resolveSignSlots(customSignSlots);
  interface ResolvedBillboard {
    progress: number;
    side: -1 | 1;
    quote?: string;
    imageDataUrl?: string;
    featuredScale?: number;
  }
  const billboards: ResolvedBillboard[] = [];

  for (const s of baseSigns) {
    billboards.push({
      progress: s.progress,
      side: s.side,
      quote: s.quote,
    });
  }

  for (const slot of resolvedJpgSlots) {
    if (!slot.dataUrl) continue;
    const loc = DEFAULT_SIGN_LOCATIONS[slot.slotIndex];
    billboards.push({
      progress: loc.progress,
      side: loc.side,
      imageDataUrl: slot.dataUrl,
      featuredScale: 1.15,
    });
  }

  if (billboards.length > 0) {
    const signPostGeo = new THREE.BoxGeometry(0.22, 4.6, 0.22);
    const signFrameGeo = new THREE.BoxGeometry(6.8, 3.2, 0.24);
    const signFaceGeo = new THREE.PlaneGeometry(6.5, 2.95);
    geometries.push(signPostGeo, signFrameGeo, signFaceGeo);

    const signPostMat = new THREE.MeshStandardMaterial({
      color: 0x3b2a1c,
      roughness: 0.72,
      metalness: 0.45,
    });
    const signFrameMat = new THREE.MeshStandardMaterial({
      color: 0x241910,
      roughness: 0.55,
      metalness: 0.5,
    });
    materials.push(signPostMat, signFrameMat);

    for (const sign of billboards) {
      const sampleIdx = Math.floor(sign.progress * SAMPLE_COUNT) % SAMPLE_COUNT;
      const s = samples[sampleIdx];
      const signGroup = new THREE.Group();
      signGroup.position
        .copy(s.pos)
        .addScaledVector(s.right, sign.side * (halfW + 3.4));
      signGroup.rotation.y = s.heading - sign.side * 0.2;
      if (sign.featuredScale) {
        signGroup.scale.setScalar(sign.featuredScale);
      }

      const leftPost = new THREE.Mesh(signPostGeo, signPostMat);
      leftPost.position.set(-2.2, 2.3, 0);
      leftPost.castShadow = true;
      const rightPost = new THREE.Mesh(signPostGeo, signPostMat);
      rightPost.position.set(2.2, 2.3, 0);
      rightPost.castShadow = true;

      const frame = new THREE.Mesh(signFrameGeo, signFrameMat);
      frame.position.set(0, 4.2, 0);
      frame.castShadow = true;

      let faceMat: THREE.MeshBasicMaterial;
      if (sign.imageDataUrl) {
        const imageTex = createImageSignTexture(
          sign.imageDataUrl,
          maxAnisotropy,
          () => isDisposed
        );
        textures.push(imageTex);
        faceMat = new THREE.MeshBasicMaterial({ map: imageTex });
        materials.push(faceMat);
      } else {
        const faceTex = createRoadSignTexture(sign.quote ?? '', maxAnisotropy);
        textures.push(faceTex);
        faceMat = new THREE.MeshBasicMaterial({ map: faceTex });
        materials.push(faceMat);
      }

      const frontFace = new THREE.Mesh(signFaceGeo, faceMat);
      frontFace.position.set(0, 4.2, 0.13);
      const backFace = new THREE.Mesh(signFaceGeo, faceMat);
      backFace.position.set(0, 4.2, -0.13);
      backFace.rotation.y = Math.PI;

      signGroup.add(leftPost, rightPost, frame, frontFace, backFace);
      group.add(signGroup);
    }
  }

  // 7. InstancedMesh Scenery Props placed safely outside track corridors
  const propLocations: { x: number; y: number; z: number; scale: number; rot: number }[] = [];
  const clearanceSq = Math.pow(halfW + 9, 2);

  for (let i = 0; i < SAMPLE_COUNT; i += 5) {
    const s = samples[i];
    for (const side of [-1, 1]) {
      const dist = halfW + 10 + ((i * 17 + (side > 0 ? 7 : 3)) % 28);
      const px = s.pos.x + s.right.x * side * dist;
      const pz = s.pos.z + s.right.z * side * dist;

      // Ensure prop doesn't overlap ANY track segment
      let safe = true;
      for (let k = 0; k < SAMPLE_COUNT; k += 4) {
        const sp = samples[k].pos;
        const dx = px - sp.x;
        const dz = pz - sp.z;
        if (dx * dx + dz * dz < clearanceSq) {
          safe = false;
          break;
        }
      }
      if (safe) {
        const hash = Math.abs(Math.sin(i * 12.9898 + side * 78.233));
        propLocations.push({
          x: px,
          y: s.pos.y - 0.5,
          z: pz,
          scale: 0.85 + (hash % 0.3),
          rot: (hash * 100) % (Math.PI * 2),
        });
      }
    }
  }

  const dummy = new THREE.Object3D();
  if (propLocations.length > 0) {
    if (meta.id === 'alpine') {
      // Pine trunks + layered conifer crowns
      const trunkGeo = new THREE.CylinderGeometry(0.45, 0.7, 4.5, 7);
      trunkGeo.translate(0, 2.25, 0);
      const crownGeo = new THREE.ConeGeometry(3.2, 9.5, 8);
      crownGeo.translate(0, 7.2, 0);
      geometries.push(trunkGeo, crownGeo);

      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3222, roughness: 0.9 });
      const crownMat = new THREE.MeshStandardMaterial({ color: 0x1e4d2b, roughness: 0.85 });
      materials.push(trunkMat, crownMat);

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, propLocations.length);
      const crowns = new THREE.InstancedMesh(crownGeo, crownMat, propLocations.length);
      trunks.castShadow = true;
      crowns.castShadow = true;

      propLocations.forEach((p, idx) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);
        crowns.setMatrixAt(idx, dummy.matrix);
        crowns.setColorAt(idx, new THREE.Color().setHSL(0.35, 0.45, 0.18 + (idx % 5) * 0.025));
      });
      trunks.computeBoundingSphere();
      crowns.computeBoundingSphere();
      group.add(trunks, crowns);
    } else if (meta.id === 'desert' || meta.id === 'play_is_vital') {
      // Arrakeen Spice Run / Play is Vital: Craggy sandstone mesas & sculpted dunes + amber thumper pylons
      const rockGeo =
        meta.id === 'play_is_vital'
          ? new THREE.ConeGeometry(7.2, 9.5, 5)
          : new THREE.DodecahedronGeometry(4.4, 0);
      if (meta.id === 'play_is_vital') {
        rockGeo.scale(1.85, 0.95, 1.35);
        rockGeo.translate(0, 4.1, 0);
      } else {
        rockGeo.scale(1.25, 1.85, 1.0);
        rockGeo.translate(0, 3.2, 0);
      }
      const beaconGeo = new THREE.CylinderGeometry(0.35, 0.55, 8.5, 6);
      beaconGeo.translate(0, 4.25, 0);
      geometries.push(rockGeo, beaconGeo);

      const rockMat = new THREE.MeshStandardMaterial({
        color: meta.id === 'play_is_vital' ? 0xc98242 : 0xa45430,
        roughness: 0.92,
      });
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xd97706,
        emissive: 0xf59e0b,
        emissiveIntensity: 0.9,
        roughness: 0.4,
      });
      materials.push(rockMat, beaconMat);

      const rocks = new THREE.InstancedMesh(rockGeo, rockMat, propLocations.length);
      rocks.castShadow = true;
      const beaconIndices = propLocations.filter((_, idx) => idx % 4 === 0);
      const beacons = new THREE.InstancedMesh(beaconGeo, beaconMat, Math.max(1, beaconIndices.length));

      let bIdx = 0;
      propLocations.forEach((p, idx) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.set(p.scale * 1.15, p.scale * (0.75 + (idx % 4) * 0.4), p.scale);
        dummy.updateMatrix();
        rocks.setMatrixAt(idx, dummy.matrix);
        rocks.setColorAt(
          idx,
          meta.id === 'play_is_vital'
            ? new THREE.Color().setHSL(0.08, 0.58, 0.44 + (idx % 4) * 0.035)
            : new THREE.Color().setHSL(0.06, 0.56, 0.34 + (idx % 4) * 0.04)
        );

        if (idx % 4 === 0 && bIdx < beaconIndices.length) {
          dummy.position.set(p.x, p.y, p.z);
          dummy.rotation.set(0, 0, 0);
          dummy.scale.setScalar(1);
          dummy.updateMatrix();
          beacons.setMatrixAt(bIdx++, dummy.matrix);
        }
      });
      rocks.computeBoundingSphere();
      beacons.computeBoundingSphere();
      group.add(rocks, beacons);
    } else if (meta.id === 'coastal') {
      // Sietch Tabr Qanat: Desert palms + oasis sandstone spires
      const trunkGeo = new THREE.CylinderGeometry(0.3, 0.5, 8.5, 7);
      trunkGeo.translate(0, 4.25, 0);
      const frondGeo = new THREE.ConeGeometry(3.4, 2.2, 6);
      frondGeo.translate(0, 8.8, 0);
      geometries.push(trunkGeo, frondGeo);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7c5838, roughness: 0.88 });
      const frondMat = new THREE.MeshStandardMaterial({ color: 0x3b7a57, roughness: 0.72 });
      materials.push(trunkMat, frondMat);

      const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, propLocations.length);
      const fronds = new THREE.InstancedMesh(frondGeo, frondMat, propLocations.length);
      propLocations.forEach((p, idx) => {
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rot, 0.08);
        dummy.scale.setScalar(p.scale);
        dummy.updateMatrix();
        trunks.setMatrixAt(idx, dummy.matrix);
        fronds.setMatrixAt(idx, dummy.matrix);
      });
      trunks.computeBoundingSphere();
      fronds.computeBoundingSphere();
      group.add(trunks, fronds);
    } else {
      // Giedi Prime Arena: Stark Harkonnen obsidian monoliths + crimson/white arena floodlights
      const towerGeo = new THREE.BoxGeometry(11, 36, 11);
      towerGeo.translate(0, 18, 0);
      const stripGeo = new THREE.BoxGeometry(11.3, 1.4, 11.3);
      stripGeo.translate(0, 33, 0);
      geometries.push(towerGeo, stripGeo);

      const towerMat = new THREE.MeshStandardMaterial({
        color: 0x0f1116,
        roughness: 0.42,
        metalness: 0.7,
      });
      const stripMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        emissive: 0xef4444,
        emissiveIntensity: 1.5,
        roughness: 0.2,
      });
      materials.push(towerMat, stripMat);

      const towers = new THREE.InstancedMesh(towerGeo, towerMat, propLocations.length);
      const strips = new THREE.InstancedMesh(stripGeo, stripMat, propLocations.length);

      propLocations.forEach((p, idx) => {
        const hScale = 0.7 + (idx % 5) * 0.34;
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(0, p.rot, 0);
        dummy.scale.set(p.scale, hScale, p.scale);
        dummy.updateMatrix();
        towers.setMatrixAt(idx, dummy.matrix);
        strips.setMatrixAt(idx, dummy.matrix);
        strips.setColorAt(
          idx,
          new THREE.Color(idx % 3 === 0 ? 0xef4444 : idx % 3 === 1 ? 0xe4e4e7 : 0xf59e0b)
        );
      });
      towers.computeBoundingSphere();
      strips.computeBoundingSphere();
      group.add(towers, strips);
    }
  }

  function findNearestSample(x: number, z: number, hintIndex?: number) {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < SAMPLE_COUNT) {
      const windowRadius = 32;
      for (let offset = -windowRadius; offset <= windowRadius; offset++) {
        const idx = (hintIndex + offset + SAMPLE_COUNT) % SAMPLE_COUNT;
        const p = samples[idx].pos;
        const dx = x - p.x;
        const dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }
      // If car teleported or jumped far away, fallback to full scan
      if (bestDistSq > 1600) {
        for (let i = 0; i < SAMPLE_COUNT; i++) {
          const p = samples[i].pos;
          const dx = x - p.x;
          const dz = z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestIdx = i;
          }
        }
      }
    } else {
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const p = samples[i].pos;
        const dx = x - p.x;
        const dz = z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    const sample = samples[bestIdx];
    const dx = x - sample.pos.x;
    const dz = z - sample.pos.z;
    const lateralOffset = dx * sample.right.x + dz * sample.right.z;

    return { sample, lateralOffset, distSq: bestDistSq };
  }

  return {
    meta,
    group,
    samples,
    boostPads,
    spiceCanisters,
    racingLineMesh,
    findNearestSample,
    dispose: () => {
      isDisposed = true;
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
