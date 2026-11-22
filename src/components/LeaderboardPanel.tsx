import React, { useMemo, useState } from 'react';
import { Trophy } from 'lucide-react';
import type { LeaderboardEntry, RaceMode, TrackId } from '../shared/types.ts';
import { TRACK_MAP, TRACKS } from '../shared/tracks.ts';
import { formatRaceTime } from '../utils/formatTime.ts';

interface LeaderboardPanelProps {
  entries: LeaderboardEntry[];
  connected: boolean;
  currentDriverName: string;
  onStartRaceOnTrack: (trackId: TrackId) => void;
}

export const LeaderboardPanel: React.FC<LeaderboardPanelProps> = ({
  entries,
  connected,
  currentDriverName,
  onStartRaceOnTrack,
}) => {
  const [trackFilter, setTrackFilter] = useState<TrackId | 'all'>('all');
  const [modeFilter, setModeFilter] = useState<RaceMode | 'all'>('all');
  const [sortBy, setSortBy] = useState<'bestLapMs' | 'totalRaceMs'>('bestLapMs');

  const filtered = useMemo(() => {
    return entries
      .filter((e) => (trackFilter === 'all' ? true : e.trackId === trackFilter))
      .filter((e) => (modeFilter === 'all' ? true : e.mode === modeFilter))
      .sort((a, b) => a[sortBy] - b[sortBy])
      .slice(0, 50);
  }, [entries, trackFilter, modeFilter, sortBy]);

  return (
    <div className="relative z-20 mx-auto mt-6 w-[min(980px,94vw)] max-h-[calc(100vh-110px)] flex flex-col bg-[#0e1118]/95 border border-white/12 rounded-xl p-6 shadow-2xl pointer-events-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-4 border-b border-white/10">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">Online Leaderboards</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {connected
              ? 'Live global standings · Synced in real time across all connected drivers'
              : 'Showing saved standings · Reconnecting to live feed'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 p-1 bg-[#161b26] rounded-lg">
            {(['all', 'singleplayer', 'multiplayer'] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setModeFilter(m)}
                className={`px-3 py-1 text-xs font-medium rounded-md capitalize cursor-pointer ${
                  modeFilter === m
                    ? 'bg-white text-zinc-950'
                    : 'text-zinc-300 hover:text-white'
                }`}
              >
                {m === 'all' ? 'All Modes' : m}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1 p-1 bg-[#161b26] rounded-lg">
            <button
              type="button"
              onClick={() => setSortBy('bestLapMs')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                sortBy === 'bestLapMs'
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Best Lap
            </button>
            <button
              type="button"
              onClick={() => setSortBy('totalRaceMs')}
              className={`px-3 py-1 text-xs font-medium rounded-md cursor-pointer ${
                sortBy === 'totalRaceMs'
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-300 hover:text-white'
              }`}
            >
              Race Time
            </button>
          </div>
        </div>
      </div>

      {/* Track Filter Strip */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
        <button
          type="button"
          onClick={() => setTrackFilter('all')}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
            trackFilter === 'all'
              ? 'bg-amber-500 text-zinc-950'
              : 'bg-[#151a25] text-zinc-300 hover:text-white'
          }`}
        >
          All Circuits
        </button>
        {TRACKS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTrackFilter(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap cursor-pointer ${
              trackFilter === t.id
                ? 'bg-amber-500 text-zinc-950'
                : 'bg-[#151a25] text-zinc-300 hover:text-white'
            }`}
          >
            {t.name}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-[240px]">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <Trophy className="w-8 h-8 text-zinc-600 mb-3" />
            <p className="text-sm font-semibold text-zinc-200">
              No times recorded yet for this filter
            </p>
            <p className="text-xs text-zinc-400 mt-1 mb-4">
              Complete a race or time trial to post the first verified benchmark.
            </p>
            <button
              type="button"
              onClick={() =>
                onStartRaceOnTrack(trackFilter === 'all' ? 'desert' : trackFilter)
              }
              className="px-4 py-2 text-xs font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg cursor-pointer"
            >
              Set Track Record
            </button>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-white/10 text-[11px] text-zinc-400 font-medium">
                <th className="py-2.5 px-3">Rank</th>
                <th className="py-2.5 px-3">Driver</th>
                <th className="py-2.5 px-3">Circuit</th>
                <th className="py-2.5 px-3">Vehicle Setup</th>
                <th className="py-2.5 px-3">Mode</th>
                <th className="py-2.5 px-3 text-right">Best Lap</th>
                <th className="py-2.5 px-3 text-right">Total Time</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/6 text-xs">
              {filtered.map((entry, idx) => {
                const isMe =
                  currentDriverName.trim().toLowerCase() ===
                  entry.driverName.trim().toLowerCase();
                return (
                  <tr
                    key={entry.id}
                    className={isMe ? 'bg-amber-500/8' : 'hover:bg-white/[0.02]'}
                  >
                    <td className="py-2.5 px-3 font-mono-tabular font-semibold text-zinc-300">
                      {idx === 0 ? (
                        <span className="text-amber-400">01</span>
                      ) : (
                        String(idx + 1).padStart(2, '0')
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-semibold text-white">
                      {entry.driverName}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-300">
                      {TRACK_MAP[entry.trackId]?.name ?? entry.trackId}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-400">{entry.vehicleSummary}</td>
                    <td className="py-2.5 px-3 text-zinc-400 capitalize">
                      {entry.mode} · {entry.laps}L
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-amber-400">
                      {formatRaceTime(entry.bestLapMs)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular text-zinc-300">
                      {formatRaceTime(entry.totalRaceMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};
