import React, { useMemo, useRef } from 'react';
import { ChevronDown, ChevronUp, Flag, ImagePlus, RotateCcw, X } from 'lucide-react';
import type {
  CustomSignImageConfig,
  CustomSignImagesMap,
  LeaderboardEntry,
  TrackId,
} from '../shared/types.ts';
import { TRACKS } from '../shared/tracks.ts';
import { formatRaceTime } from '../utils/formatTime.ts';
import { resolveSignSlots } from '../utils/defaultSignJpgs.ts';
import { TrackMapSvg } from './TrackMapSvg.tsx';

interface TrackSelectorDockProps {
  selectedTrackId: TrackId;
  onSelectTrack: (id: TrackId) => void;
  customSignImages: CustomSignImagesMap;
  onChangeSignSlot: (
    trackId: TrackId,
    slotIndex: 0 | 1 | 2,
    config: CustomSignImageConfig | null | undefined
  ) => void;
  onResetTrackSigns: (trackId: TrackId) => void;
  laps: number;
  onChangeLaps: (laps: number) => void;
  aiCount: number;
  onChangeAiCount: (count: number) => void;
  autoPilot: boolean;
  onChangeAutoPilot: (enabled: boolean) => void;
  leaderboards: LeaderboardEntry[];
  onStartRace: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

function resizeImageFileToJpeg(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file'));
    reader.onload = () => {
      const src = typeof reader.result === 'string' ? reader.result : '';
      if (!src) {
        reject(new Error('Invalid image data'));
        return;
      }
      const img = new Image();
      img.onerror = () => reject(new Error('Unsupported image format'));
      img.onload = () => {
        const maxW = 1024;
        const maxH = 512;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(src);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  });
}

export const TrackSelectorDock: React.FC<TrackSelectorDockProps> = ({
  selectedTrackId,
  onSelectTrack,
  customSignImages,
  onChangeSignSlot,
  onResetTrackSigns,
  laps,
  onChangeLaps,
  aiCount,
  onChangeAiCount,
  autoPilot,
  onChangeAutoPilot,
  leaderboards,
  onStartRace,
  collapsed,
  onToggleCollapse,
}) => {
  const slotInputRefs = useRef<(HTMLInputElement | null)[]>([null, null, null]);
  const multiInputRef = useRef<HTMLInputElement | null>(null);
  const selectedTrack = TRACKS.find((t) => t.id === selectedTrackId) ?? TRACKS[0];
  const resolvedSlots = useMemo(
    () => resolveSignSlots(customSignImages[selectedTrack.id]),
    [customSignImages, selectedTrack.id]
  );

  const hasCustomOrCleared = resolvedSlots.some((s) => !s.isDefault);

  const getTrackBest = (tId: TrackId) => {
    const match = leaderboards
      .filter((e) => e.trackId === tId)
      .sort((a, b) => a.bestLapMs - b.bestLapMs)[0];
    return match ?? null;
  };

  const selectedRecord = getTrackBest(selectedTrack.id);

  const handleSingleSlotSelected = async (
    slotIndex: 0 | 1 | 2,
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageFileToJpeg(file);
      onChangeSignSlot(selectedTrack.id, slotIndex, {
        dataUrl,
        label: file.name,
      });
    } catch {
      // Ignore invalid/corrupted file selection
    }
  };

  const handleMultiSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).slice(0, 3);
    e.target.value = '';
    if (files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      try {
        const dataUrl = await resizeImageFileToJpeg(files[i]);
        onChangeSignSlot(selectedTrack.id, i as 0 | 1 | 2, {
          dataUrl,
          label: files[i].name,
        });
      } catch {
        // Skip invalid file
      }
    }
  };

  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(1120px,95vw)] pointer-events-auto">
      <div className="flex justify-center mb-2">
        <button
          type="button"
          onClick={onToggleCollapse}
          className="inline-flex items-center gap-2 px-4 py-1.5 text-xs font-medium text-zinc-200 bg-[#12161f]/95 border border-white/12 rounded-lg hover:bg-[#1a202c] transition-colors whitespace-nowrap cursor-pointer"
        >
          {collapsed ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>{collapsed ? 'Show Circuits (H)' : 'Hide Controls (H)'}</span>
        </button>
      </div>

      {!collapsed && (
        <div className="bg-[#0e1118]/94 border border-white/12 rounded-xl p-4 shadow-2xl">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
            {TRACKS.map((track) => {
              const active = track.id === selectedTrackId;
              const best = getTrackBest(track.id);
              const slots = resolveSignSlots(customSignImages[track.id]);
              const activeSignCount = slots.filter((s) => Boolean(s.dataUrl)).length;
              return (
                <button
                  key={track.id}
                  type="button"
                  onClick={() => onSelectTrack(track.id)}
                  className={`flex items-start gap-3 p-3 rounded-lg border text-left transition-colors cursor-pointer ${
                    active
                      ? 'bg-amber-500/12 border-amber-500 text-white'
                      : 'bg-[#141822] border-white/8 text-zinc-300 hover:border-white/25'
                  }`}
                >
                  <TrackMapSvg track={track} className="w-12 h-12 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] text-zinc-400 truncate">{track.location}</div>
                    <div className="font-display text-sm font-bold text-white truncate">
                      {track.name}
                    </div>
                    <div className="text-[11px] text-zinc-400 mt-1 font-mono-tabular">
                      {track.lengthMeters}m · {activeSignCount} JPG Signs
                    </div>
                    <div className="text-[11px] text-amber-400 mt-0.5 font-mono-tabular truncate">
                      {best ? `Record ${formatRaceTime(best.bestLapMs)}` : 'No record set'}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-white/10">
            <div className="flex-1 min-w-[280px] space-y-2.5">
              <div>
                <div className="text-sm font-semibold text-white">
                  {selectedTrack.name} — {selectedTrack.surface}
                </div>
                <div className="text-xs text-zinc-400 mt-0.5">
                  {selectedTrack.description}
                  {selectedRecord && (
                    <span className="text-zinc-300">
                      {' '}
                      · Lap Record by {selectedRecord.driverName} ({formatRaceTime(selectedRecord.bestLapMs)})
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  ref={multiInputRef}
                  type="file"
                  multiple
                  accept=".jpg,.jpeg,image/jpeg,image/*"
                  onChange={handleMultiSelected}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => multiInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-amber-300 bg-amber-500/12 hover:bg-amber-500/20 border border-amber-500/40 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Upload 1–3 JPGs</span>
                </button>

                {resolvedSlots.map((slot) => (
                  <div
                    key={slot.slotIndex}
                    className="relative inline-flex items-center gap-1.5 pl-1.5 pr-1 py-1 rounded-lg bg-[#151a25] border border-white/12"
                  >
                    <input
                      ref={(el) => {
                        slotInputRefs.current[slot.slotIndex] = el;
                      }}
                      type="file"
                      accept=".jpg,.jpeg,image/jpeg,image/*"
                      onChange={(e) => handleSingleSlotSelected(slot.slotIndex, e)}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => slotInputRefs.current[slot.slotIndex]?.click()}
                      title={`Click to upload JPG for Sign ${slot.slotIndex + 1}`}
                      className="inline-flex items-center gap-1.5 cursor-pointer group"
                    >
                      {slot.dataUrl ? (
                        <img
                          src={slot.dataUrl}
                          alt={`Track sign ${slot.slotIndex + 1}`}
                          className="w-12 h-6 object-cover rounded border border-amber-500/50 group-hover:border-amber-300 bg-[#140e09]"
                        />
                      ) : (
                        <div className="w-12 h-6 rounded border border-dashed border-white/25 flex items-center justify-center text-[10px] text-zinc-400 group-hover:text-amber-300">
                          + JPG
                        </div>
                      )}
                      <span className="text-[11px] font-medium text-zinc-300 group-hover:text-white">
                        #{slot.slotIndex + 1}
                      </span>
                    </button>
                    {slot.dataUrl && (
                      <button
                        type="button"
                        onClick={() => onChangeSignSlot(selectedTrack.id, slot.slotIndex, null)}
                        title={`Hide Sign ${slot.slotIndex + 1}`}
                        className="p-0.5 text-zinc-500 hover:text-rose-300 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}

                {hasCustomOrCleared && (
                  <button
                    type="button"
                    onClick={() => onResetTrackSigns(selectedTrack.id)}
                    title="Restore 3 default JPG signs"
                    className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-zinc-400 hover:text-white bg-[#161b26] border border-white/10 rounded-md cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Defaults</span>
                  </button>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-400 mr-1">Laps</span>
                {[1, 3, 5].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChangeLaps(n)}
                    className={`px-2.5 py-1.5 text-xs font-semibold rounded-md font-mono-tabular cursor-pointer ${
                      laps === n
                        ? 'bg-white text-zinc-950'
                        : 'bg-[#161b26] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-1.5">
                <span className="text-xs text-zinc-400 mr-1">Grid</span>
                {[
                  { count: 0, label: 'Time Trial' },
                  { count: 3, label: '4-Car Race' },
                ].map((opt) => (
                  <button
                    key={opt.count}
                    type="button"
                    onClick={() => onChangeAiCount(opt.count)}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap cursor-pointer ${
                      aiCount === opt.count
                        ? 'bg-white text-zinc-950'
                        : 'bg-[#161b26] text-zinc-300 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>

              <label
                title="Line assist and remains within track limits automatically"
                className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs font-semibold cursor-pointer select-none transition-colors ${
                  autoPilot
                    ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                    : 'bg-[#161b26] border-white/10 text-zinc-300 hover:text-white'
                }`}
              >
                <input
                  type="checkbox"
                  checked={autoPilot}
                  onChange={(e) => onChangeAutoPilot(e.target.checked)}
                  className="accent-cyan-400 w-3.5 h-3.5 cursor-pointer"
                />
                <span>Auto Pilot</span>
              </label>

              <button
                type="button"
                onClick={onStartRace}
                className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
              >
                <Flag className="w-4 h-4" />
                <span>Start Race</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
