import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Wind } from 'lucide-react';
import type {
  ClientWsMessage,
  CustomSignImagesMap,
  MultiplayerRoomState,
  RaceMode,
  RoomTelemetryPacket,
  TrackId,
  VehicleConfig,
} from '../shared/types.ts';
import { TRACK_MAP } from '../shared/tracks.ts';
import { createAiVehicleConfig } from '../shared/vehicles.ts';
import { buildVehicleModel, type CarModelRig } from './carBuilder.ts';
import { buildTrackScene, type BuiltTrack } from './trackBuilder.ts';
import {
  applyAutoPilotAssist,
  computeAiControl,
  createRacerAtGrid,
  resetRacerToTrack,
  resolveCarCollisions,
  stepRacerPhysics,
  type PlayerControlInput,
  type RacerState,
} from './physics.ts';
import type { RacingAudioEngine } from './audioEngine.ts';
import type { CombatNetworkEvent } from '../hooks/useRacingNetwork.ts';

export type ViewportSceneMode = 'showroom' | 'track_preview' | 'race';
export type CameraViewMode = 'chase' | 'far' | 'hood';

export interface HudSnapshot {
  speedKmh: number;
  gear: number;
  rpmRatio: number;
  nitroRatio: number;
  nitroActive: boolean;
  spiceTimerMs: number;
  spiceHarvestCount: number;
  fireCooldownRatio: number;
  flatTireTimerMs: number;
  hitsLanded: number;
  autoPilot: boolean;
  sandwormWarning: boolean;
  lap: number;
  totalLaps: number;
  position: number;
  totalRacers: number;
  elapsedMs: number;
  currentLapMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  countdown: number | null;
  finished: boolean;
  standings: {
    id: string;
    name: string;
    isPlayer: boolean;
    isBot: boolean;
    position: number;
    lap: number;
    progress: number;
    x: number;
    z: number;
    finished: boolean;
    finishTimeMs: number | null;
    bestLapMs: number | null;
    color: string;
  }[];
  lapBanner: string | null;
}

export interface TouchInputState {
  throttle: boolean;
  brake: boolean;
  left: boolean;
  right: boolean;
  nitro: boolean;
  fire: boolean;
}

interface RaceViewportProps {
  sceneMode: ViewportSceneMode;
  trackId: TrackId;
  customSignImages?: CustomSignImagesMap;
  vehicleConfig: VehicleConfig;
  driverName: string;
  raceMode: RaceMode;
  singleplayerAutoPilot?: boolean;
  totalLaps: number;
  aiCount: number;
  raceSessionId: number;
  cameraMode: CameraViewMode;
  paused: boolean;
  multiplayerRoom: MultiplayerRoomState | null;
  clientId: string | null;
  multiplayerCountdown: number | null;
  remoteTelemetryRef: React.MutableRefObject<RoomTelemetryPacket[]>;
  combatEventsRef: React.MutableRefObject<CombatNetworkEvent[]>;
  sendWs: (msg: ClientWsMessage) => void;
  audioEngine: RacingAudioEngine;
  touchInputRef: React.MutableRefObject<TouchInputState>;
  onHudUpdate: (snapshot: HudSnapshot) => void;
  onRaceFinish: (result: {
    bestLapMs: number;
    totalRaceMs: number;
    position: number;
    standings: HudSnapshot['standings'];
  }) => void;
  onCycleCamera: () => void;
  onTogglePause: () => void;
}

// Pre-allocated math helpers (zero GC inside animation loop)
const _camTargetPos = new THREE.Vector3();
const _camLookAt = new THREE.Vector3();
const _currentLookAt = new THREE.Vector3();
const _forwardVec = new THREE.Vector3();
const _bgColor = new THREE.Color();
const _fogColor = new THREE.Color();
const _stormSkyDay = new THREE.Color(0xc87d46);
const _stormSkyNight = new THREE.Color(0x4a2f1c);
const _stormFogDay = new THREE.Color(0xd1894e);
const _stormFogNight = new THREE.Color(0x52341f);

function createSandParticleTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255, 224, 178, 1)');
    grad.addColorStop(0.45, 'rgba(222, 152, 84, 0.65)');
    grad.addColorStop(1, 'rgba(194, 120, 56, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function detectSoftwareWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return true;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
    const gpu = String(gl.getParameter(param));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
  } catch {
    return true;
  }
}

export const RaceViewport: React.FC<RaceViewportProps> = ({
  sceneMode,
  trackId,
  customSignImages,
  vehicleConfig,
  driverName,
  raceMode,
  singleplayerAutoPilot,
  totalLaps,
  aiCount,
  raceSessionId,
  cameraMode,
  paused,
  multiplayerRoom,
  clientId,
  multiplayerCountdown,
  remoteTelemetryRef,
  combatEventsRef,
  sendWs,
  audioEngine,
  touchInputRef,
  onHudUpdate,
  onRaceFinish,
  onCycleCamera,
  onTogglePause,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const sandstormLayerRef = useRef<HTMLDivElement | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [sandstormWarning, setSandstormWarning] = useState(false);

  // Latest props synced to refs so WebGL effect mounts strictly once
  const propsRef = useRef({
    sceneMode,
    trackId,
    customSignImages,
    vehicleConfig,
    driverName,
    raceMode,
    singleplayerAutoPilot,
    totalLaps,
    aiCount,
    raceSessionId,
    cameraMode,
    paused,
    multiplayerRoom,
    clientId,
    multiplayerCountdown,
  });
  propsRef.current = {
    sceneMode,
    trackId,
    customSignImages,
    vehicleConfig,
    driverName,
    raceMode,
    singleplayerAutoPilot,
    totalLaps,
    aiCount,
    raceSessionId,
    cameraMode,
    paused,
    multiplayerRoom,
    clientId,
    multiplayerCountdown,
  };

  const callbacksRef = useRef({
    sendWs,
    onHudUpdate,
    onRaceFinish,
    onCycleCamera,
    onTogglePause,
  });
  callbacksRef.current = {
    sendWs,
    onHudUpdate,
    onRaceFinish,
    onCycleCamera,
    onTogglePause,
  };

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = detectSoftwareWebGL();
    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    container.appendChild(renderer.domElement);

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      setContextLost(true);
    };
    const handleContextRestored = () => {
      setContextLost(false);
    };
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost);
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored);

    const scene = new THREE.Scene();
    const sceneBgColor = new THREE.Color(0x0b0d11);
    const sceneFog = new THREE.FogExp2(0x0b0d11, 0.022);
    scene.background = sceneBgColor;
    scene.fog = sceneFog;
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const envTexture = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = envTexture;
    pmremGenerator.dispose();

    const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();

    const camera = new THREE.PerspectiveCamera(
      55,
      Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
      0.2,
      1400
    );

    // 3-Point Warm/Cool Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0xdbeafe, 0x1e293b, 0.75);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff4e0, 1.7);
    keyLight.position.set(45, 75, 35);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.set(2048, 2048);
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 260;
    const d = 90;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);
    scene.add(keyLight.target);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.65);
    rimLight.position.set(-40, 30, -50);
    scene.add(rimLight);

    // Showroom Paddock Group (Turntable + Studio Floor)
    const showroomGroup = new THREE.Group();
    const studioFloorGeo = new THREE.CircleGeometry(36, 48);
    studioFloorGeo.rotateX(-Math.PI / 2);
    const studioFloorMat = new THREE.MeshStandardMaterial({
      color: 0x12151c,
      roughness: 0.42,
      metalness: 0.35,
    });
    const studioFloor = new THREE.Mesh(studioFloorGeo, studioFloorMat);
    studioFloor.receiveShadow = true;

    const plinthGeo = new THREE.CylinderGeometry(3.4, 3.65, 0.18, 48);
    const plinthMat = new THREE.MeshStandardMaterial({
      color: 0x1e222d,
      roughness: 0.28,
      metalness: 0.72,
    });
    const plinth = new THREE.Mesh(plinthGeo, plinthMat);
    plinth.position.y = 0.09;
    plinth.receiveShadow = true;

    const ringGeo = new THREE.RingGeometry(3.32, 3.45, 64);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xf59e0b });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    ringMesh.position.y = 0.19;

    showroomGroup.add(studioFloor, plinth, ringMesh);
    scene.add(showroomGroup);

    // Procedural Sandstorm Particle Cloud (wind-blown dust surrounding active camera)
    const sandParticleCount = isSoftwareGl ? 160 : 420;
    const sandBoxSpan = 56;
    const sandBoxHeight = 16;
    const sandPositions = new Float32Array(sandParticleCount * 3);
    const sandVelocities = new Float32Array(sandParticleCount * 3);
    for (let i = 0; i < sandParticleCount; i++) {
      const i3 = i * 3;
      sandPositions[i3] = (Math.random() - 0.5) * sandBoxSpan;
      sandPositions[i3 + 1] = (Math.random() - 0.35) * sandBoxHeight;
      sandPositions[i3 + 2] = (Math.random() - 0.5) * sandBoxSpan;
      sandVelocities[i3] = 24 + Math.random() * 14;
      sandVelocities[i3 + 1] = -1.2 + Math.random() * 2.4;
      sandVelocities[i3 + 2] = 11 + Math.random() * 10;
    }
    const sandGeo = new THREE.BufferGeometry();
    const sandPosAttr = new THREE.BufferAttribute(sandPositions, 3);
    sandGeo.setAttribute('position', sandPosAttr);
    const sandTexture = createSandParticleTexture();
    const sandMat = new THREE.PointsMaterial({
      size: 1.15,
      map: sandTexture,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      sizeAttenuation: true,
      fog: false,
    });
    const sandPoints = new THREE.Points(sandGeo, sandMat);
    sandPoints.frustumCulled = false;
    sandPoints.visible = false;
    scene.add(sandPoints);

    // Pre-allocated blaster projectile pool (zero GC during races)
    const PROJECTILE_POOL_SIZE = 24;
    const PLAYER_FIRE_COOLDOWN = 1.15;
    const AI_FIRE_COOLDOWN = 2.6;
    const boltGeo = new THREE.CapsuleGeometry(0.11, 0.95, 4, 8);
    boltGeo.rotateX(Math.PI / 2);
    const boltMat = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    interface ProjectileSlot {
      active: boolean;
      visualOnly: boolean;
      ownerId: string;
      ownerIsPlayer: boolean;
      x: number;
      y: number;
      z: number;
      vx: number;
      vz: number;
      life: number;
      mesh: THREE.Mesh;
    }
    const projectilePool: ProjectileSlot[] = [];
    for (let i = 0; i < PROJECTILE_POOL_SIZE; i++) {
      const mesh = new THREE.Mesh(boltGeo, boltMat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      projectilePool.push({
        active: false,
        visualOnly: false,
        ownerId: '',
        ownerIsPlayer: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vz: 0,
        life: 0,
        mesh,
      });
    }

    // Sandworm Crossing & Worm-Dropped Spice Nitro Pool (zero GC)
    const WORM_SEGMENT_COUNT = 16;
    const wormGroup = new THREE.Group();
    wormGroup.visible = false;
    scene.add(wormGroup);

    const wormSegGeo = new THREE.CylinderGeometry(2.85, 2.65, 3.15, 18);
    wormSegGeo.rotateZ(Math.PI / 2);
    const wormRidgeGeo = new THREE.TorusGeometry(2.96, 0.28, 8, 20);
    wormRidgeGeo.rotateY(Math.PI / 2);
    const wormCollarGeo = new THREE.TorusGeometry(2.74, 0.2, 8, 18);
    wormCollarGeo.rotateY(Math.PI / 2);
    const wormDorsalGeo = new THREE.BoxGeometry(1.75, 0.88, 0.42);
    const wormScaleGeo = new THREE.BoxGeometry(1.95, 0.52, 0.34);
    const wormMawGeo = new THREE.TorusGeometry(2.65, 0.44, 10, 22);
    wormMawGeo.rotateY(Math.PI / 2);
    const wormInnerMawGeo = new THREE.TorusGeometry(1.95, 0.3, 8, 18);
    wormInnerMawGeo.rotateY(Math.PI / 2);
    const wormFangGeo = new THREE.ConeGeometry(0.26, 1.55, 5);
    const wormGulletGeo = new THREE.SphereGeometry(1.88, 14, 12);

    const wormHideMat = new THREE.MeshStandardMaterial({
      color: 0x7a4d29,
      roughness: 0.78,
      metalness: 0.16,
    });
    const wormRidgeMat = new THREE.MeshStandardMaterial({
      color: 0x472a14,
      roughness: 0.84,
      metalness: 0.24,
    });
    const wormCollarMat = new THREE.MeshStandardMaterial({
      color: 0x6d5238,
      roughness: 0.46,
      metalness: 0.58,
    });
    const wormMawMat = new THREE.MeshStandardMaterial({
      color: 0x1e1108,
      roughness: 0.44,
      metalness: 0.42,
    });
    const wormFangMat = new THREE.MeshStandardMaterial({
      color: 0xf1e5cb,
      emissive: 0x3a2612,
      emissiveIntensity: 0.35,
      roughness: 0.28,
      metalness: 0.35,
    });
    const wormGulletMat = new THREE.MeshBasicMaterial({ color: 0xff7b1c });

    interface WormSegmentNode {
      group: THREE.Group;
      lat: number;
      yOffset: number;
    }
    const wormSegments: WormSegmentNode[] = [];
    for (let i = 0; i < WORM_SEGMENT_COUNT; i++) {
      const segGroup = new THREE.Group();
      const taper =
        i === 0 ? 1.12 : Math.max(0.42, 1.0 - (i / WORM_SEGMENT_COUNT) * 0.56);
      const body = new THREE.Mesh(wormSegGeo, wormHideMat);
      body.scale.set(1, taper, taper);
      body.castShadow = true;

      const ridge = new THREE.Mesh(wormRidgeGeo, wormRidgeMat);
      ridge.scale.set(1, taper, taper);
      ridge.position.x = 0.85;

      const collar = new THREE.Mesh(wormCollarGeo, wormCollarMat);
      collar.scale.set(1, taper, taper);
      collar.position.x = -0.85;

      const dorsal = new THREE.Mesh(wormDorsalGeo, wormRidgeMat);
      dorsal.scale.set(1, taper, taper);
      dorsal.position.set(0, 2.75 * taper, 0);
      dorsal.rotation.z = -0.22;

      const leftScale = new THREE.Mesh(wormScaleGeo, wormCollarMat);
      leftScale.scale.set(1, taper, taper);
      leftScale.position.set(-0.15, 0.55 * taper, 2.66 * taper);
      leftScale.rotation.y = 0.14;

      const rightScale = new THREE.Mesh(wormScaleGeo, wormCollarMat);
      rightScale.scale.set(1, taper, taper);
      rightScale.position.set(-0.15, 0.55 * taper, -2.66 * taper);
      rightScale.rotation.y = -0.14;

      segGroup.add(body, ridge, collar, dorsal, leftScale, rightScale);

      if (i === 0) {
        const maw = new THREE.Mesh(wormMawGeo, wormMawMat);
        maw.position.x = 1.48;
        const innerMaw = new THREE.Mesh(wormInnerMawGeo, wormCollarMat);
        innerMaw.position.x = 1.72;
        const gullet = new THREE.Mesh(wormGulletGeo, wormGulletMat);
        gullet.position.x = 0.88;
        segGroup.add(maw, innerMaw, gullet);

        // Radial ring of 12 crystalline Sandworm teeth angled inward
        const FANG_COUNT = 12;
        for (let f = 0; f < FANG_COUNT; f++) {
          const angle = (f / FANG_COUNT) * Math.PI * 2;
          const fangPivot = new THREE.Group();
          fangPivot.position.set(1.92, Math.cos(angle) * 2.15, Math.sin(angle) * 2.15);
          fangPivot.rotation.x = angle;
          const fang = new THREE.Mesh(wormFangGeo, wormFangMat);
          fang.position.set(0.32, -0.52, 0);
          fang.rotation.z = 1.15;
          fangPivot.add(fang);
          segGroup.add(fangPivot);
        }
      }

      wormGroup.add(segGroup);
      wormSegments.push({ group: segGroup, lat: 0, yOffset: 0 });
    }

    const wormWarnRingGeo = new THREE.RingGeometry(4.8, 7.6, 36);
    wormWarnRingGeo.rotateX(-Math.PI / 2);
    const wormWarnRingMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.82,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const wormWarningRing = new THREE.Mesh(wormWarnRingGeo, wormWarnRingMat);
    wormWarningRing.visible = false;
    scene.add(wormWarningRing);

    // Pre-allocated Worm-Dropped Spice Nitro Deposits
    const WORM_SPICE_POOL_SIZE = 6;
    const wormSpiceMoundGeo = new THREE.ConeGeometry(1.15, 1.35, 7);
    const wormSpiceHaloGeo = new THREE.RingGeometry(1.25, 1.75, 24);
    wormSpiceHaloGeo.rotateX(-Math.PI / 2);
    const wormSpiceMoundMat = new THREE.MeshStandardMaterial({
      color: 0xff8c1a,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.7,
      roughness: 0.28,
    });
    const wormSpiceHaloMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    interface WormSpiceDropSlot {
      active: boolean;
      x: number;
      y: number;
      z: number;
      life: number;
      group: THREE.Group;
      mound: THREE.Mesh;
    }
    const wormSpicePool: WormSpiceDropSlot[] = [];
    for (let i = 0; i < WORM_SPICE_POOL_SIZE; i++) {
      const dropGroup = new THREE.Group();
      const mound = new THREE.Mesh(wormSpiceMoundGeo, wormSpiceMoundMat);
      mound.position.y = 0.72;
      const halo = new THREE.Mesh(wormSpiceHaloGeo, wormSpiceHaloMat);
      halo.position.y = 0.1;
      dropGroup.add(mound, halo);
      dropGroup.visible = false;
      scene.add(dropGroup);
      wormSpicePool.push({
        active: false,
        x: 0,
        y: 0,
        z: 0,
        life: 0,
        group: dropGroup,
        mound,
      });
    }

    // Dynamic state containers
    let activeShowroomCar: CarModelRig | null = null;
    let showroomVehicleSignature = '';
    let showroomYaw = 0.65;
    let isDraggingShowroom = false;
    let lastPointerX = 0;

    let activeTrack: BuiltTrack | null = null;
    let activeTrackId: TrackId | null = null;
    let activeTrackSignSig = 'none';

    interface RaceCarEntry {
      state: RacerState;
      rig: CarModelRig;
      isRemote: boolean;
    }
    let raceCars: RaceCarEntry[] = [];
    let currentSessionKey = '';
    let localCountdownTimer = 0;
    let localCountdownPhase: number | null = null;
    let raceStarted = false;
    let raceElapsedMs = 0;
    let hudEmitTimer = 0;
    let wsEmitTimer = 0;
    let finishReported = false;
    let lapBannerText: string | null = null;
    let lapBannerTimer = 0;
    let lastMpCountdown: number | null = null;
    let pointerFireQueued = false;

    // Sandworm runtime state
    let wormPhase: 'idle' | 'warning' | 'crossing' | 'retreating' = 'idle';
    let wormTimer = 6.5;
    let wormSampleIndex = 0;
    let wormDirection: -1 | 1 = 1;
    let wormRetreatProgress = 0;
    const wormCarHitCooldowns = new Map<string, number>();

    // Random Sandstorm state
    let sandstormActive = false;
    let sandstormIntensity = 0;
    let sandstormCooldown = 10;
    let sandstormBannerShown = false;

    // Input Tracking
    const keys = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const code = e.code;
      keys.add(code);
      if (propsRef.current.sceneMode === 'race') {
        if (code === 'KeyC') callbacksRef.current.onCycleCamera();
        if (code === 'Escape') callbacksRef.current.onTogglePause();
        if (code === 'KeyR' && activeTrack) {
          const playerEntry = raceCars.find((c) => c.state.isPlayer);
          if (playerEntry) resetRacerToTrack(playerEntry.state, activeTrack);
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      keys.delete(e.code);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (propsRef.current.sceneMode === 'showroom') {
        isDraggingShowroom = true;
        lastPointerX = e.clientX;
      } else if (propsRef.current.sceneMode === 'race' && e.button === 0) {
        pointerFireQueued = true;
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (isDraggingShowroom && propsRef.current.sceneMode === 'showroom') {
        const dx = e.clientX - lastPointerX;
        lastPointerX = e.clientX;
        showroomYaw += dx * 0.008;
      }
    };
    const onPointerUp = () => {
      isDraggingShowroom = false;
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);

    const onResize = () => {
      if (!container) return;
      const w = Math.max(1, container.clientWidth);
      const h = Math.max(1, container.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    function clearRaceCars() {
      for (const entry of raceCars) {
        scene.remove(entry.rig.root);
        entry.rig.dispose();
      }
      raceCars = [];
    }

    function clearProjectiles() {
      for (const slot of projectilePool) {
        slot.active = false;
        slot.mesh.visible = false;
      }
    }

    function spawnBolt(
      ownerId: string,
      ownerIsPlayer: boolean,
      x: number,
      y: number,
      z: number,
      heading: number,
      speedMs: number,
      visualOnly: boolean
    ) {
      for (const slot of projectilePool) {
        if (!slot.active) {
          slot.active = true;
          slot.visualOnly = visualOnly;
          slot.ownerId = ownerId;
          slot.ownerIsPlayer = ownerIsPlayer;
          slot.x = x;
          slot.y = y;
          slot.z = z;
          slot.vx = -Math.sin(heading) * speedMs;
          slot.vz = -Math.cos(heading) * speedMs;
          slot.life = 0.85;
          slot.mesh.position.set(x, y, z);
          slot.mesh.rotation.set(0, heading, 0);
          slot.mesh.visible = true;
          return;
        }
      }
    }

    function fireBlasters(shooter: RacerState, broadcastWs: boolean) {
      if (shooter.fireCooldown > 0 || shooter.finished) return;
      shooter.fireCooldown = shooter.isBot ? AI_FIRE_COOLDOWN : PLAYER_FIRE_COOLDOWN;
      shooter.muzzleFlashTimer = 0.08;

      const fx = -Math.sin(shooter.heading);
      const fz = -Math.cos(shooter.heading);
      const rx = Math.cos(shooter.heading);
      const rz = -Math.sin(shooter.heading);
      const boltY = shooter.y + 0.65;
      const boltSpeed = 180;

      spawnBolt(
        shooter.id,
        shooter.isPlayer,
        shooter.x + fx * 2.15 - rx * 0.52,
        boltY,
        shooter.z + fz * 2.15 - rz * 0.52,
        shooter.heading,
        boltSpeed,
        false
      );
      spawnBolt(
        shooter.id,
        shooter.isPlayer,
        shooter.x + fx * 2.15 + rx * 0.52,
        boltY,
        shooter.z + fz * 2.15 + rz * 0.52,
        shooter.heading,
        boltSpeed,
        false
      );

      if (shooter.isPlayer) {
        audioEngine.playLaserShot();
        if (broadcastWs) {
          callbacksRef.current.sendWs({
            type: 'race:fire',
            x: shooter.x,
            y: boltY,
            z: shooter.z,
            heading: shooter.heading,
            speedMs: boltSpeed,
          });
        }
      } else {
        const player = raceCars.find((c) => c.state.isPlayer)?.state;
        if (player) {
          const dx = shooter.x - player.x;
          const dz = shooter.z - player.z;
          if (dx * dx + dz * dz < 65 * 65) {
            audioEngine.playLaserShot();
          }
        }
      }
    }

    function clearSandwormAndDrops() {
      wormPhase = 'idle';
      wormTimer = 6.5;
      wormRetreatProgress = 0;
      wormGroup.visible = false;
      wormWarningRing.visible = false;
      wormCarHitCooldowns.clear();
      for (const slot of wormSpicePool) {
        slot.active = false;
        slot.group.visible = false;
      }
    }

    function spawnWormSpiceDrop(x: number, y: number, z: number) {
      let chosen = wormSpicePool.find((s) => !s.active);
      if (!chosen) chosen = wormSpicePool[0];
      chosen.active = true;
      chosen.x = x;
      chosen.y = y;
      chosen.z = z;
      chosen.life = 28;
      chosen.group.position.set(x, y, z);
      chosen.group.visible = true;
    }

    function startWormCrossing(sampleIdx: number, direction: -1 | 1) {
      if (!activeTrack || activeTrack.samples.length === 0) return;
      wormSampleIndex = ((sampleIdx % activeTrack.samples.length) + activeTrack.samples.length) % activeTrack.samples.length;
      wormDirection = direction;
      wormPhase = 'warning';
      wormTimer = 1.65;
      wormGroup.visible = false;
      const sample = activeTrack.samples[wormSampleIndex];
      wormWarningRing.position.set(sample.pos.x, sample.pos.y + 0.12, sample.pos.z);
      wormWarningRing.visible = true;
      audioEngine.playWormWarning();
    }

    function retreatWormAndDropSpice(sampleIdx: number, byPlayer: boolean) {
      if (!activeTrack) return;
      const sample = activeTrack.samples[sampleIdx % activeTrack.samples.length];
      wormPhase = 'retreating';
      wormRetreatProgress = 0;
      wormTimer = 0.72;
      wormWarningRing.visible = false;
      spawnWormSpiceDrop(sample.pos.x, sample.pos.y, sample.pos.z);
      audioEngine.playWormRetreat();
      if (byPlayer) {
        lapBannerText = 'WORM SHOT · SPICE NITRO DROPPED!';
        lapBannerTimer = 2.2;
      }
    }

    function getSignSignature(tId: TrackId, map?: CustomSignImagesMap): string {
      const slots = map?.[tId];
      if (!slots) return 'default';
      return slots
        .map((s) =>
          s === null ? 'cleared' : s?.dataUrl ? `${s.dataUrl.length}:${s.dataUrl.slice(-16)}` : 'def'
        )
        .join('|');
    }

    function ensureTrackBuilt(tId: TrackId) {
      const signSlots = propsRef.current.customSignImages?.[tId] ?? null;
      const signSig = getSignSignature(tId, propsRef.current.customSignImages);
      if (activeTrackId === tId && activeTrackSignSig === signSig && activeTrack) return;
      if (activeTrack) {
        scene.remove(activeTrack.group);
        activeTrack.dispose();
      }
      const meta = TRACK_MAP[tId];
      activeTrack = buildTrackScene(meta, maxAnisotropy, signSlots);
      activeTrackId = tId;
      activeTrackSignSig = signSig;
      scene.add(activeTrack.group);
    }

    function applyEnvironmentForMode(mode: ViewportSceneMode, tId: TrackId, stormIntensity = 0) {
      if (mode === 'showroom') {
        sceneBgColor.setHex(0x0b0d11);
        sceneFog.color.setHex(0x0b0d11);
        sceneFog.density = 0.022;
        hemiLight.color.set(0xdbeafe);
        hemiLight.groundColor.set(0x18181b);
        hemiLight.intensity = 0.85;
        keyLight.color.set(0xfff5e6);
        keyLight.intensity = 1.9;
        keyLight.position.set(14, 22, 16);
        keyLight.target.position.set(0, 0, 0);
        showroomGroup.visible = true;
        if (activeTrack) activeTrack.group.visible = false;
      } else {
        const meta = TRACK_MAP[tId];
        ensureTrackBuilt(tId);
        if (activeTrack) activeTrack.group.visible = true;
        showroomGroup.visible = false;

        _bgColor.set(meta.skyColor);
        _fogColor.set(meta.fogColor);
        if (stormIntensity > 0.001) {
          const stormSky = meta.isNight ? _stormSkyNight : _stormSkyDay;
          const stormFog = meta.isNight ? _stormFogNight : _stormFogDay;
          _bgColor.lerp(stormSky, stormIntensity * 0.85);
          _fogColor.lerp(stormFog, stormIntensity * 0.88);
        }

        sceneBgColor.copy(_bgColor);
        sceneFog.color.copy(_fogColor);
        sceneFog.density = THREE.MathUtils.lerp(meta.fogDensity, 0.0148, stormIntensity);

        hemiLight.color.set(meta.ambientSky);
        hemiLight.groundColor.set(meta.ambientGround);
        hemiLight.intensity = (meta.isNight ? 0.65 : 0.85) * (1 - stormIntensity * 0.25);
        keyLight.color.set(meta.sunColor);
        keyLight.intensity = meta.sunIntensity * (1 - stormIntensity * 0.42);
      }
    }

    function syncSandstormOverlay(intensity: number, activeInRace: boolean) {
      const effective = activeInRace ? intensity : 0;
      if (sandstormLayerRef.current) {
        sandstormLayerRef.current.style.opacity = effective > 0.004 ? effective.toFixed(3) : '0';
      }
      const shouldShowBanner = activeInRace && effective > 0.14;
      if (shouldShowBanner !== sandstormBannerShown) {
        sandstormBannerShown = shouldShowBanner;
        setSandstormWarning(shouldShowBanner);
      }
    }

    function updateSandParticles(dt: number, intensity: number) {
      if (intensity <= 0.01) {
        sandPoints.visible = false;
        return;
      }
      sandPoints.visible = true;
      sandMat.opacity = intensity * 0.52;

      const halfSpan = sandBoxSpan * 0.5;
      const halfHeight = sandBoxHeight * 0.5;
      const cx = camera.position.x;
      const cy = camera.position.y + 1.5;
      const cz = camera.position.z;

      for (let i = 0; i < sandParticleCount; i++) {
        const i3 = i * 3;
        let px = sandPositions[i3] + sandVelocities[i3] * dt * (0.7 + intensity * 0.7);
        let py = sandPositions[i3 + 1] + sandVelocities[i3 + 1] * dt;
        let pz = sandPositions[i3 + 2] + sandVelocities[i3 + 2] * dt * (0.7 + intensity * 0.7);

        if (px - cx > halfSpan) px -= sandBoxSpan;
        else if (px - cx < -halfSpan) px += sandBoxSpan;

        if (py - cy > halfHeight) py -= sandBoxHeight;
        else if (py - cy < -halfHeight) py += sandBoxHeight;

        if (pz - cz > halfSpan) pz -= sandBoxSpan;
        else if (pz - cz < -halfSpan) pz += sandBoxSpan;

        sandPositions[i3] = px;
        sandPositions[i3 + 1] = py;
        sandPositions[i3 + 2] = pz;
      }
      sandPosAttr.needsUpdate = true;
    }

    function initRaceSession() {
      const p = propsRef.current;
      ensureTrackBuilt(p.trackId);
      if (!activeTrack) return;
      clearRaceCars();
      clearProjectiles();
      clearSandwormAndDrops();
      combatEventsRef.current.length = 0;
      pointerFireQueued = false;

      raceElapsedMs = 0;
      finishReported = false;
      lapBannerText = null;
      lapBannerTimer = 0;
      lastMpCountdown = null;
      sandstormActive = false;
      sandstormIntensity = 0;
      sandstormCooldown = 7 + Math.random() * 11;
      syncSandstormOverlay(0, false);
      for (const canister of activeTrack.spiceCanisters) {
        canister.respawnTimer = 0;
        canister.mesh.visible = true;
      }

      if (p.raceMode === 'multiplayer' && p.multiplayerRoom) {
        raceStarted = false;
        localCountdownPhase = p.multiplayerCountdown ?? 3;

        const players = p.multiplayerRoom.players;
        for (const rp of players) {
          const isMe = rp.id === p.clientId;
          const state = createRacerAtGrid({
            id: rp.id,
            name: rp.name,
            isPlayer: isMe,
            isBot: false,
            gridSlot: rp.gridSlot,
            vehicle: rp.vehicle,
            track: activeTrack,
          });
          const rig = buildVehicleModel(rp.vehicle, maxAnisotropy, isSoftwareGl);
          rig.root.position.set(state.x, state.y, state.z);
          rig.root.rotation.y = state.heading;
          scene.add(rig.root);
          raceCars.push({ state, rig, isRemote: !isMe });
        }

        // Fill remaining slots with AI bots if enabled (host simulates them)
        const isHost = p.multiplayerRoom.hostId === p.clientId;
        if (p.multiplayerRoom.fillBots && players.length < 4) {
          const botNames = ['Thufir Pace', 'Chani K.', 'Feyd R.'];
          for (let slot = players.length; slot < 4; slot++) {
            const botIdx = slot - players.length;
            const botVehicle = createAiVehicleConfig(botIdx);
            const state = createRacerAtGrid({
              id: `mp_bot_${slot}`,
              name: botNames[botIdx % botNames.length],
              isPlayer: false,
              isBot: true,
              gridSlot: slot,
              vehicle: botVehicle,
              track: activeTrack,
              aiSkill: 0.88 + botIdx * 0.03,
            });
            const rig = buildVehicleModel(botVehicle, maxAnisotropy, isSoftwareGl);
            rig.root.position.set(state.x, state.y, state.z);
            rig.root.rotation.y = state.heading;
            scene.add(rig.root);
            raceCars.push({ state, rig, isRemote: !isHost });
          }
        }
      } else {
        // Singleplayer: Player in slot 0 + AI rivals
        raceStarted = false;
        localCountdownTimer = 3.2;
        localCountdownPhase = 3;
        audioEngine.playCountdown(false);

        const playerState = createRacerAtGrid({
          id: 'local_player',
          name: p.driverName || 'You',
          isPlayer: true,
          isBot: false,
          gridSlot: 0,
          vehicle: p.vehicleConfig,
          track: activeTrack,
        });
        const playerRig = buildVehicleModel(p.vehicleConfig, maxAnisotropy, isSoftwareGl);
        playerRig.root.position.set(playerState.x, playerState.y, playerState.z);
        playerRig.root.rotation.y = playerState.heading;
        scene.add(playerRig.root);
        raceCars.push({ state: playerState, rig: playerRig, isRemote: false });

        const rivalNames = ['Duncan Idaho', 'Gurney Halleck', 'Stilgar'];
        for (let i = 0; i < p.aiCount; i++) {
          const botVehicle = createAiVehicleConfig(i);
          const botState = createRacerAtGrid({
            id: `ai_${i}`,
            name: rivalNames[i % rivalNames.length],
            isPlayer: false,
            isBot: true,
            gridSlot: i + 1,
            vehicle: botVehicle,
            track: activeTrack,
            aiSkill: 0.87 + i * 0.035,
          });
          const botRig = buildVehicleModel(botVehicle, maxAnisotropy, isSoftwareGl);
          botRig.root.position.set(botState.x, botState.y, botState.z);
          botRig.root.rotation.y = botState.heading;
          scene.add(botRig.root);
          raceCars.push({ state: botState, rig: botRig, isRemote: false });
        }
      }

      // Snap camera behind player immediately
      const player = raceCars.find((c) => c.state.isPlayer);
      if (player) {
        const fx = -Math.sin(player.state.heading);
        const fz = -Math.cos(player.state.heading);
        camera.position.set(player.state.x - fx * 9, player.state.y + 3.6, player.state.z - fz * 9);
        _currentLookAt.set(player.state.x + fx * 6, player.state.y + 1.1, player.state.z + fz * 6);
        camera.lookAt(_currentLookAt);
      }
    }

    // Initial showroom setup
    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) return;
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function readPlayerInput(): PlayerControlInput {
      const touch = touchInputRef.current;
      const throttle =
        keys.has('KeyW') || keys.has('ArrowUp') || touch.throttle ? 1 : 0;
      const brake =
        keys.has('KeyS') || keys.has('ArrowDown') || touch.brake ? 1 : 0;
      let steer = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft') || touch.left) steer += 1;
      if (keys.has('KeyD') || keys.has('ArrowRight') || touch.right) steer -= 1;
      const nitro =
        keys.has('Space') || keys.has('ShiftLeft') || keys.has('ShiftRight') || touch.nitro;
      const drift = keys.has('KeyB') || keys.has('ControlLeft');
      return { throttle, brake, steer, nitro, drift };
    }

    function tick() {
      if (disposed) return;
      const rawDelta = clock.getDelta();
      const dt = Math.min(rawDelta, 0.05);
      const elapsedTotal = clock.elapsedTime;
      const p = propsRef.current;

      if (p.sceneMode !== 'race') {
        sandstormActive = false;
        sandstormIntensity = 0;
        sandPoints.visible = false;
        clearProjectiles();
        clearSandwormAndDrops();
        combatEventsRef.current.length = 0;
        pointerFireQueued = false;
        syncSandstormOverlay(0, false);
        applyEnvironmentForMode(p.sceneMode, p.trackId, 0);
        if (activeTrack) activeTrack.racingLineMesh.visible = false;
      }

      if (p.sceneMode === 'showroom') {
        clearRaceCars();
        audioEngine.updateDrive({
          active: false,
          speedRatio: 0,
          rpmRatio: 0,
          nitroActive: false,
          slipRatio: 0,
        });

        const sig = JSON.stringify(p.vehicleConfig);
        if (sig !== showroomVehicleSignature) {
          showroomVehicleSignature = sig;
          if (activeShowroomCar) {
            scene.remove(activeShowroomCar.root);
            activeShowroomCar.dispose();
          }
          activeShowroomCar = buildVehicleModel(p.vehicleConfig, maxAnisotropy, isSoftwareGl);
          activeShowroomCar.root.position.set(0, 0.18, 0);
          scene.add(activeShowroomCar.root);
        }

        if (!isDraggingShowroom) {
          showroomYaw += dt * 0.26;
        }
        if (activeShowroomCar) {
          activeShowroomCar.root.rotation.y = showroomYaw;
        }

        camera.fov = THREE.MathUtils.damp(camera.fov, 46, 8, dt);
        camera.updateProjectionMatrix();
        _camTargetPos.set(0, 2.25, 6.6);
        camera.position.lerp(_camTargetPos, 1 - Math.exp(-8 * dt));
        _camLookAt.set(0, 0.72, 0);
        camera.lookAt(_camLookAt);
      } else if (p.sceneMode === 'track_preview') {
        clearRaceCars();
        audioEngine.updateDrive({
          active: false,
          speedRatio: 0,
          rpmRatio: 0,
          nitroActive: false,
          slipRatio: 0,
        });

        const orbitAngle = elapsedTotal * 0.14;
        const radius = 340;
        camera.fov = THREE.MathUtils.damp(camera.fov, 52, 8, dt);
        camera.updateProjectionMatrix();
        camera.position.set(
          Math.cos(orbitAngle) * radius,
          145,
          Math.sin(orbitAngle) * radius
        );
        camera.lookAt(0, 4, 0);
        keyLight.position.set(120, 180, 90);
        keyLight.target.position.set(0, 0, 0);
        if (activeTrack) {
          for (const c of activeTrack.spiceCanisters) {
            c.mesh.visible = true;
            c.mesh.rotation.y += dt * 1.6;
            c.mesh.position.y = c.baseY + Math.sin(elapsedTotal * 3 + c.id) * 0.2;
          }
        }
      } else if (p.sceneMode === 'race') {
        const sessionKey = `${p.raceSessionId}_${p.trackId}_${p.raceMode}`;
        if (sessionKey !== currentSessionKey) {
          currentSessionKey = sessionKey;
          initRaceSession();
        }

        const isPaused = p.paused && p.raceMode === 'singleplayer';

        // Countdown handling
        if (!raceStarted && !isPaused) {
          if (p.raceMode === 'singleplayer') {
            localCountdownTimer -= dt;
            const phase = Math.ceil(localCountdownTimer);
            if (phase !== localCountdownPhase && phase >= 1 && phase <= 3) {
              localCountdownPhase = phase;
              audioEngine.playCountdown(false);
            }
            if (localCountdownTimer <= 0) {
              raceStarted = true;
              localCountdownPhase = 0;
              audioEngine.playCountdown(true);
              lapBannerText = 'GO';
              lapBannerTimer = 1.2;
            }
          } else {
            // Multiplayer countdown driven by server WebSocket
            const mpCd = p.multiplayerCountdown;
            if (mpCd !== lastMpCountdown) {
              lastMpCountdown = mpCd;
              if (mpCd === 3 || mpCd === 2 || mpCd === 1) {
                localCountdownPhase = mpCd;
                audioEngine.playCountdown(false);
              } else if (mpCd === 0 || p.multiplayerRoom?.status === 'racing') {
                raceStarted = true;
                localCountdownPhase = 0;
                audioEngine.playCountdown(true);
                lapBannerText = 'GO';
                lapBannerTimer = 1.2;
              }
            } else if (p.multiplayerRoom?.status === 'racing') {
              raceStarted = true;
              localCountdownPhase = 0;
            }
          }
        }

        if (lapBannerTimer > 0) {
          lapBannerTimer -= dt;
          if (lapBannerTimer <= 0) lapBannerText = null;
        }

        const playerEntry = raceCars.find((c) => c.state.isPlayer);

        // Random Sandstorm weather cycle during active race
        if (raceStarted && !isPaused) {
          if (playerEntry?.state.finished) {
            sandstormActive = false;
          } else {
            sandstormCooldown -= dt;
            if (sandstormCooldown <= 0) {
              sandstormActive = !sandstormActive;
              sandstormCooldown = sandstormActive
                ? 9 + Math.random() * 7
                : 13 + Math.random() * 13;
            }
          }
          sandstormIntensity = THREE.MathUtils.damp(
            sandstormIntensity,
            sandstormActive ? 1 : 0,
            sandstormActive ? 1.35 : 1.05,
            dt
          );
          if (!sandstormActive && sandstormIntensity < 0.003) {
            sandstormIntensity = 0;
          }
        }

        applyEnvironmentForMode('race', p.trackId, sandstormIntensity);
        syncSandstormOverlay(sandstormIntensity, true);
        updateSandParticles(isPaused ? 0 : dt, sandstormIntensity);

        const stormGripMultiplier = 1 - sandstormIntensity * 0.24;

        const autoPilotActive =
          p.raceMode === 'multiplayer'
            ? Boolean(p.multiplayerRoom?.autoPilot)
            : Boolean(p.singleplayerAutoPilot);
        if (activeTrack) {
          activeTrack.racingLineMesh.visible = autoPilotActive;
        }

        // Animate & respawn Spice Harvest canisters on track
        if (activeTrack) {
          for (const canister of activeTrack.spiceCanisters) {
            if (canister.respawnTimer > 0) {
              if (raceStarted && !isPaused) {
                canister.respawnTimer = Math.max(0, canister.respawnTimer - dt);
                if (canister.respawnTimer <= 0) {
                  canister.mesh.visible = true;
                }
              }
            } else {
              canister.mesh.visible = true;
              canister.mesh.rotation.y += dt * 1.85;
              canister.mesh.position.y =
                canister.baseY + Math.sin(elapsedTotal * 3.4 + canister.id) * 0.18;
            }
          }
        }

        if (raceStarted && !isPaused && activeTrack) {
          raceElapsedMs += dt * 1000;
          const allStates = raceCars.map((c) => c.state);

          // Step local cars (player + non-remote AI bots)
          for (const entry of raceCars) {
            if (entry.isRemote) continue;
            let input = entry.state.isPlayer
              ? entry.state.finished
                ? computeAiControl(entry.state, activeTrack, allStates)
                : readPlayerInput()
              : computeAiControl(entry.state, activeTrack, allStates);

            const useAutoPilot = autoPilotActive && entry.state.isPlayer && !entry.state.finished;
            if (useAutoPilot) {
              input = applyAutoPilotAssist(entry.state, input, activeTrack);
            }

            stepRacerPhysics(
              entry.state,
              input,
              activeTrack,
              dt,
              raceElapsedMs,
              p.totalLaps,
              (racer, lapTimeMs, finished) => {
                if (racer.isPlayer) {
                  audioEngine.playLapChime(finished);
                  if (finished) {
                    lapBannerText = 'FINISH';
                    lapBannerTimer = 3.0;
                  } else {
                    const sec = (lapTimeMs / 1000).toFixed(2);
                    lapBannerText = `LAP ${racer.lap}/${p.totalLaps} · ${sec}s`;
                    lapBannerTimer = 2.4;
                  }
                }
              },
              stormGripMultiplier,
              useAutoPilot
            );

            // Check Spice Harvest canister collection
            if (!entry.state.finished) {
              const st = entry.state;
              for (const canister of activeTrack.spiceCanisters) {
                if (canister.respawnTimer > 0) continue;
                const dx = st.x - canister.pos.x;
                const dz = st.z - canister.pos.z;
                const dy = Math.abs(st.y - canister.pos.y);
                const hitRadius = canister.radius + 1.35;
                if (dy < 3.5 && dx * dx + dz * dz < hitRadius * hitRadius) {
                  canister.respawnTimer = 8.5;
                  canister.mesh.visible = false;
                  st.spiceTimer = 2.0;
                  st.spiceCount += 1;
                  if (st.isPlayer) {
                    audioEngine.playSpicePickup();
                  }
                  break;
                }
              }
            }
            // Check blaster firing for player & AI
            if (!entry.state.finished && entry.state.fireCooldown <= 0) {
              if (entry.state.isPlayer) {
                const wantsFire =
                  pointerFireQueued ||
                  keys.has('KeyF') ||
                  keys.has('Enter') ||
                  touchInputRef.current.fire;
                if (wantsFire) {
                  pointerFireQueued = false;
                  fireBlasters(entry.state, p.raceMode === 'multiplayer');
                }
              } else if (entry.state.isBot) {
                const bot = entry.state;
                const fx = -Math.sin(bot.heading);
                const fz = -Math.cos(bot.heading);
                const rx = Math.cos(bot.heading);
                const rz = -Math.sin(bot.heading);
                for (const other of allStates) {
                  if (other.id === bot.id || other.finished) continue;
                  const dx = other.x - bot.x;
                  const dz = other.z - bot.z;
                  const distSq = dx * dx + dz * dz;
                  if (distSq > 64 && distSq < 3364) {
                    const dist = Math.sqrt(distSq);
                    const dotForward = (dx * fx + dz * fz) / dist;
                    const latOffset = Math.abs(dx * rx + dz * rz);
                    if (dotForward > 0.955 && latOffset < 2.2) {
                      fireBlasters(bot, false);
                      break;
                    }
                  }
                }
              }
            } else if (entry.state.isPlayer) {
              pointerFireQueued = false;
            }
          }

          // Update remote multiplayer cars & bots from WebSocket telemetry
          const incoming = remoteTelemetryRef.current;
          if (p.raceMode === 'multiplayer' && incoming.length > 0) {
            for (const pkt of incoming) {
              const entry = raceCars.find((c) => c.state.id === pkt.playerId);
              if (entry && entry.isRemote) {
                entry.state.x = THREE.MathUtils.damp(entry.state.x, pkt.x, 14, dt);
                entry.state.y = THREE.MathUtils.damp(entry.state.y, pkt.y, 14, dt);
                entry.state.z = THREE.MathUtils.damp(entry.state.z, pkt.z, 14, dt);
                // Shortest-angle heading lerp
                let diff = pkt.heading - entry.state.heading;
                while (diff > Math.PI) diff -= Math.PI * 2;
                while (diff < -Math.PI) diff += Math.PI * 2;
                entry.state.heading += diff * (1 - Math.exp(-14 * dt));
                entry.state.speedKmh = pkt.speedKmh;
                entry.state.steerAngle = pkt.steer;
                entry.state.lap = pkt.lap;
                entry.state.progress = pkt.progress;
                entry.state.totalProgress = pkt.totalProgress;
                entry.state.finished = pkt.finished;
                entry.state.finishTimeMs = pkt.finishTimeMs;
                entry.state.bestLapMs = pkt.bestLapMs;
                entry.state.nitroActive = pkt.nitroActive;
                entry.state.spiceTimer = pkt.spiceActive ? 0.5 : 0;
                entry.state.flatTireTimer = pkt.flatTire ? 0.5 : 0;
                entry.state.muzzleFlashTimer = Math.max(0, entry.state.muzzleFlashTimer - dt);
                entry.state.wheelSpin += ((pkt.speedKmh / 3.6) * dt) / 0.36;
              }
            }
          }

          // Process incoming multiplayer blaster shots & flat-tire hits
          if (p.raceMode === 'multiplayer' && combatEventsRef.current.length > 0) {
            const events = combatEventsRef.current.splice(0, combatEventsRef.current.length);
            for (const ev of events) {
              if (ev.type === 'race:fired') {
                const shooterEntry = raceCars.find((c) => c.state.id === ev.shooterId);
                if (shooterEntry && shooterEntry.state.id !== p.clientId) {
                  shooterEntry.state.muzzleFlashTimer = 0.08;
                  const fx = -Math.sin(ev.heading);
                  const fz = -Math.cos(ev.heading);
                  const rx = Math.cos(ev.heading);
                  const rz = -Math.sin(ev.heading);
                  spawnBolt(
                    ev.shooterId,
                    false,
                    ev.x + fx * 2.15 - rx * 0.52,
                    ev.y,
                    ev.z + fz * 2.15 - rz * 0.52,
                    ev.heading,
                    ev.speedMs,
                    true
                  );
                  spawnBolt(
                    ev.shooterId,
                    false,
                    ev.x + fx * 2.15 + rx * 0.52,
                    ev.y,
                    ev.z + fz * 2.15 + rz * 0.52,
                    ev.heading,
                    ev.speedMs,
                    true
                  );
                  if (playerEntry) {
                    const dSq =
                      (ev.x - playerEntry.state.x) ** 2 + (ev.z - playerEntry.state.z) ** 2;
                    if (dSq < 65 * 65) audioEngine.playLaserShot();
                  }
                }
              } else if (ev.type === 'race:hit_applied') {
                const targetEntry = raceCars.find((c) => c.state.id === ev.targetId);
                if (targetEntry && !targetEntry.isRemote) {
                  const t = targetEntry.state;
                  if (t.spiceTimer > 0) {
                    if (t.isPlayer) {
                      audioEngine.playShieldBlock();
                      lapBannerText = 'SHIELD BLOCKED SHOT';
                      lapBannerTimer = 1.4;
                    }
                  } else {
                    t.flatTireTimer = 2.0;
                    t.flatSide = Math.random() < 0.5 ? -1 : 1;
                    if (t.isPlayer) {
                      audioEngine.playFlatTire();
                      lapBannerText = `FLAT TIRE · HIT BY ${ev.shooterName.toUpperCase()}`;
                      lapBannerTimer = 1.9;
                    }
                  }
                }
              } else if (ev.type === 'race:worm_event') {
                if (ev.senderId !== p.clientId) {
                  if (ev.action === 'spawn') {
                    startWormCrossing(ev.sampleIndex, ev.direction);
                  } else if (ev.action === 'shot' && wormPhase === 'crossing') {
                    retreatWormAndDropSpice(ev.sampleIndex, false);
                  }
                }
              }
            }
          }

          // Update Sandworm Crossing & Worm-Dropped Spice Nitro on tracks with Sandworms
          if (activeTrack.meta.hasSandworm) {
            const sampleCount = activeTrack.samples.length;
            const isAuthority =
              p.raceMode === 'singleplayer' || p.multiplayerRoom?.hostId === p.clientId;

            // Tick per-car worm hit cooldowns
            for (const [cid, cd] of wormCarHitCooldowns.entries()) {
              if (cd <= dt) wormCarHitCooldowns.delete(cid);
              else wormCarHitCooldowns.set(cid, cd - dt);
            }

            if (wormPhase === 'idle') {
              wormGroup.visible = false;
              wormWarningRing.visible = false;
              if (isAuthority && (!playerEntry || !playerEntry.state.finished)) {
                wormTimer -= dt;
                if (wormTimer <= 0) {
                  const baseIdx = playerEntry ? playerEntry.state.sampleIndex : 0;
                  const spawnIdx = (baseIdx + 44 + Math.floor(Math.random() * 20)) % sampleCount;
                  const dir: -1 | 1 = Math.random() < 0.5 ? 1 : -1;
                  startWormCrossing(spawnIdx, dir);
                  if (p.raceMode === 'multiplayer') {
                    callbacksRef.current.sendWs({
                      type: 'race:worm_event',
                      action: 'spawn',
                      sampleIndex: spawnIdx,
                      direction: dir,
                    });
                  }
                }
              }
            } else if (wormPhase === 'warning') {
              const sample = activeTrack.samples[wormSampleIndex];
              wormWarningRing.visible = true;
              const pulse = 1 + 0.22 * Math.sin(elapsedTotal * 12);
              wormWarningRing.scale.setScalar(pulse);
              wormWarningRing.position.set(sample.pos.x, sample.pos.y + 0.12, sample.pos.z);
              wormTimer -= dt;
              if (wormTimer <= 0) {
                wormPhase = 'crossing';
                wormTimer = 2.15;
                wormWarningRing.visible = false;
                wormGroup.visible = true;
                audioEngine.playWormEmergeMetal();
              }
            } else if (wormPhase === 'crossing') {
              const sample = activeTrack.samples[wormSampleIndex];
              const progressT = Math.min(1, Math.max(0, 1 - wormTimer / 2.15));
              const headLat = THREE.MathUtils.lerp(-42, 42, progressT) * wormDirection;

              wormGroup.position.copy(sample.pos);
              wormGroup.rotation.y = sample.heading;
              wormGroup.visible = true;

              for (let i = 0; i < WORM_SEGMENT_COUNT; i++) {
                const seg = wormSegments[i];
                const segLat = headLat - i * 2.95 * wormDirection;
                const edgeSink = Math.max(0, Math.abs(segLat) - 18.5) * 0.34;
                const slitherY =
                  1.95 + Math.sin(i * 0.48 + elapsedTotal * 13.5) * 0.78 - edgeSink;
                seg.lat = segLat;
                seg.yOffset = slitherY;
                seg.group.position.set(segLat, slitherY, 0);
                seg.group.rotation.y = wormDirection > 0 ? 0 : Math.PI;
                seg.group.rotation.x = Math.sin(elapsedTotal * 7.5 + i * 0.42) * 0.16;
                seg.group.visible = slitherY > -4.2;
              }

              // Check collisions with non-remote racers
              for (const entry of raceCars) {
                const st = entry.state;
                if (entry.isRemote || st.finished) continue;
                if ((wormCarHitCooldowns.get(st.id) ?? 0) > 0) continue;
                if (Math.abs(st.y - sample.pos.y) > 6.5) continue;

                let hitWorm = false;
                for (let i = 0; i < WORM_SEGMENT_COUNT; i++) {
                  const seg = wormSegments[i];
                  if (!seg.group.visible || seg.yOffset < -1.1) continue;
                  const wx = sample.pos.x + sample.right.x * seg.lat;
                  const wz = sample.pos.z + sample.right.z * seg.lat;
                  const dx = st.x - wx;
                  const dz = st.z - wz;
                  if (dx * dx + dz * dz < 4.25 * 4.25) {
                    hitWorm = true;
                    break;
                  }
                }

                if (hitWorm) {
                  wormCarHitCooldowns.set(st.id, 1.8);
                  if (st.spiceTimer > 0) {
                    st.vx *= 0.85;
                    st.vz *= 0.85;
                    if (st.isPlayer) {
                      audioEngine.playShieldBlock();
                      lapBannerText = 'SPICE SHIELD DEFLECTED SANDWORM';
                      lapBannerTimer = 1.6;
                    }
                  } else {
                    st.vx *= 0.25;
                    st.vz *= 0.25;
                    st.x -= sample.tangent.x * 4.5;
                    st.z -= sample.tangent.z * 4.5;
                    st.roll = 0.28 * wormDirection;
                    if (st.isPlayer) {
                      audioEngine.playWormImpact();
                      lapBannerText = 'STRUCK BY SANDWORM!';
                      lapBannerTimer = 2.0;
                    }
                  }
                }
              }

              wormTimer -= dt;
              if (wormTimer <= 0) {
                wormPhase = 'idle';
                wormGroup.visible = false;
                wormTimer = 8.5 + Math.random() * 7;
              }
            } else if (wormPhase === 'retreating') {
              const sample = activeTrack.samples[wormSampleIndex];
              wormGroup.position.copy(sample.pos);
              wormGroup.rotation.y = sample.heading;
              wormRetreatProgress += dt * 1.9;
              const sink = wormRetreatProgress * 9.5;
              for (let i = 0; i < WORM_SEGMENT_COUNT; i++) {
                const seg = wormSegments[i];
                seg.group.position.y = seg.yOffset - sink;
              }
              wormTimer -= dt;
              if (wormTimer <= 0) {
                wormPhase = 'idle';
                wormGroup.visible = false;
                wormTimer = 9 + Math.random() * 7;
              }
            }

            // Animate & collect Worm-Dropped Spice Nitro deposits
            for (const drop of wormSpicePool) {
              if (!drop.active) continue;
              drop.life -= dt;
              if (drop.life <= 0) {
                drop.active = false;
                drop.group.visible = false;
                continue;
              }
              drop.mound.rotation.y += dt * 2.2;
              for (const entry of raceCars) {
                const st = entry.state;
                if (entry.isRemote || st.finished) continue;
                const dx = st.x - drop.x;
                const dz = st.z - drop.z;
                const dy = Math.abs(st.y - drop.y);
                if (dy < 3.5 && dx * dx + dz * dz < 2.75 * 2.75) {
                  drop.active = false;
                  drop.group.visible = false;
                  st.nitro = st.stats.nitroCapacity;
                  st.boostPadTimer = Math.max(st.boostPadTimer, 2.2);
                  st.nitroActive = true;
                  if (st.isPlayer) {
                    audioEngine.playSpicePickup();
                    lapBannerText = 'WORM SPICE · NITRO SURGE!';
                    lapBannerTimer = 1.8;
                  }
                  break;
                }
              }
            }
          }

          // Advance blaster bolts and evaluate hits
          for (const slot of projectilePool) {
            if (!slot.active) continue;
            slot.life -= dt;
            if (slot.life <= 0) {
              slot.active = false;
              slot.mesh.visible = false;
              continue;
            }
            slot.x += slot.vx * dt;
            slot.z += slot.vz * dt;
            const nearest = activeTrack.findNearestSample(slot.x, slot.z);
            slot.y = nearest.sample.pos.y + 0.65;
            slot.mesh.position.set(slot.x, slot.y, slot.z);

            if (!slot.visualOnly) {
              // Check blaster hits against active crossing Sandworm
              if (activeTrack.meta.hasSandworm && wormPhase === 'crossing') {
                const wSample = activeTrack.samples[wormSampleIndex];
                let wormHit = false;
                for (let i = 0; i < WORM_SEGMENT_COUNT; i++) {
                  const seg = wormSegments[i];
                  if (!seg.group.visible || seg.yOffset < -1.1) continue;
                  const wx = wSample.pos.x + wSample.right.x * seg.lat;
                  const wz = wSample.pos.z + wSample.right.z * seg.lat;
                  const dx = slot.x - wx;
                  const dz = slot.z - wz;
                  if (dx * dx + dz * dz < 4.8 * 4.8) {
                    wormHit = true;
                    break;
                  }
                }
                if (wormHit) {
                  slot.active = false;
                  slot.mesh.visible = false;
                  for (const otherSlot of projectilePool) {
                    if (otherSlot.active && otherSlot.ownerId === slot.ownerId) {
                      const odx = otherSlot.x - slot.x;
                      const odz = otherSlot.z - slot.z;
                      if (odx * odx + odz * odz < 4.2 * 4.2) {
                        otherSlot.active = false;
                        otherSlot.mesh.visible = false;
                      }
                    }
                  }
                  retreatWormAndDropSpice(wormSampleIndex, slot.ownerIsPlayer);
                  if (slot.ownerIsPlayer && playerEntry) {
                    playerEntry.state.hitsLanded += 1;
                    if (p.raceMode === 'multiplayer') {
                      callbacksRef.current.sendWs({
                        type: 'race:worm_event',
                        action: 'shot',
                        sampleIndex: wormSampleIndex,
                        direction: wormDirection,
                      });
                    }
                  }
                  continue;
                }
              }

              for (const targetEntry of raceCars) {
                const t = targetEntry.state;
                if (t.id === slot.ownerId || t.finished) continue;
                const dx = slot.x - t.x;
                const dz = slot.z - t.z;
                const dy = Math.abs(slot.y - (t.y + 0.65));
                if (dy < 2.2 && dx * dx + dz * dz < 2.1 * 2.1) {
                  slot.active = false;
                  slot.mesh.visible = false;
                  // Deactivate twin companion bolt from the same shot
                  for (const otherSlot of projectilePool) {
                    if (otherSlot.active && otherSlot.ownerId === slot.ownerId) {
                      const odx = otherSlot.x - slot.x;
                      const odz = otherSlot.z - slot.z;
                      if (odx * odx + odz * odz < 3.0 * 3.0) {
                        otherSlot.active = false;
                        otherSlot.mesh.visible = false;
                      }
                    }
                  }

                  if (t.spiceTimer > 0) {
                    if (slot.ownerIsPlayer || t.isPlayer) {
                      audioEngine.playShieldBlock();
                    }
                    if (slot.ownerIsPlayer) {
                      lapBannerText = `${t.name.toUpperCase()} SHIELDED`;
                      lapBannerTimer = 1.4;
                    } else if (t.isPlayer) {
                      lapBannerText = 'SHIELD BLOCKED SHOT';
                      lapBannerTimer = 1.4;
                    }
                  } else if (targetEntry.isRemote) {
                    if (slot.ownerIsPlayer && p.raceMode === 'multiplayer') {
                      callbacksRef.current.sendWs({ type: 'race:hit', targetId: t.id });
                      if (playerEntry) playerEntry.state.hitsLanded += 1;
                      t.flatTireTimer = 2.0;
                      audioEngine.playHitConfirm();
                      lapBannerText = `FLAT TIRE HIT · ${t.name.toUpperCase()}`;
                      lapBannerTimer = 1.8;
                    }
                  } else {
                    t.flatTireTimer = 2.0;
                    t.flatSide = Math.random() < 0.5 ? -1 : 1;
                    if (t.isPlayer) {
                      audioEngine.playFlatTire();
                      const attacker = raceCars.find((c) => c.state.id === slot.ownerId);
                      lapBannerText = attacker
                        ? `FLAT TIRE · HIT BY ${attacker.state.name.toUpperCase()}`
                        : 'FLAT TIRE · 2.0S';
                      lapBannerTimer = 1.9;
                    }
                    if (slot.ownerIsPlayer && playerEntry) {
                      playerEntry.state.hitsLanded += 1;
                      audioEngine.playHitConfirm();
                      lapBannerText = `FLAT TIRE HIT · ${t.name.toUpperCase()}`;
                      lapBannerTimer = 1.8;
                    }
                  }
                  break;
                }
              }
            }
          }

          const localSimStates = raceCars.filter((c) => !c.isRemote).map((c) => c.state);
          if (resolveCarCollisions(localSimStates)) {
            audioEngine.playBump();
          }

          // Emit WebSocket state at 25Hz during multiplayer
          if (p.raceMode === 'multiplayer' && playerEntry) {
            wsEmitTimer += dt;
            if (wsEmitTimer >= 0.04) {
              wsEmitTimer = 0;
              const isHost = p.multiplayerRoom?.hostId === p.clientId;
              const botPackets: RoomTelemetryPacket[] | undefined = isHost
                ? raceCars
                    .filter((c) => c.state.isBot)
                    .map((b) => ({
                      playerId: b.state.id,
                      name: b.state.name,
                      x: b.state.x,
                      y: b.state.y,
                      z: b.state.z,
                      heading: b.state.heading,
                      speedKmh: b.state.speedKmh,
                      steer: b.state.steerAngle,
                      lap: b.state.lap,
                      progress: b.state.progress,
                      totalProgress: b.state.totalProgress,
                      finished: b.state.finished,
                      finishTimeMs: b.state.finishTimeMs,
                      bestLapMs: b.state.bestLapMs,
                      nitroActive: b.state.nitroActive,
                      spiceActive: b.state.spiceTimer > 0,
                      flatTire: b.state.flatTireTimer > 0,
                      vehicle: b.state.vehicle,
                      isBot: true,
                    }))
                : undefined;

              callbacksRef.current.sendWs({
                type: 'race:input_state',
                x: playerEntry.state.x,
                y: playerEntry.state.y,
                z: playerEntry.state.z,
                heading: playerEntry.state.heading,
                speedKmh: playerEntry.state.speedKmh,
                steer: playerEntry.state.steerAngle,
                lap: playerEntry.state.lap,
                progress: playerEntry.state.progress,
                totalProgress: playerEntry.state.totalProgress,
                finished: playerEntry.state.finished,
                finishTimeMs: playerEntry.state.finishTimeMs,
                bestLapMs: playerEntry.state.bestLapMs,
                nitroActive: playerEntry.state.nitroActive,
                spiceActive: playerEntry.state.spiceTimer > 0,
                flatTire: playerEntry.state.flatTireTimer > 0,
                bots: botPackets,
              });
            }
          }
        }

        // Sync 3D car meshes, wheels, blasters & Spice Shield
        for (const entry of raceCars) {
          const st = entry.state;
          entry.rig.root.position.set(st.x, st.y, st.z);
          entry.rig.root.rotation.y = st.heading;
          entry.rig.bodyGroup.rotation.x = st.pitch;
          entry.rig.bodyGroup.rotation.z =
            st.roll + (st.flatTireTimer > 0 ? st.flatSide * 0.085 : 0);
          entry.rig.bodyGroup.position.y =
            st.flatTireTimer > 0 ? Math.sin(elapsedTotal * 38) * 0.045 : 0;
          entry.rig.nitroFlames.visible = st.nitroActive;
          entry.rig.muzzleFlashes.visible = st.muzzleFlashTimer > 0;
          entry.rig.taillightMat.emissiveIntensity = st.braking ? 3.5 : 1.4;
          entry.rig.shieldShell.visible = st.spiceTimer > 0;
          if (st.spiceTimer > 0) {
            entry.rig.shieldShell.rotation.y += dt * 1.6;
          }

          for (const fw of entry.rig.frontWheels) {
            fw.rotation.y = st.steerAngle;
          }
          for (const sw of entry.rig.allSpinWheels) {
            sw.rotation.x = -st.wheelSpin;
          }
        }

        // Camera & Audio update
        if (playerEntry) {
          const ps = playerEntry.state;
          _forwardVec.set(-Math.sin(ps.heading), 0, -Math.cos(ps.heading));

          const speedRatio = Math.min(1, ps.speedKmh / ps.stats.maxSpeedKmh);
          const gear = Math.min(6, Math.max(1, Math.ceil(speedRatio * 6)));
          const gearSpan = 1 / 6;
          const rpmRatio = Math.min(
            1,
            Math.max(0.18, ((speedRatio % gearSpan) / gearSpan) * 0.8 + 0.2)
          );

          audioEngine.updateDrive({
            active: raceStarted && !isPaused && !ps.finished,
            speedRatio,
            rpmRatio,
            nitroActive: ps.nitroActive,
            slipRatio: ps.slipRatio,
          });

          // Dynamic FOV widening with speed + nitro
          const targetFov =
            (p.cameraMode === 'hood' ? 68 : 58) +
            speedRatio * 12 +
            (ps.nitroActive ? 6 : 0);
          camera.fov = THREE.MathUtils.damp(camera.fov, targetFov, 7, dt);
          camera.updateProjectionMatrix();

          if (p.cameraMode === 'hood') {
            _camTargetPos
              .set(ps.x, ps.y + 1.38, ps.z)
              .addScaledVector(_forwardVec, 0.45);
            _camLookAt
              .set(ps.x, ps.y + 1.1, ps.z)
              .addScaledVector(_forwardVec, 24);
            camera.position.lerp(_camTargetPos, 1 - Math.exp(-26 * dt));
            _currentLookAt.lerp(_camLookAt, 1 - Math.exp(-26 * dt));
            camera.lookAt(_currentLookAt);
          } else {
            const dist = p.cameraMode === 'far' ? 12.5 : 8.6;
            const height = p.cameraMode === 'far' ? 4.8 : 3.35;
            _camTargetPos
              .set(ps.x, ps.y + height, ps.z)
              .addScaledVector(_forwardVec, -dist);
            _camLookAt
              .set(ps.x, ps.y + 1.15, ps.z)
              .addScaledVector(_forwardVec, 8);
            camera.position.lerp(_camTargetPos, 1 - Math.exp(-11 * dt));
            _currentLookAt.lerp(_camLookAt, 1 - Math.exp(-14 * dt));
            camera.lookAt(_currentLookAt);
          }

          // Follow shadow light with player car
          keyLight.position.set(ps.x + 45, ps.y + 75, ps.z + 35);
          keyLight.target.position.set(ps.x, ps.y, ps.z);

          // Emit HUD snapshot at ~25Hz
          hudEmitTimer += dt;
          if (hudEmitTimer >= 0.04) {
            hudEmitTimer = 0;

            const sorted = [...raceCars].sort((a, b) => {
              if (a.state.finished && b.state.finished) {
                return (a.state.finishTimeMs ?? 0) - (b.state.finishTimeMs ?? 0);
              }
              if (a.state.finished) return -1;
              if (b.state.finished) return 1;
              return b.state.totalProgress - a.state.totalProgress;
            });

            const standings = sorted.map((c, idx) => ({
              id: c.state.id,
              name: c.state.name,
              isPlayer: c.state.isPlayer,
              isBot: c.state.isBot,
              position: idx + 1,
              lap: c.state.lap,
              progress: c.state.progress,
              x: c.state.x,
              z: c.state.z,
              finished: c.state.finished,
              finishTimeMs: c.state.finishTimeMs,
              bestLapMs: c.state.bestLapMs,
              color: c.state.vehicle.primaryColor,
            }));

            const playerRank = standings.find((s) => s.id === ps.id)?.position ?? 1;

            const snapshot: HudSnapshot = {
              speedKmh: ps.speedKmh,
              gear,
              rpmRatio,
              nitroRatio: ps.nitro / ps.stats.nitroCapacity,
              nitroActive: ps.nitroActive,
              spiceTimerMs: Math.round(ps.spiceTimer * 1000),
              spiceHarvestCount: ps.spiceCount,
              fireCooldownRatio: Math.min(1, ps.fireCooldown / PLAYER_FIRE_COOLDOWN),
              flatTireTimerMs: Math.round(ps.flatTireTimer * 1000),
              hitsLanded: ps.hitsLanded,
              autoPilot: autoPilotActive,
              sandwormWarning: wormPhase === 'warning' || wormPhase === 'crossing',
              lap: ps.lap,
              totalLaps: p.totalLaps,
              position: playerRank,
              totalRacers: raceCars.length,
              elapsedMs: raceElapsedMs,
              currentLapMs: raceStarted ? Math.max(0, raceElapsedMs - ps.lapStartMs) : 0,
              bestLapMs: ps.bestLapMs,
              lastLapMs: ps.lastLapMs,
              countdown: raceStarted ? null : localCountdownPhase,
              finished: ps.finished,
              standings,
              lapBanner: lapBannerText,
            };

            callbacksRef.current.onHudUpdate(snapshot);

            if (ps.finished && !finishReported) {
              finishReported = true;
              callbacksRef.current.onRaceFinish({
                bestLapMs: ps.bestLapMs ?? ps.finishTimeMs ?? raceElapsedMs,
                totalRaceMs: ps.finishTimeMs ?? raceElapsedMs,
                position: playerRank,
                standings,
              });
            }
          }
        }
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    if (isSoftwareGl) {
      afterDraw(tick);
    } else {
      frameId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost);
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored);

      clearRaceCars();
      if (activeShowroomCar) {
        scene.remove(activeShowroomCar.root);
        activeShowroomCar.dispose();
      }
      if (activeTrack) {
        scene.remove(activeTrack.group);
        activeTrack.dispose();
      }
      studioFloorGeo.dispose();
      studioFloorMat.dispose();
      plinthGeo.dispose();
      plinthMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      sandGeo.dispose();
      sandMat.dispose();
      sandTexture.dispose();
      for (const slot of projectilePool) {
        scene.remove(slot.mesh);
      }
      boltGeo.dispose();
      boltMat.dispose();
      scene.remove(wormGroup);
      scene.remove(wormWarningRing);
      wormSegGeo.dispose();
      wormRidgeGeo.dispose();
      wormCollarGeo.dispose();
      wormDorsalGeo.dispose();
      wormScaleGeo.dispose();
      wormMawGeo.dispose();
      wormInnerMawGeo.dispose();
      wormFangGeo.dispose();
      wormGulletGeo.dispose();
      wormHideMat.dispose();
      wormRidgeMat.dispose();
      wormCollarMat.dispose();
      wormMawMat.dispose();
      wormFangMat.dispose();
      wormGulletMat.dispose();
      wormWarnRingGeo.dispose();
      wormWarnRingMat.dispose();
      for (const drop of wormSpicePool) {
        scene.remove(drop.group);
      }
      wormSpiceMoundGeo.dispose();
      wormSpiceHaloGeo.dispose();
      wormSpiceMoundMat.dispose();
      wormSpiceHaloMat.dispose();
      envTexture.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [audioEngine, remoteTelemetryRef, combatEventsRef, touchInputRef]);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0b0d11]">
      <div ref={mountRef} className="absolute inset-0 w-full h-full" />

      {/* Arrakis Sandstorm Visibility Overlay */}
      <div
        ref={sandstormLayerRef}
        aria-hidden="true"
        className="absolute inset-0 z-10 pointer-events-none overflow-hidden"
        style={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'radial-gradient(circle at 50% 45%, rgba(209, 137, 78, 0.16) 18%, rgba(168, 94, 38, 0.48) 68%, rgba(84, 41, 14, 0.78) 100%)',
          }}
        />
        <div
          className="sandstorm-haze-primary absolute -inset-x-[25%] -inset-y-[10%]"
          style={{
            background:
              'linear-gradient(108deg, rgba(217, 148, 84, 0) 10%, rgba(217, 148, 84, 0.24) 36%, rgba(180, 102, 42, 0.12) 60%, rgba(217, 148, 84, 0.28) 82%, rgba(217, 148, 84, 0) 96%)',
          }}
        />
        <div
          className="sandstorm-haze-secondary absolute -inset-x-[30%] -inset-y-[10%]"
          style={{
            background:
              'linear-gradient(102deg, rgba(245, 184, 118, 0) 5%, rgba(245, 184, 118, 0.16) 28%, rgba(164, 92, 38, 0.08) 54%, rgba(245, 184, 118, 0.18) 76%, rgba(245, 184, 118, 0) 94%)',
          }}
        />
      </div>

      {sandstormWarning && (
        <div
          role="status"
          aria-live="polite"
          className="absolute top-32 md:top-4 left-1/2 -translate-x-1/2 z-20 pointer-events-none flex items-center gap-2 px-3.5 py-1.5 rounded-xl bg-[#0e1118]/92 border border-amber-500/50 shadow-lg"
        >
          <Wind className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="whitespace-nowrap">
            <span className="text-xs font-semibold text-amber-400">Coriolis Sandstorm</span>
            <span className="hidden sm:inline text-xs text-zinc-300 ml-2">
              Reduced visibility · Low tire grip
            </span>
          </div>
        </div>
      )}

      {contextLost && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0b0d11] text-zinc-200 p-6 text-center">
          <p className="font-display text-2xl font-semibold mb-2">Graphics Context Suspended</p>
          <p className="text-sm text-zinc-400 max-w-md">
            The 3D viewport is recovering its WebGL context. Reload if the scene does not resume automatically.
          </p>
        </div>
      )}
    </div>
  );
};
