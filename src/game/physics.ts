import * as THREE from 'three';
import type { VehicleConfig, VehiclePhysicsStats } from '../shared/types.ts';
import { computeVehicleStats } from '../shared/vehicles.ts';
import type { BuiltTrack } from './trackBuilder.ts';

export interface RacerState {
  id: string;
  name: string;
  isPlayer: boolean;
  isBot: boolean;
  vehicle: VehicleConfig;
  stats: VehiclePhysicsStats;
  x: number;
  y: number;
  z: number;
  vx: number;
  vz: number;
  heading: number;
  speedKmh: number;
  steerAngle: number;
  pitch: number;
  roll: number;
  wheelSpin: number;
  nitro: number;
  nitroActive: boolean;
  boostPadTimer: number;
  spiceTimer: number;
  spiceCount: number;
  flatTireTimer: number;
  flatSide: number; // -1 left or 1 right
  fireCooldown: number;
  muzzleFlashTimer: number;
  hitsLanded: number;
  braking: boolean;
  sampleIndex: number;
  lap: number; // 1-indexed current lap
  progress: number; // 0..1 on current lap
  totalProgress: number; // (lap - 1) + progress
  sectorFlags: [boolean, boolean, boolean];
  lapStartMs: number;
  bestLapMs: number | null;
  lastLapMs: number | null;
  finished: boolean;
  finishTimeMs: number | null;
  aiLaneOffset: number;
  aiSkill: number;
  slipRatio: number;
}

export interface PlayerControlInput {
  throttle: number; // 0..1
  brake: number;    // 0..1
  steer: number;    // -1 (right) .. +1 (left)
  nitro: boolean;
  drift: boolean;
}

export function createRacerAtGrid(params: {
  id: string;
  name: string;
  isPlayer: boolean;
  isBot: boolean;
  gridSlot: number;
  vehicle: VehicleConfig;
  track: BuiltTrack;
  aiSkill?: number;
}): RacerState {
  const stats = computeVehicleStats(params.vehicle);
  const sampleCount = params.track.samples.length;
  // Place racers cleanly staggered behind the start/finish line
  const row = Math.floor(params.gridSlot / 2);
  const col = params.gridSlot % 2 === 0 ? -1 : 1;
  const startSampleIdx = (sampleCount - 4 - row * 5 + sampleCount) % sampleCount;
  const s = params.track.samples[startSampleIdx];
  const lateral = col * 3.6;

  return {
    id: params.id,
    name: params.name,
    isPlayer: params.isPlayer,
    isBot: params.isBot,
    vehicle: params.vehicle,
    stats,
    x: s.pos.x + s.right.x * lateral,
    y: s.pos.y,
    z: s.pos.z + s.right.z * lateral,
    vx: 0,
    vz: 0,
    heading: s.heading,
    speedKmh: 0,
    steerAngle: 0,
    pitch: 0,
    roll: 0,
    wheelSpin: 0,
    nitro: stats.nitroCapacity,
    nitroActive: false,
    boostPadTimer: 0,
    spiceTimer: 0,
    spiceCount: 0,
    flatTireTimer: 0,
    flatSide: 1,
    fireCooldown: 0,
    muzzleFlashTimer: 0,
    hitsLanded: 0,
    braking: false,
    sampleIndex: startSampleIdx,
    lap: 1,
    progress: startSampleIdx / sampleCount,
    totalProgress: -0.02 - params.gridSlot * 0.005,
    sectorFlags: [false, false, false],
    lapStartMs: 0,
    bestLapMs: null,
    lastLapMs: null,
    finished: false,
    finishTimeMs: null,
    aiLaneOffset: (col * 2.5),
    aiSkill: params.aiSkill ?? (0.9 + Math.random() * 0.1),
    slipRatio: 0,
  };
}

export function resetRacerToTrack(racer: RacerState, track: BuiltTrack): void {
  const s = track.samples[racer.sampleIndex];
  racer.x = s.pos.x;
  racer.y = s.pos.y;
  racer.z = s.pos.z;
  racer.vx = 0;
  racer.vz = 0;
  racer.speedKmh = 0;
  racer.heading = s.heading;
}

export function computeAiControl(racer: RacerState, track: BuiltTrack, allRacers: RacerState[]): PlayerControlInput {
  const count = track.samples.length;
  // Look ahead 9 samples (~28m)
  const lookAheadIdx = (racer.sampleIndex + 9) % count;
  const farAheadIdx = (racer.sampleIndex + 18) % count;
  const targetSample = track.samples[lookAheadIdx];
  const farSample = track.samples[farAheadIdx];

  // Dynamic overtaking lane shift if another car is directly ahead
  let desiredLane = racer.aiLaneOffset;
  for (const other of allRacers) {
    if (other.id === racer.id) continue;
    const dx = other.x - racer.x;
    const dz = other.z - racer.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 14) {
      const fx = -Math.sin(racer.heading);
      const fz = -Math.cos(racer.heading);
      const dotF = dx * fx + dz * fz;
      if (dotF > 1) {
        const rx = Math.cos(racer.heading);
        const rz = -Math.sin(racer.heading);
        const dotR = dx * rx + dz * rz;
        desiredLane = dotR > 0 ? -4.2 : 4.2;
        break;
      }
    }
  }

  const tx = targetSample.pos.x + targetSample.right.x * desiredLane;
  const tz = targetSample.pos.z + targetSample.right.z * desiredLane;

  const toTargetX = tx - racer.x;
  const toTargetZ = tz - racer.z;
  const desiredHeading = Math.atan2(-toTargetX, -toTargetZ);

  let angleDiff = desiredHeading - racer.heading;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const steer = THREE.MathUtils.clamp(angleDiff * 2.1, -1, 1);

  // Modulate speed for sharp corners ahead
  const upcomingCurve = Math.max(targetSample.curvature, farSample.curvature);
  const cornerBrake = upcomingCurve > 0.24 && racer.speedKmh > 155 ? 0.55 : 0;
  const throttle = cornerBrake > 0 ? 0.35 : racer.aiSkill;
  const useNitro = upcomingCurve < 0.08 && racer.nitro > 45 && racer.speedKmh > 110;

  return {
    throttle,
    brake: cornerBrake,
    steer,
    nitro: useNitro,
    drift: Math.abs(angleDiff) > 0.45 && racer.speedKmh > 125,
  };
}

export function applyAutoPilotAssist(
  racer: RacerState,
  input: PlayerControlInput,
  track: BuiltTrack
): PlayerControlInput {
  const count = track.samples.length;
  const lookAheadIdx = (racer.sampleIndex + 8) % count;
  const targetSample = track.samples[lookAheadIdx];
  const nearest = track.findNearestSample(racer.x, racer.z, racer.sampleIndex);
  const halfRoad = track.meta.roadWidth / 2;

  const toTargetX = targetSample.pos.x - racer.x;
  const toTargetZ = targetSample.pos.z - racer.z;
  const desiredHeading = Math.atan2(-toTargetX, -toTargetZ);

  let angleDiff = desiredHeading - racer.heading;
  while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
  while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;

  const lineAssistSteer = THREE.MathUtils.clamp(angleDiff * 2.15, -1, 1);
  let assistedSteer =
    Math.abs(input.steer) < 0.05
      ? lineAssistSteer
      : THREE.MathUtils.clamp(input.steer * 0.45 + lineAssistSteer * 0.55, -1, 1);

  // Guard against steering outside paved track limits
  const safeEdge = Math.max(2.0, halfRoad - 2.3);
  if (Math.abs(nearest.lateralOffset) > safeEdge) {
    // Positive lateralOffset means car is to the right of centerline; positive steer turns left (inward)
    const inwardSign = Math.sign(nearest.lateralOffset);
    if (assistedSteer * inwardSign < 0.25) {
      assistedSteer = THREE.MathUtils.clamp(
        lineAssistSteer * 0.7 + inwardSign * 0.45,
        -1,
        1
      );
    }
  }

  return {
    throttle: input.throttle,
    brake: input.brake,
    steer: assistedSteer,
    nitro: input.nitro,
    drift: input.drift,
  };
}

export function stepRacerPhysics(
  racer: RacerState,
  input: PlayerControlInput,
  track: BuiltTrack,
  dt: number,
  raceElapsedMs: number,
  totalLaps: number,
  onLapComplete?: (racer: RacerState, lapTimeMs: number, finished: boolean) => void,
  gripMultiplier = 1,
  autoPilot = false
): void {
  const clampedDt = Math.min(dt, 0.05);
  const clampedGrip = THREE.MathUtils.clamp(gripMultiplier, 0.55, 1.1);
  const stats = racer.stats;

  // Forward and right unit vectors
  const fx = -Math.sin(racer.heading);
  const fz = -Math.cos(racer.heading);
  const rx = Math.cos(racer.heading);
  const rz = -Math.sin(racer.heading);

  // Decompose current velocity into forward & lateral components (m/s)
  let forwardSpeed = racer.vx * fx + racer.vz * fz;
  let lateralSpeed = racer.vx * rx + racer.vz * rz;

  // Check boost pads, Spice Harvest & Flat Tire / Weapon timers
  if (racer.boostPadTimer > 0) {
    racer.boostPadTimer = Math.max(0, racer.boostPadTimer - clampedDt);
  }
  if (racer.spiceTimer > 0) {
    racer.spiceTimer = Math.max(0, racer.spiceTimer - clampedDt);
  }
  if (racer.fireCooldown > 0) {
    racer.fireCooldown = Math.max(0, racer.fireCooldown - clampedDt);
  }
  if (racer.muzzleFlashTimer > 0) {
    racer.muzzleFlashTimer = Math.max(0, racer.muzzleFlashTimer - clampedDt);
  }
  const spiceActive = racer.spiceTimer > 0;
  if (spiceActive) {
    racer.flatTireTimer = 0;
  } else if (racer.flatTireTimer > 0) {
    racer.flatTireTimer = Math.max(0, racer.flatTireTimer - clampedDt);
  }
  const hasFlatTire = racer.flatTireTimer > 0;

  for (const pad of track.boostPads) {
    const dx = racer.x - pad.pos.x;
    const dz = racer.z - pad.pos.z;
    if (dx * dx + dz * dz < pad.radius * pad.radius) {
      racer.boostPadTimer = 1.4;
      racer.nitro = Math.min(stats.nitroCapacity, racer.nitro + 18 * clampedDt);
    }
  }

  // Nitro consumption & recharge
  const canNitro = input.nitro && racer.nitro > 4 && input.throttle > 0.2;
  racer.nitroActive = canNitro || racer.boostPadTimer > 0 || spiceActive;
  if (canNitro) {
    racer.nitro = Math.max(0, racer.nitro - 24 * clampedDt);
  } else {
    racer.nitro = Math.min(stats.nitroCapacity, racer.nitro + 6.5 * clampedDt);
  }

  // Nearest track point & surface check
  const nearest = track.findNearestSample(racer.x, racer.z, racer.sampleIndex);
  const halfRoad = track.meta.roadWidth / 2;
  const absLat = Math.abs(nearest.lateralOffset);
  const onGravel = absLat > halfRoad + 0.6;

  // Top speed in m/s (1 m/s = 3.6 km/h; scale world units feel snappy: 1 unit = 1m, 75 m/s = 270 km/h)
  const spiceBoost = spiceActive ? Math.max(stats.nitroBoost * 1.08, 1.32) : 1.0;
  const boostMultiplier = Math.max(racer.nitroActive ? stats.nitroBoost : 1.0, spiceBoost);
  const surfaceMultiplier = onGravel && !spiceActive ? 0.68 : 1.0;
  const flatSpeedFactor = hasFlatTire ? 0.64 : 1.0;
  const maxSpeedMs =
    (stats.maxSpeedKmh / 3.6) *
    boostMultiplier *
    surfaceMultiplier *
    flatSpeedFactor *
    (racer.isBot ? racer.aiSkill : 1);

  // Longitudinal forces
  racer.braking = input.brake > 0.1 && forwardSpeed > 1;
  if (input.throttle > 0.05 || spiceActive) {
    const throttleDrive = spiceActive ? Math.max(0.85, input.throttle) : input.throttle;
    const accelMultiplier =
      (spiceActive ? 1.65 : racer.nitroActive ? 1.48 : 1.0) * (hasFlatTire ? 0.68 : 1.0);
    // Slightly tapering acceleration as approaching top speed
    const speedRatio = Math.min(1, Math.max(0, forwardSpeed / maxSpeedMs));
    const thrust = stats.accelForce * accelMultiplier * throttleDrive * (1.15 - speedRatio * 0.65);
    forwardSpeed += thrust * clampedDt;
  }

  if (input.brake > 0.05) {
    if (forwardSpeed > 1.5) {
      forwardSpeed -= 52 * input.brake * clampedDt;
    } else {
      forwardSpeed -= 20 * input.brake * clampedDt;
    }
  }

  // Aerodynamic drag & rolling resistance
  const dragCoeff = (onGravel && !spiceActive ? 1.8 : 0.34) + (hasFlatTire ? 0.95 : 0);
  forwardSpeed -= forwardSpeed * dragCoeff * clampedDt;
  forwardSpeed = THREE.MathUtils.clamp(forwardSpeed, -18, maxSpeedMs);

  // Steering & Drift Dynamics (Spice shield stabilizes grip; Flat tire pulls & slips)
  const effectiveGrip = spiceActive
    ? Math.max(1.04, clampedGrip)
    : hasFlatTire
      ? clampedGrip * 0.62
      : clampedGrip;
  const targetSteerAngle = input.steer * 0.42;
  racer.steerAngle = THREE.MathUtils.damp(racer.steerAngle, targetSteerAngle, 14, clampedDt);

  const absSpeed = Math.abs(forwardSpeed);
  const steerAuthority = Math.min(1, absSpeed / 10) * (1 - Math.min(0.45, absSpeed / 120));
  const driftTurnBoost = input.drift ? 1.25 : 1.0;
  const reverseSign = forwardSpeed >= -0.5 ? 1 : -1;
  const flatPull = hasFlatTire ? racer.flatSide * 0.24 * Math.min(1, absSpeed / 16) : 0;
  const yawRate =
    (input.steer * 2.55 * steerAuthority * driftTurnBoost * stats.cornerGrip * (0.85 + 0.15 * effectiveGrip) +
      flatPull) *
    reverseSign;
  racer.heading += yawRate * clampedDt;

  // Lateral tire grip cancels slip velocity
  const gripDamping = (input.drift ? 3.2 : 7.8 * stats.driftControl) * effectiveGrip;
  lateralSpeed = THREE.MathUtils.damp(lateralSpeed, 0, gripDamping, clampedDt);
  racer.slipRatio = Math.min(1, Math.abs(lateralSpeed) / Math.max(8, absSpeed));

  // Reconstruct world velocity using updated heading
  const nfx = -Math.sin(racer.heading);
  const nfz = -Math.cos(racer.heading);
  const nrx = Math.cos(racer.heading);
  const nrz = -Math.sin(racer.heading);

  racer.vx = nfx * forwardSpeed + nrx * lateralSpeed;
  racer.vz = nfz * forwardSpeed + nrz * lateralSpeed;

  racer.x += racer.vx * clampedDt;
  racer.z += racer.vz * clampedDt;

  // Barrier / Auto-Pilot Track Limit Containment
  const updatedNearest = track.findNearestSample(racer.x, racer.z, nearest.sample.index);
  const barrierLimit = autoPilot ? Math.max(2.2, halfRoad - 0.85) : halfRoad + 3.2;
  if (Math.abs(updatedNearest.lateralOffset) > barrierLimit) {
    const sign = Math.sign(updatedNearest.lateralOffset);
    const excess = Math.abs(updatedNearest.lateralOffset) - barrierLimit;
    racer.x -= updatedNearest.sample.right.x * sign * excess;
    racer.z -= updatedNearest.sample.right.z * sign * excess;
    // Scrub outward velocity along normal
    const vDotR = racer.vx * updatedNearest.sample.right.x + racer.vz * updatedNearest.sample.right.z;
    if (vDotR * sign > 0) {
      const bounceFactor = autoPilot || spiceActive ? 1.0 : 1.2;
      racer.vx -= updatedNearest.sample.right.x * vDotR * bounceFactor;
      racer.vz -= updatedNearest.sample.right.z * vDotR * bounceFactor;
    }
    if (autoPilot) {
      let headingDiff = updatedNearest.sample.heading - racer.heading;
      while (headingDiff > Math.PI) headingDiff -= Math.PI * 2;
      while (headingDiff < -Math.PI) headingDiff += Math.PI * 2;
      racer.heading += headingDiff * (1 - Math.exp(-12 * clampedDt));
    }
    const wallRetention = autoPilot ? 0.99 : spiceActive ? 0.98 : 0.92;
    racer.vx *= wallRetention;
    racer.vz *= wallRetention;
  }

  // Smooth ground height & visual suspension pitch/roll
  racer.y = THREE.MathUtils.damp(racer.y, updatedNearest.sample.pos.y, 18, clampedDt);
  const targetRoll = -input.steer * Math.min(1, absSpeed / 35) * 0.065;
  const targetPitch = (input.throttle * 0.03 - input.brake * 0.045) * (racer.nitroActive ? 1.4 : 1);
  racer.roll = THREE.MathUtils.damp(racer.roll, targetRoll, 10, clampedDt);
  racer.pitch = THREE.MathUtils.damp(racer.pitch, targetPitch, 10, clampedDt);

  racer.speedKmh = Math.round(Math.abs(forwardSpeed) * 3.6);
  racer.wheelSpin += (forwardSpeed * clampedDt) / 0.36;

  // Lap & Sector Checkpoints
  const prevProgress = racer.progress;
  const newProgress = updatedNearest.sample.progress;
  racer.sampleIndex = updatedNearest.sample.index;
  racer.progress = newProgress;

  if (newProgress > 0.18 && newProgress < 0.35) racer.sectorFlags[0] = true;
  if (newProgress > 0.45 && newProgress < 0.62) racer.sectorFlags[1] = true;
  if (newProgress > 0.72 && newProgress < 0.9) racer.sectorFlags[2] = true;

  // Crossing finish line forward
  if (!racer.finished && prevProgress > 0.85 && newProgress < 0.15) {
    if (racer.sectorFlags[0] && racer.sectorFlags[1] && racer.sectorFlags[2]) {
      const lapTimeMs = raceElapsedMs - racer.lapStartMs;
      racer.lastLapMs = lapTimeMs;
      if (racer.bestLapMs === null || lapTimeMs < racer.bestLapMs) {
        racer.bestLapMs = lapTimeMs;
      }
      racer.lapStartMs = raceElapsedMs;
      racer.sectorFlags = [false, false, false];

      if (racer.lap >= totalLaps) {
        racer.finished = true;
        racer.finishTimeMs = raceElapsedMs;
        onLapComplete?.(racer, lapTimeMs, true);
      } else {
        racer.lap += 1;
        onLapComplete?.(racer, lapTimeMs, false);
      }
    }
  }

  racer.totalProgress = racer.finished
    ? totalLaps + 1 - (racer.finishTimeMs ?? raceElapsedMs) * 0.000001
    : (racer.lap - 1) + racer.progress;
}

export function resolveCarCollisions(racers: RacerState[]): boolean {
  let collided = false;
  const minDist = 2.6;
  const minDistSq = minDist * minDist;

  for (let i = 0; i < racers.length; i++) {
    for (let j = i + 1; j < racers.length; j++) {
      const a = racers[i];
      const b = racers[j];
      if (Math.abs(a.y - b.y) > 2.5) continue;

      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > 0.0001 && d2 < minDistSq) {
        const dist = Math.sqrt(d2);
        const nx = dx / dist;
        const nz = dz / dist;
        const overlap = (minDist - dist) * 0.5;

        a.x -= nx * overlap;
        a.z -= nz * overlap;
        b.x += nx * overlap;
        b.z += nz * overlap;

        const relVx = b.vx - a.vx;
        const relVz = b.vz - a.vz;
        const sepVel = relVx * nx + relVz * nz;
        if (sepVel < 0) {
          const aShield = a.spiceTimer > 0;
          const bShield = b.spiceTimer > 0;
          const impulse = -sepVel * 0.55;
          if (aShield && !bShield) {
            b.vx += nx * impulse * 1.75;
            b.vz += nz * impulse * 1.75;
          } else if (bShield && !aShield) {
            a.vx -= nx * impulse * 1.75;
            a.vz -= nz * impulse * 1.75;
          } else if (aShield && bShield) {
            a.vx -= nx * impulse * 0.45;
            a.vz -= nz * impulse * 0.45;
            b.vx += nx * impulse * 0.45;
            b.vz += nz * impulse * 0.45;
          } else {
            a.vx -= nx * impulse;
            a.vz -= nz * impulse;
            b.vx += nx * impulse;
            b.vz += nz * impulse;
          }
          if (Math.abs(sepVel) > 6) collided = true;
        }
      }
    }
  }
  return collided;
}
