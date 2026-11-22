import React, { useState } from 'react';
import { Check, Copy, LogOut, Play, Plus, Users } from 'lucide-react';
import type {
  MultiplayerRoomState,
  MultiplayerRoomSummary,
  TrackId,
  VehicleConfig,
} from '../shared/types.ts';
import { TRACK_MAP, TRACKS } from '../shared/tracks.ts';
import { formatVehicleSummary } from '../shared/vehicles.ts';

interface MultiplayerPanelProps {
  connected: boolean;
  clientId: string | null;
  driverName: string;
  onChangeDriverName: (name: string) => void;
  vehicle: VehicleConfig;
  rooms: MultiplayerRoomSummary[];
  currentRoom: MultiplayerRoomState | null;
  roomError: string | null;
  onCreateRoom: (params: {
    roomName: string;
    trackId: TrackId;
    laps: number;
    fillBots: boolean;
    autoPilot: boolean;
    driverName: string;
    vehicle: VehicleConfig;
  }) => void;
  onJoinRoom: (roomId: string, driverName: string, vehicle: VehicleConfig) => void;
  onLeaveRoom: () => void;
  onToggleReady: (ready: boolean) => void;
  onUpdateRoomSettings: (
    trackId: TrackId,
    laps: number,
    fillBots: boolean,
    autoPilot: boolean
  ) => void;
  onStartRace: () => void;
}

export const MultiplayerPanel: React.FC<MultiplayerPanelProps> = ({
  connected,
  clientId,
  driverName,
  onChangeDriverName,
  vehicle,
  rooms,
  currentRoom,
  roomError,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onToggleReady,
  onUpdateRoomSettings,
  onStartRace,
}) => {
  const [roomName, setRoomName] = useState('Ducal Cup Grid');
  const [createTrackId, setCreateTrackId] = useState<TrackId>('desert');
  const [createLaps, setCreateLaps] = useState(3);
  const [fillBots, setFillBots] = useState(true);
  const [autoPilot, setAutoPilot] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [copied, setCopied] = useState(false);

  const handleCopyCode = () => {
    if (!currentRoom) return;
    navigator.clipboard?.writeText(currentRoom.id).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (currentRoom) {
    const isHost = currentRoom.hostId === clientId;
    const me = currentRoom.players.find((p) => p.id === clientId);
    const track = TRACK_MAP[currentRoom.trackId];

    return (
      <div className="relative z-20 mx-auto mt-6 w-[min(900px,94vw)] bg-[#0e1118]/95 border border-white/12 rounded-xl p-6 shadow-2xl pointer-events-auto">
        <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-5 border-b border-white/10">
          <div>
            <div className="text-xs text-zinc-400">
              Online Paddock · Room Code <span className="font-mono-tabular text-amber-400 font-semibold">{currentRoom.id}</span>
            </div>
            <h2 className="font-display text-2xl font-bold text-white mt-0.5">
              {currentRoom.name}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-zinc-200 bg-[#161b26] border border-white/10 rounded-lg hover:border-white/25 cursor-pointer"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? 'Code Copied' : `Copy Code (${currentRoom.id})`}</span>
            </button>

            <button
              type="button"
              onClick={onLeaveRoom}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-zinc-300 bg-[#161b26] border border-white/10 rounded-lg hover:text-white cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>Leave Room</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Grid Lineup */}
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-semibold text-white">
                Starting Grid ({currentRoom.players.length}/{currentRoom.maxPlayers} Drivers)
              </span>
              <span className="text-xs text-zinc-400">
                {currentRoom.fillBots ? 'Empty slots filled with AI pace cars' : 'Human drivers only'}
              </span>
            </div>

            <div className="space-y-2.5">
              {[0, 1, 2, 3].map((slot) => {
                const player = currentRoom.players.find((p) => p.gridSlot === slot);
                if (!player) {
                  return (
                    <div
                      key={slot}
                      className="flex items-center justify-between px-4 py-3 rounded-lg bg-[#121620] border border-white/6 text-xs text-zinc-500"
                    >
                      <span className="font-mono-tabular">P{slot + 1}</span>
                      <span>
                        {currentRoom.fillBots ? 'AI Pace Car (Auto-Assigned)' : 'Open Grid Slot'}
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={player.id}
                    className="flex items-center justify-between px-4 py-3 rounded-lg bg-[#151a26] border border-white/10"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono-tabular text-xs font-semibold text-amber-400 w-6">
                        P{slot + 1}
                      </span>
                      <span
                        className="w-3.5 h-3.5 rounded-sm shrink-0 border border-white/20"
                        style={{ backgroundColor: player.vehicle.primaryColor }}
                      />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">
                          {player.name}
                          {player.isHost && (
                            <span className="ml-2 text-xs font-normal text-zinc-400">· Host</span>
                          )}
                          {player.id === clientId && (
                            <span className="ml-2 text-xs font-normal text-amber-400">· You</span>
                          )}
                        </div>
                        <div className="text-xs text-zinc-400 truncate">
                          {formatVehicleSummary(player.vehicle)}
                        </div>
                      </div>
                    </div>

                    <div
                      className={`text-xs font-semibold ${
                        player.ready ? 'text-emerald-400' : 'text-zinc-400'
                      }`}
                    >
                      {player.ready ? 'Ready' : 'In Paddock'}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Room Settings & Launch */}
          <div className="bg-[#121620] border border-white/10 rounded-lg p-4 flex flex-col justify-between">
            <div className="space-y-4">
              <div>
                <div className="text-xs font-medium text-zinc-400 mb-1.5">Circuit</div>
                {isHost ? (
                  <select
                    value={currentRoom.trackId}
                    onChange={(e) =>
                      onUpdateRoomSettings(
                        e.target.value as TrackId,
                        currentRoom.laps,
                        currentRoom.fillBots,
                        currentRoom.autoPilot
                      )
                    }
                    className="w-full px-3 py-2 text-sm text-white bg-[#1a202e] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500"
                  >
                    {TRACKS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.location})
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="text-sm font-semibold text-white">
                    {track.name} · {track.location}
                  </div>
                )}
              </div>

              <div>
                <div className="text-xs font-medium text-zinc-400 mb-1.5">Race Distance</div>
                {isHost ? (
                  <div className="flex gap-2">
                    {[1, 3, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() =>
                          onUpdateRoomSettings(
                            currentRoom.trackId,
                            n,
                            currentRoom.fillBots,
                            currentRoom.autoPilot
                          )
                        }
                        className={`flex-1 py-1.5 text-xs font-semibold rounded-md font-mono-tabular cursor-pointer ${
                          currentRoom.laps === n
                            ? 'bg-white text-zinc-950'
                            : 'bg-[#1a202e] text-zinc-300'
                        }`}
                      >
                        {n} {n === 1 ? 'Lap' : 'Laps'}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm font-semibold text-white font-mono-tabular">
                    {currentRoom.laps} {currentRoom.laps === 1 ? 'Lap' : 'Laps'}
                  </div>
                )}
              </div>

              {isHost ? (
                <div className="space-y-2.5 pt-1">
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Fill empty grid slots with AI cars</span>
                    <input
                      type="checkbox"
                      checked={currentRoom.fillBots}
                      onChange={(e) =>
                        onUpdateRoomSettings(
                          currentRoom.trackId,
                          currentRoom.laps,
                          e.target.checked,
                          currentRoom.autoPilot
                        )
                      }
                      className="accent-amber-500 w-4 h-4"
                    />
                  </label>
                  <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
                    <span>Auto Pilot (Line assist & track limits)</span>
                    <input
                      type="checkbox"
                      checked={currentRoom.autoPilot}
                      onChange={(e) =>
                        onUpdateRoomSettings(
                          currentRoom.trackId,
                          currentRoom.laps,
                          currentRoom.fillBots,
                          e.target.checked
                        )
                      }
                      className="accent-cyan-400 w-4 h-4"
                    />
                  </label>
                </div>
              ) : (
                <div className="text-xs text-zinc-300">
                  Assist:{' '}
                  <span className={currentRoom.autoPilot ? 'text-cyan-300 font-semibold' : 'text-zinc-400'}>
                    {currentRoom.autoPilot ? 'Auto Pilot (Line Assist & Track Limits)' : 'Manual Driving'}
                  </span>
                </div>
              )}
            </div>

            <div className="pt-5 mt-5 border-t border-white/10 space-y-2.5">
              {!isHost && me && (
                <button
                  type="button"
                  onClick={() => onToggleReady(!me.ready)}
                  className={`w-full py-2.5 text-sm font-semibold rounded-lg transition-colors cursor-pointer ${
                    me.ready
                      ? 'bg-[#1a202e] text-zinc-200 border border-white/15'
                      : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
                  }`}
                >
                  {me.ready ? 'Cancel Ready' : 'Mark Ready'}
                </button>
              )}

              {isHost ? (
                <button
                  type="button"
                  onClick={onStartRace}
                  disabled={currentRoom.status !== 'lobby'}
                  className="w-full inline-flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Play className="w-4 h-4" />
                  <span>Start Multiplayer Race</span>
                </button>
              ) : (
                <p className="text-xs text-center text-zinc-400">
                  Waiting for host to launch the race
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="relative z-20 mx-auto mt-6 w-[min(940px,94vw)] max-h-[calc(100vh-110px)] overflow-y-auto bg-[#0e1118]/95 border border-white/12 rounded-xl p-6 shadow-2xl pointer-events-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 mb-5 border-b border-white/10">
        <div>
          <h2 className="font-display text-2xl font-bold text-white">Online Multiplayer</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            {connected
              ? 'Connected to live race server · Share a 4-letter room code to race friends in real time'
              : 'Connecting to race server...'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="mp-driver-name" className="text-xs text-zinc-400">
            Driver
          </label>
          <input
            id="mp-driver-name"
            type="text"
            maxLength={20}
            value={driverName}
            onChange={(e) => onChangeDriverName(e.target.value)}
            placeholder="Driver Name"
            className="px-3 py-1.5 text-sm text-white bg-[#161b26] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500 w-40"
          />
        </div>
      </div>

      {roomError && (
        <div className="mb-4 px-4 py-2.5 text-xs font-medium text-red-200 bg-red-950/60 border border-red-500/40 rounded-lg">
          {roomError}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Create Room */}
        <div className="lg:col-span-2 bg-[#121620] border border-white/10 rounded-lg p-4 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Plus className="w-4 h-4 text-amber-400" />
            <span>Create Race Room</span>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Room Name</label>
            <input
              type="text"
              maxLength={32}
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              className="w-full px-3 py-2 text-sm text-white bg-[#191f2e] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Circuit</label>
            <select
              value={createTrackId}
              onChange={(e) => setCreateTrackId(e.target.value as TrackId)}
              className="w-full px-3 py-2 text-sm text-white bg-[#191f2e] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500"
            >
              {TRACKS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.location})
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-zinc-400">Laps</span>
            <div className="flex gap-1.5">
              {[1, 3, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setCreateLaps(n)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md font-mono-tabular cursor-pointer ${
                    createLaps === n
                      ? 'bg-white text-zinc-950'
                      : 'bg-[#191f2e] text-zinc-300'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center justify-between text-xs text-zinc-300 cursor-pointer">
            <span>Fill open slots with AI pace cars</span>
            <input
              type="checkbox"
              checked={fillBots}
              onChange={(e) => setFillBots(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
          </label>

          <label className="flex items-start justify-between gap-3 text-xs text-zinc-300 cursor-pointer">
            <div>
              <div className="font-medium text-zinc-200">Auto Pilot</div>
              <div className="text-[11px] text-zinc-400">
                Line assist and stays within track limits automatically
              </div>
            </div>
            <input
              type="checkbox"
              checked={autoPilot}
              onChange={(e) => setAutoPilot(e.target.checked)}
              className="accent-cyan-400 w-4 h-4 mt-0.5 shrink-0"
            />
          </label>

          <button
            type="button"
            disabled={!connected}
            onClick={() =>
              onCreateRoom({
                roomName,
                trackId: createTrackId,
                laps: createLaps,
                fillBots,
                autoPilot,
                driverName,
                vehicle,
              })
            }
            className="w-full py-2.5 text-sm font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
          >
            Create Room
          </button>
        </div>

        {/* Join by Code + Open Rooms */}
        <div className="lg:col-span-3 space-y-4">
          <div className="flex items-center gap-2">
            <input
              type="text"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              placeholder="Enter 4-letter Room Code"
              className="flex-1 px-3.5 py-2 text-sm text-white font-mono-tabular uppercase bg-[#121620] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500"
            />
            <button
              type="button"
              disabled={!connected || joinCode.trim().length < 3}
              onClick={() => onJoinRoom(joinCode.trim(), driverName, vehicle)}
              className="px-5 py-2 text-sm font-semibold text-zinc-950 bg-white hover:bg-zinc-200 rounded-lg transition-colors cursor-pointer disabled:opacity-40 whitespace-nowrap"
            >
              Join Code
            </button>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2.5">
              <span className="text-sm font-semibold text-white">Open Race Rooms</span>
              <span className="text-xs text-zinc-400 font-mono-tabular">
                {rooms.length} {rooms.length === 1 ? 'room' : 'rooms'} active
              </span>
            </div>

            {rooms.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 rounded-lg bg-[#121620] border border-white/8 text-center">
                <Users className="w-6 h-6 text-zinc-500 mb-2" />
                <p className="text-sm font-medium text-zinc-300">No active rooms right now</p>
                <p className="text-xs text-zinc-500 mt-1">
                  Create a room on the left and share the code to start a live session.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {rooms.map((rm) => {
                  const t = TRACK_MAP[rm.trackId];
                  const joinable = rm.status === 'lobby' && rm.playerCount < rm.maxPlayers;
                  return (
                    <div
                      key={rm.id}
                      className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-[#121620] border border-white/10"
                    >
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-white truncate">
                          {rm.name}
                        </div>
                        <div className="text-xs text-zinc-400 mt-0.5 font-mono-tabular">
                          Code {rm.id} · {t.name} · {rm.laps} Laps · {rm.playerCount}/{rm.maxPlayers} Drivers
                          {rm.autoPilot ? ' · Auto Pilot' : ''}
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={!joinable}
                        onClick={() => onJoinRoom(rm.id, driverName, vehicle)}
                        className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-amber-500 text-zinc-950 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-500 cursor-pointer disabled:cursor-not-allowed whitespace-nowrap"
                      >
                        {rm.status !== 'lobby'
                          ? 'In Race'
                          : rm.playerCount >= rm.maxPlayers
                            ? 'Full'
                            : 'Join Grid'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
