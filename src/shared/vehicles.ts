import type {
  ChassisId,
  LiveryPattern,
  PaintFinish,
  RimStyle,
  SpoilerStyle,
  UnderglowColor,
  VehicleConfig,
  VehiclePhysicsStats,
} from './types.ts';

export interface ChassisSpec {
  id: ChassisId;
  name: string;
  category: string;
  tagline: string;
  baseSpeed: number;
  baseAccel: number;
  baseGrip: number;
  baseNitro: number;
}

export const CHASSIS_CATALOG: ChassisSpec[] = [
  {
    id: 'escort',
    name: 'Ford Escort RS',
    category: 'Classic Rally Coupe',
    tagline: 'Iconic white rally coupe with 1 crimson center stripe, twin round lamps, and desert-tuned suspension.',
    baseSpeed: 270,
    baseAccel: 45,
    baseGrip: 1.08,
    baseNitro: 105,
  },
  {
    id: 'valkyrie',
    name: 'Atreides Hawk GT',
    category: 'Ducal Interceptor',
    tagline: 'Balanced mid-engine coupe commissioned for House Atreides squadron trials.',
    baseSpeed: 268,
    baseAccel: 42,
    baseGrip: 1.04,
    baseNitro: 100,
  },
  {
    id: 'stratos',
    name: 'Ornithopter Aero',
    category: 'Winged Prototype',
    tagline: 'Ground-effect desert prototype with extreme downforce across spice straights.',
    baseSpeed: 282,
    baseAccel: 40,
    baseGrip: 1.12,
    baseNitro: 95,
  },
  {
    id: 'kurogane',
    name: 'Fremen Sandrunner',
    category: 'Sietch Outrider',
    tagline: 'Twin-turbine widebody runner tuned for loose-sand slip angles and canyon torque.',
    baseSpeed: 262,
    baseAccel: 46,
    baseGrip: 0.98,
    baseNitro: 115,
  },
  {
    id: 'vortex',
    name: 'Guild Navigator F-1',
    category: 'Foldspace Open-Wheel',
    tagline: 'Featherweight plasteel monocoque engineered for prescient apex turn-in.',
    baseSpeed: 274,
    baseAccel: 45,
    baseGrip: 1.18,
    baseNitro: 90,
  },
];

export const PAINT_PALETTE: { name: string; hex: string }[] = [
  { name: 'Escort White', hex: '#f4f4f5' },
  { name: 'Atreides Emerald', hex: '#14532d' },
  { name: 'Ducal Gold', hex: '#d97706' },
  { name: 'Arrakis Sand', hex: '#c2854c' },
  { name: 'Ibad Spice Blue', hex: '#0284c7' },
  { name: 'Imperial Crimson', hex: '#b91c1c' },
  { name: 'Stillsuit Slate', hex: '#475569' },
  { name: 'Harkonnen Obsidian', hex: '#18181b' },
];

export const ACCENT_PALETTE: { name: string; hex: string }[] = [
  { name: 'Rally Red', hex: '#dc2626' },
  { name: 'Spice Amber', hex: '#f59e0b' },
  { name: 'Eyes of Ibad', hex: '#38bdf8' },
  { name: 'Caladan Ivory', hex: '#ffffff' },
  { name: 'Desert Bronze', hex: '#b45309' },
  { name: 'Basalt Black', hex: '#18181b' },
];

export const RIM_COLORS: { name: string; hex: string }[] = [
  { name: 'Ducal Gold', hex: '#d4af37' },
  { name: 'Plasteel Alloy', hex: '#cbd5e1' },
  { name: 'Stillsuit Graphite', hex: '#27272a' },
  { name: 'Spice Bronze', hex: '#b47848' },
];

export const UNDERGLOW_OPTIONS: { id: UnderglowColor; label: string; hex: string }[] = [
  { id: 'none', label: 'Off', hex: '#3f3f46' },
  { id: 'amber', label: 'Spice Amber', hex: '#f59e0b' },
  { id: 'cyan', label: 'Ibad Blue', hex: '#06b6d4' },
  { id: 'crimson', label: 'Harkonnen Red', hex: '#ef4444' },
  { id: 'emerald', label: 'Caladan Green', hex: '#10b981' },
];

export const FINISH_OPTIONS: { id: PaintFinish; label: string }[] = [
  { id: 'gloss', label: 'Metallic Gloss' },
  { id: 'pearl', label: 'Clearcoat Pearl' },
  { id: 'matte', label: 'Stillsuit Matte' },
];

export const LIVERY_OPTIONS: { id: LiveryPattern; label: string }[] = [
  { id: 'clean', label: 'Clean Paint' },
  { id: 'single_stripe', label: '1 Center Stripe' },
  { id: 'stripe', label: 'Twin Rally Stripes' },
  { id: 'sweep', label: 'Sandworm Sweep' },
  { id: 'chevron', label: 'Fremen Chevron' },
];

export const SPOILER_OPTIONS: { id: SpoilerStyle; label: string }[] = [
  { id: 'lip', label: 'Ducktail Lip' },
  { id: 'gt', label: 'Hawk Swan-Neck' },
  { id: 'twin', label: 'Twin Aero Wing' },
];

export const RIM_STYLE_OPTIONS: { id: RimStyle; label: string }[] = [
  { id: 'forged', label: '5-Spoke Forged' },
  { id: 'mesh', label: 'Multi-Spoke Mesh' },
  { id: 'turbofan', label: 'Desert Turbofan' },
];

export const MAX_TUNING_POINTS = 14;

export const DEFAULT_VEHICLE_CONFIG: VehicleConfig = {
  chassis: 'escort',
  primaryColor: '#f4f4f5',
  accentColor: '#dc2626',
  finish: 'gloss',
  livery: 'single_stripe',
  spoiler: 'lip',
  rimStyle: 'mesh',
  rimColor: '#cbd5e1',
  underglow: 'none',
  tuning: {
    engine: 4,
    aero: 3,
    tires: 4,
    nitro: 3,
  },
};

export function computeVehicleStats(config: VehicleConfig): VehiclePhysicsStats {
  const spec = CHASSIS_CATALOG.find((c) => c.id === config.chassis) ?? CHASSIS_CATALOG[0];
  const { engine, aero, tires, nitro } = config.tuning;

  const spoilerAeroBonus = config.spoiler === 'twin' ? 0.06 : config.spoiler === 'gt' ? 0.03 : 0;
  const spoilerDragPenalty = config.spoiler === 'twin' ? 4 : config.spoiler === 'gt' ? 2 : 0;

  const maxSpeedKmh = Math.round(spec.baseSpeed + engine * 7.5 - spoilerDragPenalty);
  const accelForce = spec.baseAccel + engine * 2.8 + tires * 1.4;
  const cornerGrip = spec.baseGrip + aero * 0.055 + tires * 0.045 + spoilerAeroBonus;
  const driftControl = 0.85 + tires * 0.05;
  const nitroCapacity = spec.baseNitro + nitro * 16;
  const nitroBoost = 1.24 + nitro * 0.035;
  const zeroToHundredSec = Number(Math.max(2.1, 3.6 - (accelForce - 40) * 0.055).toFixed(2));

  return {
    maxSpeedKmh,
    accelForce,
    cornerGrip,
    driftControl,
    nitroCapacity,
    nitroBoost,
    zeroToHundredSec,
    rating: {
      speed: Math.min(100, Math.round(((maxSpeedKmh - 250) / 70) * 100)),
      handling: Math.min(100, Math.round(((cornerGrip - 0.9) / 0.7) * 100)),
      acceleration: Math.min(100, Math.round(((accelForce - 38) / 26) * 100)),
      boost: Math.min(100, Math.round(((nitroCapacity - 85) / 115) * 100)),
    },
  };
}

export function formatVehicleSummary(config: VehicleConfig): string {
  const spec = CHASSIS_CATALOG.find((c) => c.id === config.chassis) ?? CHASSIS_CATALOG[0];
  const paint = PAINT_PALETTE.find((p) => p.hex.toLowerCase() === config.primaryColor.toLowerCase())?.name ?? 'Custom';
  return `${spec.name} · ${paint}`;
}

export function createAiVehicleConfig(index: number): VehicleConfig {
  const presets: VehicleConfig[] = [
    {
      chassis: 'stratos',
      primaryColor: '#0284c7',
      accentColor: '#ffffff',
      finish: 'pearl',
      livery: 'sweep',
      spoiler: 'twin',
      rimStyle: 'turbofan',
      rimColor: '#cbd5e1',
      underglow: 'cyan',
      tuning: { engine: 4, aero: 4, tires: 3, nitro: 3 },
    },
    {
      chassis: 'kurogane',
      primaryColor: '#c2854c',
      accentColor: '#18181b',
      finish: 'matte',
      livery: 'chevron',
      spoiler: 'gt',
      rimStyle: 'mesh',
      rimColor: '#27272a',
      underglow: 'amber',
      tuning: { engine: 3, aero: 3, tires: 4, nitro: 4 },
    },
    {
      chassis: 'vortex',
      primaryColor: '#18181b',
      accentColor: '#ef4444',
      finish: 'gloss',
      livery: 'stripe',
      spoiler: 'twin',
      rimStyle: 'forged',
      rimColor: '#b47848',
      underglow: 'crimson',
      tuning: { engine: 3, aero: 5, tires: 4, nitro: 2 },
    },
  ];
  return presets[index % presets.length];
}
