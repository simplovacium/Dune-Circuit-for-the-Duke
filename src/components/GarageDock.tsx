import React, { useState } from 'react';
import { ChevronDown, ChevronUp, RotateCcw } from 'lucide-react';
import type { VehicleConfig, VehicleTuning } from '../shared/types.ts';
import {
  ACCENT_PALETTE,
  CHASSIS_CATALOG,
  computeVehicleStats,
  DEFAULT_VEHICLE_CONFIG,
  FINISH_OPTIONS,
  LIVERY_OPTIONS,
  MAX_TUNING_POINTS,
  PAINT_PALETTE,
  RIM_COLORS,
  RIM_STYLE_OPTIONS,
  SPOILER_OPTIONS,
  UNDERGLOW_OPTIONS,
} from '../shared/vehicles.ts';

type GarageSubTab = 'chassis' | 'paint' | 'aero' | 'tuning';

interface GarageDockProps {
  vehicle: VehicleConfig;
  onChange: (next: VehicleConfig) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export const GarageDock: React.FC<GarageDockProps> = ({
  vehicle,
  onChange,
  collapsed,
  onToggleCollapse,
}) => {
  const [subTab, setSubTab] = useState<GarageSubTab>('chassis');
  const stats = computeVehicleStats(vehicle);
  const usedPoints =
    vehicle.tuning.engine + vehicle.tuning.aero + vehicle.tuning.tires + vehicle.tuning.nitro;
  const remainingPoints = MAX_TUNING_POINTS - usedPoints;

  const updateTuning = (key: keyof VehicleTuning, delta: number) => {
    const current = vehicle.tuning[key];
    const nextVal = current + delta;
    if (nextVal < 1 || nextVal > 5) return;
    if (delta > 0 && remainingPoints <= 0) return;
    onChange({
      ...vehicle,
      tuning: {
        ...vehicle.tuning,
        [key]: nextVal,
      },
    });
  };

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(940px,94vw)] pointer-events-auto">
      <div className="flex justify-center mb-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-zinc-200 bg-[#12161f]/95 border border-white/12 rounded-lg hover:bg-[#1a202c] transition-colors whitespace-nowrap cursor-pointer"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? 'Show Garage Controls (H)' : 'Hide Controls (H)'}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="bg-[#0e1118]/94 border border-white/12 rounded-xl p-4 shadow-2xl">
          {/* Header Row: Sub-tabs + Live Specs */}
          <div className="flex flex-wrap items-center justify-between gap-4 pb-3 mb-3 border-b border-white/10">
            <div className="flex items-center gap-1 p-1 bg-[#161b26] rounded-lg">
              {(
                [
                  { id: 'chassis', label: 'Chassis' },
                  { id: 'paint', label: 'Paint & Livery' },
                  { id: 'aero', label: 'Aero & Wheels' },
                  { id: 'tuning', label: 'Performance' },
                ] as { id: GarageSubTab; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`px-3.5 py-1.5 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    subTab === t.id
                      ? 'bg-amber-500 text-zinc-950'
                      : 'text-zinc-300 hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-5 text-xs text-zinc-300 font-mono-tabular">
              <span>
                Top Speed <strong className="text-white">{stats.maxSpeedKmh} km/h</strong>
              </span>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span>
                0-100 <strong className="text-white">{stats.zeroToHundredSec}s</strong>
              </span>
              <span className="text-zinc-600" aria-hidden="true">·</span>
              <span>
                Grip <strong className="text-white">{stats.cornerGrip.toFixed(2)} G</strong>
              </span>
              <button
                type="button"
                onClick={() => onChange(DEFAULT_VEHICLE_CONFIG)}
                title="Reset vehicle to factory setup"
                className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Tab Content */}
          {subTab === 'chassis' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5">
              {CHASSIS_CATALOG.map((c) => {
                const selected = vehicle.chassis === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onChange({ ...vehicle, chassis: c.id })}
                    className={`text-left p-3 rounded-lg border transition-colors cursor-pointer ${
                      selected
                        ? 'bg-amber-500/12 border-amber-500 text-white'
                        : 'bg-[#141822] border-white/8 text-zinc-300 hover:border-white/25'
                    }`}
                  >
                    <div className="text-[11px] text-zinc-400 mb-0.5">{c.category}</div>
                    <div className="font-display text-base font-bold text-white">{c.name}</div>
                    <div className="text-xs text-zinc-400 mt-1 line-clamp-2">{c.tagline}</div>
                  </button>
                );
              })}
            </div>
          )}

          {subTab === 'paint' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Primary Body Paint</div>
                <div className="flex flex-wrap gap-2">
                  {PAINT_PALETTE.map((swatch) => {
                    const active = vehicle.primaryColor.toLowerCase() === swatch.hex.toLowerCase();
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        title={swatch.name}
                        onClick={() => onChange({ ...vehicle, primaryColor: swatch.hex })}
                        className={`w-8 h-8 rounded-lg border-2 transition-transform cursor-pointer ${
                          active ? 'border-amber-400 scale-110' : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: swatch.hex }}
                        aria-label={swatch.name}
                      />
                    );
                  })}
                </div>
                <div className="mt-3 flex gap-1.5">
                  {FINISH_OPTIONS.map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => onChange({ ...vehicle, finish: f.id })}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors whitespace-nowrap cursor-pointer ${
                        vehicle.finish === f.id
                          ? 'bg-white text-zinc-950 border-white'
                          : 'bg-[#141822] text-zinc-300 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Livery Accent Color</div>
                <div className="flex flex-wrap gap-2">
                  {ACCENT_PALETTE.map((swatch) => {
                    const active = vehicle.accentColor.toLowerCase() === swatch.hex.toLowerCase();
                    return (
                      <button
                        key={swatch.hex}
                        type="button"
                        title={swatch.name}
                        onClick={() => onChange({ ...vehicle, accentColor: swatch.hex })}
                        className={`w-8 h-8 rounded-lg border-2 transition-transform cursor-pointer ${
                          active ? 'border-amber-400 scale-110' : 'border-white/20 hover:scale-105'
                        }`}
                        style={{ backgroundColor: swatch.hex }}
                        aria-label={swatch.name}
                      />
                    );
                  })}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Graphics Pattern</div>
                <div className="grid grid-cols-2 gap-2">
                  {LIVERY_OPTIONS.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => onChange({ ...vehicle, livery: l.id })}
                      className={`px-3 py-2 text-xs font-medium rounded-md border text-left transition-colors whitespace-nowrap cursor-pointer ${
                        vehicle.livery === l.id
                          ? 'bg-amber-500/15 border-amber-500 text-white'
                          : 'bg-[#141822] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      {l.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {subTab === 'aero' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Rear Wing Assembly</div>
                <div className="flex flex-col gap-1.5">
                  {SPOILER_OPTIONS.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onChange({ ...vehicle, spoiler: s.id })}
                      className={`px-3 py-2 text-xs font-medium rounded-md border text-left transition-colors cursor-pointer ${
                        vehicle.spoiler === s.id
                          ? 'bg-amber-500/15 border-amber-500 text-white'
                          : 'bg-[#141822] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Wheel Rim Design</div>
                <div className="flex flex-col gap-1.5">
                  {RIM_STYLE_OPTIONS.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => onChange({ ...vehicle, rimStyle: r.id })}
                      className={`px-3 py-2 text-xs font-medium rounded-md border text-left transition-colors cursor-pointer ${
                        vehicle.rimStyle === r.id
                          ? 'bg-amber-500/15 border-amber-500 text-white'
                          : 'bg-[#141822] border-white/10 text-zinc-300 hover:border-white/25'
                      }`}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-400 mb-2">Rim Finish & Underglow</div>
                <div className="flex flex-wrap gap-2 mb-3">
                  {RIM_COLORS.map((rc) => {
                    const active = vehicle.rimColor.toLowerCase() === rc.hex.toLowerCase();
                    return (
                      <button
                        key={rc.hex}
                        type="button"
                        title={rc.name}
                        onClick={() => onChange({ ...vehicle, rimColor: rc.hex })}
                        className={`w-8 h-8 rounded-lg border-2 cursor-pointer ${
                          active ? 'border-amber-400 scale-110' : 'border-white/20'
                        }`}
                        style={{ backgroundColor: rc.hex }}
                        aria-label={rc.name}
                      />
                    );
                  })}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {UNDERGLOW_OPTIONS.map((ug) => (
                    <button
                      key={ug.id}
                      type="button"
                      onClick={() => onChange({ ...vehicle, underglow: ug.id })}
                      className={`px-2.5 py-1.5 text-xs font-medium rounded-md border transition-colors cursor-pointer ${
                        vehicle.underglow === ug.id
                          ? 'bg-white text-zinc-950 border-white'
                          : 'bg-[#141822] text-zinc-300 border-white/10 hover:border-white/30'
                      }`}
                    >
                      {ug.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {subTab === 'tuning' && (
            <div>
              <div className="flex items-center justify-between text-xs mb-3">
                <span className="text-zinc-400">
                  Allocate up to {MAX_TUNING_POINTS} upgrade points across subsystems
                </span>
                <span className="font-mono-tabular text-amber-400 font-semibold">
                  {remainingPoints} {remainingPoints === 1 ? 'point' : 'points'} available
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {(
                  [
                    { key: 'engine', label: 'Powertrain', detail: 'Spice-Injected Speed & Torque' },
                    { key: 'aero', label: 'Aero Downforce', detail: 'Holtzman Ground Effect' },
                    { key: 'tires', label: 'Tire Compound', detail: 'Dune-Grip Compound' },
                    { key: 'nitro', label: 'Nitro System', detail: 'Melange Afterburner Surge' },
                  ] as { key: keyof VehicleTuning; label: string; detail: string }[]
                ).map((item) => {
                  const lvl = vehicle.tuning[item.key];
                  return (
                    <div
                      key={item.key}
                      className="p-3 rounded-lg bg-[#141822] border border-white/10"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-sm font-semibold text-white">{item.label}</span>
                        <span className="font-mono-tabular text-xs text-amber-400">
                          Stage {lvl}/5
                        </span>
                      </div>
                      <div className="text-xs text-zinc-400 mb-3">{item.detail}</div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => updateTuning(item.key, -1)}
                          disabled={lvl <= 1}
                          className="w-8 h-8 rounded-md bg-[#1d2332] text-white font-semibold disabled:opacity-35 hover:bg-[#273044] cursor-pointer disabled:cursor-not-allowed"
                        >
                          -
                        </button>
                        <div className="flex-1 flex gap-1">
                          {[1, 2, 3, 4, 5].map((step) => (
                            <div
                              key={step}
                              className={`h-2 flex-1 rounded-sm ${
                                step <= lvl ? 'bg-amber-500' : 'bg-zinc-800'
                              }`}
                            />
                          ))}
                        </div>
                        <button
                          type="button"
                          onClick={() => updateTuning(item.key, 1)}
                          disabled={lvl >= 5 || remainingPoints <= 0}
                          className="w-8 h-8 rounded-md bg-[#1d2332] text-white font-semibold disabled:opacity-35 hover:bg-[#273044] cursor-pointer disabled:cursor-not-allowed"
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
