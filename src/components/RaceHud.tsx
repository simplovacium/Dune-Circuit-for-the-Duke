import React from 'react';
import {
  AlertTriangle,
  Camera,
  Crosshair,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Shield,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type { RaceMode, TrackMeta } from '../shared/types.ts';
import type { CameraViewMode, HudSnapshot, TouchInputState } from '../game/RaceViewport.tsx';
import { formatRaceTime } from '../utils/formatTime.ts';
import { TrackMapSvg } from './TrackMapSvg.tsx';

interface RaceHudProps {
  hud: HudSnapshot;
  track: TrackMeta;
  raceMode: RaceMode;
  cameraMode: CameraViewMode;
  muted: boolean;
  paused: boolean;
  finishResult: {
    bestLapMs: number;
    totalRaceMs: number;
    position: number;
    standings: HudSnapshot['standings'];
  } | null;
  touchInputRef: React.MutableRefObject<TouchInputState>;
  onCycleCamera: () => void;
  onToggleMute: () => void;
  onTogglePause: () => void;
  onRaceAgain: () => void;
  onExitToGarage: () => void;
}

export const RaceHud: React.FC<RaceHudProps> = ({
  hud,
  track,
  raceMode,
  cameraMode,
  muted,
  paused,
  finishResult,
  touchInputRef,
  onCycleCamera,
  onToggleMute,
  onTogglePause,
  onRaceAgain,
  onExitToGarage,
}) => {
  const setTouch = (key: keyof TouchInputState, val: boolean) => {
    touchInputRef.current[key] = val;
  };

  return (
    <div className="fixed inset-0 z-20 pointer-events-none select-none">
      {/* Top-Left Race Timing & Position */}
      <div className="absolute top-4 left-4 flex flex-col gap-2">
        <div className="flex items-center gap-5 px-4 py-2.5 rounded-xl bg-[#0e1118]/90 border border-white/12">
          <div>
            <div className="text-[11px] text-zinc-400">Position</div>
            <div className="font-display text-2xl font-bold text-white font-mono-tabular">
              <span className="text-amber-400">{hud.position}</span>
              <span className="text-sm text-zinc-500"> / {hud.totalRacers}</span>
            </div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <div className="text-[11px] text-zinc-400">Lap</div>
            <div className="font-display text-2xl font-bold text-white font-mono-tabular">
              {hud.lap}
              <span className="text-sm text-zinc-500"> / {hud.totalLaps}</span>
            </div>
          </div>
          <div className="h-8 w-px bg-white/10" />
          <div>
            <div className="text-[11px] text-zinc-400">Race Time</div>
            <div className="font-mono-tabular text-lg font-semibold text-white">
              {formatRaceTime(hud.elapsedMs)}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4 px-3.5 py-1.5 rounded-lg bg-[#0e1118]/85 border border-white/10 text-xs font-mono-tabular text-zinc-300">
          <span>Current {formatRaceTime(hud.currentLapMs)}</span>
          <span className="text-zinc-600" aria-hidden="true">·</span>
          <span className="text-amber-400">Best {formatRaceTime(hud.bestLapMs)}</span>
        </div>

        {hud.autoPilot && (
          <div className="inline-flex items-center gap-2 self-start px-3 py-1 rounded-lg bg-[#0e1118]/88 border border-cyan-500/45 text-xs text-cyan-300">
            <Navigation className="w-3.5 h-3.5 shrink-0" />
            <span className="font-semibold">Auto Pilot</span>
            <span className="text-zinc-400">· Line Assist &amp; Track Limits</span>
          </div>
        )}
      </div>

      {/* Top-Right Minimap & Action Controls */}
      <div className="absolute top-4 right-4 flex flex-col items-end gap-2">
        <div className="flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={onCycleCamera}
            title="Cycle Camera (C)"
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-200 bg-[#0e1118]/90 border border-white/12 rounded-lg hover:bg-[#171c26] cursor-pointer"
          >
            <Camera className="w-3.5 h-3.5" />
            <span className="capitalize">{cameraMode}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMute}
            title="Toggle Audio (M)"
            className="p-2 text-zinc-200 bg-[#0e1118]/90 border border-white/12 rounded-lg hover:bg-[#171c26] cursor-pointer"
            aria-label={muted ? 'Unmute audio' : 'Mute audio'}
          >
            {muted ? <VolumeX className="w-4 h-4 text-zinc-400" /> : <Volume2 className="w-4 h-4" />}
          </button>

          <button
            type="button"
            onClick={onTogglePause}
            title="Pause / Menu (Esc)"
            className="p-2 text-zinc-200 bg-[#0e1118]/90 border border-white/12 rounded-lg hover:bg-[#171c26] cursor-pointer"
            aria-label="Pause or exit race"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>

        <div className="p-2.5 rounded-xl bg-[#0e1118]/88 border border-white/10">
          <TrackMapSvg
            track={track}
            className="w-28 h-28"
            dots={hud.standings.map((s) => ({
              id: s.id,
              x: s.x,
              z: s.z,
              color: s.color,
              isPlayer: s.isPlayer,
            }))}
          />
        </div>
      </div>

      {/* Center Countdown / Lap Split Banner */}
      {hud.countdown !== null && hud.countdown > 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="px-10 py-6 rounded-2xl bg-[#0e1118]/90 border border-white/15 text-center">
            <div className="text-xs font-medium text-zinc-400 mb-1">{track.name}</div>
            <div className="font-display text-7xl font-bold text-amber-400 font-mono-tabular">
              {hud.countdown}
            </div>
          </div>
        </div>
      )}

      {hud.lapBanner && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 px-6 py-2.5 rounded-xl bg-[#0e1118]/92 border border-amber-500/50">
          <span className="font-display text-xl font-bold text-amber-400 font-mono-tabular">
            {hud.lapBanner}
          </span>
        </div>
      )}

      {hud.sandwormWarning && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 inline-flex items-center gap-2 px-4 py-1.5 rounded-xl bg-[#0e1118]/92 border border-orange-500/65 text-xs">
          <AlertTriangle className="w-4 h-4 text-orange-400 shrink-0" />
          <span className="font-semibold text-orange-300">Sandworm Crossing Ahead</span>
          <span className="hidden sm:inline text-zinc-300">
            · Avoid collision or shoot for Spice Nitro
          </span>
        </div>
      )}

      {/* Bottom-Right Flat Tire Warning, Spice Harvest + Speedometer, Gear, RPM, Nitro & Blasters */}
      <div className="absolute bottom-24 md:bottom-5 right-4 md:right-5 w-56 md:w-60 flex flex-col gap-2">
        {hud.flatTireTimerMs > 0 && (
          <div className="px-3.5 py-2.5 rounded-xl bg-[#0e1118]/94 border border-red-500/70">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="inline-flex items-center gap-1.5 font-semibold text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>Flat Tire</span>
              </span>
              <span className="font-mono-tabular text-red-300 font-semibold">
                {(hud.flatTireTimerMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="text-[11px] text-zinc-300 mb-1.5">Reduced speed & traction</div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-sm overflow-hidden">
              <div
                className="h-full bg-red-500 transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round((hud.flatTireTimerMs / 2000) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {hud.spiceTimerMs > 0 && (
          <div className="px-3.5 py-2.5 rounded-xl bg-[#0e1118]/92 border border-amber-500/60">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="inline-flex items-center gap-1.5 font-semibold text-amber-400">
                <Shield className="w-3.5 h-3.5" />
                <span>Spice Harvest</span>
              </span>
              <span className="font-mono-tabular text-cyan-300 font-semibold">
                {(hud.spiceTimerMs / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="text-[11px] text-zinc-300 mb-1.5">Boost & Shield Active</div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-sm overflow-hidden">
              <div
                className="h-full bg-amber-400 transition-[width] duration-75"
                style={{ width: `${Math.min(100, Math.round((hud.spiceTimerMs / 2000) * 100))}%` }}
              />
            </div>
          </div>
        )}

        <div className="w-full p-4 rounded-xl bg-[#0e1118]/92 border border-white/12">
          <div className="flex items-baseline justify-between mb-2">
            <div>
              <span className="font-display text-4xl font-bold text-white font-mono-tabular">
                {hud.speedKmh}
              </span>
              <span className="text-xs text-zinc-400 ml-1.5">KM/H</span>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-zinc-400">Gear</div>
              <div className="font-display text-xl font-bold text-amber-400 font-mono-tabular">
                {hud.gear}
              </div>
            </div>
          </div>

          {/* RPM Bar */}
          <div className="h-2 w-full bg-zinc-800 rounded-sm overflow-hidden mb-3">
            <div
              className={`h-full transition-[width] duration-75 ${
                hud.rpmRatio > 0.85 ? 'bg-red-500' : 'bg-amber-400'
              }`}
              style={{ width: `${Math.round(hud.rpmRatio * 100)}%` }}
            />
          </div>

          {/* Nitro Bar */}
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-zinc-400">Nitro Boost (Space)</span>
            <span className="font-mono-tabular text-cyan-400 font-semibold">
              {Math.round(hud.nitroRatio * 100)}%
            </span>
          </div>
          <div className="h-2 w-full bg-zinc-800 rounded-sm overflow-hidden mb-3">
            <div
              className="h-full bg-cyan-400 transition-[width] duration-75"
              style={{ width: `${Math.round(hud.nitroRatio * 100)}%` }}
            />
          </div>

          {/* Blaster Cooldown Bar */}
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="inline-flex items-center gap-1 text-zinc-400">
              <Crosshair className="w-3 h-3 text-amber-400" />
              <span>Blasters (F / Click)</span>
            </span>
            <span
              className={`font-mono-tabular font-semibold ${
                hud.fireCooldownRatio <= 0.01 ? 'text-amber-400' : 'text-zinc-400'
              }`}
            >
              {hud.fireCooldownRatio <= 0.01
                ? 'Ready'
                : `${Math.round((1 - hud.fireCooldownRatio) * 100)}%`}
            </span>
          </div>
          <div className="h-1.5 w-full bg-zinc-800 rounded-sm overflow-hidden">
            <div
              className={`h-full transition-[width] duration-75 ${
                hud.fireCooldownRatio <= 0.01 ? 'bg-amber-400' : 'bg-amber-500/60'
              }`}
              style={{ width: `${Math.round((1 - hud.fireCooldownRatio) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Bottom-Center Discreet Controls Guide (Desktop) */}
      <div className="hidden md:flex absolute bottom-5 left-1/2 -translate-x-1/2 px-4 py-1.5 rounded-lg bg-[#0e1118]/85 border border-white/10 text-xs text-zinc-300 gap-3 whitespace-nowrap">
        <span>W/A/S/D or Arrows Drive</span>
        <span className="text-zinc-600" aria-hidden="true">·</span>
        <span>Space Nitro</span>
        <span className="text-zinc-600" aria-hidden="true">·</span>
        <span>F / Click Shoot</span>
        <span className="text-zinc-600" aria-hidden="true">·</span>
        <span>B Drift</span>
        <span className="text-zinc-600" aria-hidden="true">·</span>
        <span>C Camera</span>
        <span className="text-zinc-600" aria-hidden="true">·</span>
        <span>R Reset</span>
      </div>

      {/* Touch Controls for Mobile / Tablet */}
      <div className="flex md:hidden absolute bottom-5 left-4 right-4 items-end justify-between pointer-events-auto">
        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => setTouch('left', true)}
            onPointerUp={() => setTouch('left', false)}
            onPointerLeave={() => setTouch('left', false)}
            className="w-14 h-14 rounded-xl bg-[#0e1118]/90 border border-white/15 text-white font-bold text-lg active:bg-amber-500 active:text-zinc-950"
          >
            ◀
          </button>
          <button
            type="button"
            onPointerDown={() => setTouch('right', true)}
            onPointerUp={() => setTouch('right', false)}
            onPointerLeave={() => setTouch('right', false)}
            className="w-14 h-14 rounded-xl bg-[#0e1118]/90 border border-white/15 text-white font-bold text-lg active:bg-amber-500 active:text-zinc-950"
          >
            ▶
          </button>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={() => setTouch('fire', true)}
            onPointerUp={() => setTouch('fire', false)}
            onPointerLeave={() => setTouch('fire', false)}
            className="px-3.5 h-14 rounded-xl bg-amber-500/20 border border-amber-400/60 text-amber-300 font-semibold text-xs active:bg-amber-400 active:text-zinc-950"
          >
            FIRE
          </button>
          <button
            type="button"
            onPointerDown={() => setTouch('nitro', true)}
            onPointerUp={() => setTouch('nitro', false)}
            onPointerLeave={() => setTouch('nitro', false)}
            className="px-4 h-14 rounded-xl bg-cyan-500/20 border border-cyan-400/50 text-cyan-200 font-semibold text-xs active:bg-cyan-400 active:text-zinc-950"
          >
            NITRO
          </button>
          <button
            type="button"
            onPointerDown={() => setTouch('brake', true)}
            onPointerUp={() => setTouch('brake', false)}
            onPointerLeave={() => setTouch('brake', false)}
            className="px-4 h-14 rounded-xl bg-[#0e1118]/90 border border-white/15 text-zinc-200 font-semibold text-xs active:bg-red-500"
          >
            BRAKE
          </button>
          <button
            type="button"
            onPointerDown={() => setTouch('throttle', true)}
            onPointerUp={() => setTouch('throttle', false)}
            onPointerLeave={() => setTouch('throttle', false)}
            className="px-5 h-14 rounded-xl bg-amber-500 text-zinc-950 font-bold text-xs active:bg-amber-400"
          >
            GAS
          </button>
        </div>
      </div>

      {/* Pause Overlay */}
      {paused && !finishResult && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/70 pointer-events-auto">
          <div className="w-[min(420px,90vw)] bg-[#0e1118] border border-white/15 rounded-xl p-6 text-center shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white mb-1">
              {raceMode === 'singleplayer' ? 'Race Paused' : 'Race Menu'}
            </h2>
            <p className="text-xs text-zinc-400 mb-6">
              {track.name} · Lap {hud.lap} of {hud.totalLaps}
            </p>

            <div className="space-y-2.5">
              <button
                type="button"
                onClick={onTogglePause}
                className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg cursor-pointer"
              >
                <Play className="w-4 h-4" />
                <span>Resume Race</span>
              </button>

              {raceMode === 'singleplayer' && (
                <button
                  type="button"
                  onClick={onRaceAgain}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-white bg-[#171c26] hover:bg-[#1f2633] border border-white/10 rounded-lg cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Restart Race</span>
                </button>
              )}

              <button
                type="button"
                onClick={onExitToGarage}
                className="w-full py-2.5 text-sm font-medium text-zinc-300 hover:text-white bg-transparent border border-white/10 rounded-lg cursor-pointer"
              >
                Exit to Garage
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-Race Results Modal */}
      {finishResult && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 pointer-events-auto p-4">
          <div className="w-[min(560px,94vw)] bg-[#0e1118] border border-white/15 rounded-xl p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4 pb-4 mb-4 border-b border-white/10">
              <div>
                <div className="text-xs text-amber-400 font-semibold">Checkered Flag</div>
                <h2 className="font-display text-3xl font-bold text-white mt-0.5">
                  Finished P{finishResult.position}
                </h2>
                <p className="text-xs text-zinc-400 mt-1">
                  {track.name} · Submitted to real-time online leaderboards
                </p>
              </div>
              <div className="text-right font-mono-tabular">
                <div className="text-[11px] text-zinc-400">Best Lap</div>
                <div className="text-lg font-bold text-amber-400">
                  {formatRaceTime(finishResult.bestLapMs)}
                </div>
                <div className="text-[11px] text-zinc-400 mt-1">
                  Total {formatRaceTime(finishResult.totalRaceMs)}
                </div>
              </div>
            </div>

            <div className="space-y-2 mb-6">
              {finishResult.standings.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between px-3.5 py-2.5 rounded-lg border text-xs ${
                    s.isPlayer
                      ? 'bg-amber-500/12 border-amber-500/50 text-white'
                      : 'bg-[#141822] border-white/8 text-zinc-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className="font-mono-tabular font-bold w-5 text-amber-400">
                      P{s.position}
                    </span>
                    <span
                      className="w-3 h-3 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="font-semibold">
                      {s.name}
                      {s.isBot ? ' (AI)' : ''}
                    </span>
                  </div>
                  <div className="font-mono-tabular text-zinc-300">
                    {s.bestLapMs ? `Best ${formatRaceTime(s.bestLapMs)}` : 'Racing'}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-3">
              {raceMode === 'singleplayer' && (
                <button
                  type="button"
                  onClick={onRaceAgain}
                  className="flex-1 py-2.5 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg cursor-pointer"
                >
                  Play Again
                </button>
              )}
              <button
                type="button"
                onClick={onExitToGarage}
                className="flex-1 py-2.5 text-sm font-semibold text-white bg-[#171c26] hover:bg-[#1f2633] border border-white/12 rounded-lg cursor-pointer"
              >
                {raceMode === 'multiplayer' ? 'Return to Paddock' : 'Return to Garage'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
