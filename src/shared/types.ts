export type TrackId = 'alpine' | 'desert' | 'coastal' | 'neon' | 'play_is_vital';
export type ChassisId = 'escort' | 'valkyrie' | 'stratos' | 'kurogane' | 'vortex';
export type PaintFinish = 'gloss' | 'matte' | 'pearl';
export type LiveryPattern = 'clean' | 'single_stripe' | 'stripe' | 'sweep' | 'chevron';
export type SpoilerStyle = 'lip' | 'gt' | 'twin';
export type RimStyle = 'forged' | 'mesh' | 'turbofan';
export type UnderglowColor = 'none' | 'amber' | 'cyan' | 'crimson' | 'emerald';

export interface VehicleTuning {
  engine: number; // 1..5
  aero: number;   // 1..5
  tires: number;  // 1..5
  nitro: number;  // 1..5
}

export interface VehicleConfig {
  chassis: ChassisId;
  primaryColor: string;
  accentColor: string;
  finish: PaintFinish;
  livery: LiveryPattern;
  spoiler: SpoilerStyle;
  rimStyle: RimStyle;
  rimColor: string;
  underglow: UnderglowColor;
  tuning: VehicleTuning;
}

export interface VehiclePhysicsStats {
  maxSpeedKmh: number;
  accelForce: number;
  cornerGrip: number;
  driftControl: number;
  nitroCapacity: number;
  nitroBoost: number;
  zeroToHundredSec: number;
  rating: {
    speed: number;
    handling: number;
    acceleration: number;
    boost: number;
  };
}

export interface TrackPoint {
  x: number;
  y: number;
  z: number;
}

export interface TrackSignMeta {
  progress: number;
  side: -1 | 1;
  quote: string;
}

export interface TrackRoadDecalMeta {
  progress: number;
  text: string;
}

export interface CustomSignImageConfig {
  dataUrl: string;
  label?: string;
}

/** 3 independent JPG sign slots per track: undefined = default JPG, null = cleared, object = custom uploaded JPG */
export type CustomSignSlots = [
  CustomSignImageConfig | null | undefined,
  CustomSignImageConfig | null | undefined,
  CustomSignImageConfig | null | undefined,
];

export type CustomSignImagesMap = Partial<Record<TrackId, CustomSignSlots>>;

export interface TrackMeta {
  id: TrackId;
  name: string;
  location: string;
  surface: string;
  difficulty: 'Accessible' | 'Technical' | 'Pro Circuit';
  lengthMeters: number;
  defaultLaps: number;
  description: string;
  roadWidth: number;
  skyColor: string;
  fogColor: string;
  fogDensity: number;
  groundColor: string;
  curbColorA: string;
  curbColorB: string;
  ambientSky: string;
  ambientGround: string;
  sunColor: string;
  sunIntensity: number;
  isNight: boolean;
  hasWater?: boolean;
  hasDunes?: boolean;
  hasSandworm?: boolean;
  roadSigns?: TrackSignMeta[];
  roadDecals?: TrackRoadDecalMeta[];
  controlPoints: TrackPoint[];
  boostProgressPoints: number[]; // Normalized 0..1 positions along track
}

export type RaceMode = 'singleplayer' | 'multiplayer';

export interface LeaderboardEntry {
  id: string;
  trackId: TrackId;
  driverName: string;
  chassis: ChassisId;
  vehicleSummary: string;
  bestLapMs: number;
  totalRaceMs: number;
  laps: number;
  mode: RaceMode;
  createdAt: string;
}

export interface RoomPlayerInfo {
  id: string;
  name: string;
  ready: boolean;
  isHost: boolean;
  gridSlot: number;
  vehicle: VehicleConfig;
}

export interface RoomTelemetryPacket {
  playerId: string;
  name: string;
  x: number;
  y: number;
  z: number;
  heading: number;
  speedKmh: number;
  steer: number;
  lap: number;
  progress: number;
  totalProgress: number;
  finished: boolean;
  finishTimeMs: number | null;
  bestLapMs: number | null;
  nitroActive: boolean;
  spiceActive?: boolean;
  flatTire?: boolean;
  vehicle: VehicleConfig;
  isBot?: boolean;
}

export interface MultiplayerRoomSummary {
  id: string;
  name: string;
  trackId: TrackId;
  laps: number;
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  playerCount: number;
  maxPlayers: number;
  fillBots: boolean;
  autoPilot: boolean;
}

export interface MultiplayerRoomState extends MultiplayerRoomSummary {
  hostId: string;
  players: RoomPlayerInfo[];
  countdownValue: number | null;
  raceStartEpochMs: number | null;
}

export type ClientWsMessage =
  | { type: 'rooms:subscribe' }
  | {
      type: 'room:create';
      roomName: string;
      trackId: TrackId;
      laps: number;
      fillBots: boolean;
      autoPilot: boolean;
      driverName: string;
      vehicle: VehicleConfig;
    }
  | {
      type: 'room:join';
      roomId: string;
      driverName: string;
      vehicle: VehicleConfig;
    }
  | { type: 'room:leave' }
  | { type: 'room:ready'; ready: boolean }
  | { type: 'room:update_player'; driverName: string; vehicle: VehicleConfig }
  | {
      type: 'room:update_settings';
      trackId: TrackId;
      laps: number;
      fillBots: boolean;
      autoPilot: boolean;
    }
  | { type: 'room:start' }
  | {
      type: 'race:input_state';
      x: number;
      y: number;
      z: number;
      heading: number;
      speedKmh: number;
      steer: number;
      lap: number;
      progress: number;
      totalProgress: number;
      finished: boolean;
      finishTimeMs: number | null;
      bestLapMs: number | null;
      nitroActive: boolean;
      spiceActive?: boolean;
      flatTire?: boolean;
      bots?: RoomTelemetryPacket[];
    }
  | { type: 'race:fire'; x: number; y: number; z: number; heading: number; speedMs: number }
  | { type: 'race:hit'; targetId: string }
  | {
      type: 'race:worm_event';
      action: 'spawn' | 'shot';
      sampleIndex: number;
      direction: -1 | 1;
    }
  | {
      type: 'leaderboard:submit';
      trackId: TrackId;
      driverName: string;
      chassis: ChassisId;
      vehicleSummary: string;
      bestLapMs: number;
      totalRaceMs: number;
      laps: number;
      mode: RaceMode;
    };

export type ServerWsMessage =
  | { type: 'connected'; clientId: string }
  | { type: 'rooms:list'; rooms: MultiplayerRoomSummary[] }
  | { type: 'room:state'; room: MultiplayerRoomState | null }
  | { type: 'room:error'; message: string }
  | { type: 'race:countdown'; value: number }
  | { type: 'race:started'; startEpochMs: number }
  | { type: 'race:telemetry'; players: RoomTelemetryPacket[] }
  | {
      type: 'race:fired';
      shooterId: string;
      x: number;
      y: number;
      z: number;
      heading: number;
      speedMs: number;
    }
  | { type: 'race:hit_applied'; shooterId: string; shooterName: string; targetId: string }
  | {
      type: 'race:worm_event';
      senderId: string;
      action: 'spawn' | 'shot';
      sampleIndex: number;
      direction: -1 | 1;
    }
  | { type: 'leaderboards:sync'; entries: LeaderboardEntry[] }
  | { type: 'leaderboard:new_record'; entry: LeaderboardEntry; isTrackRecord: boolean };
