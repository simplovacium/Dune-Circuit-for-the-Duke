import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Flag, Sliders, Users } from 'lucide-react';
import type {
  CustomSignImageConfig,
  CustomSignImagesMap,
  RaceMode,
  TrackId,
  VehicleConfig,
} from './shared/types.ts';
import { TRACK_MAP } from './shared/tracks.ts';
import {
  computeVehicleStats,
  DEFAULT_VEHICLE_CONFIG,
  formatVehicleSummary,
} from './shared/vehicles.ts';
import { RacingAudioEngine } from './game/audioEngine.ts';
import {
  RaceViewport,
  type CameraViewMode,
  type HudSnapshot,
  type TouchInputState,
  type ViewportSceneMode,
} from './game/RaceViewport.tsx';
import { useRacingNetwork } from './hooks/useRacingNetwork.ts';
import { TopBar, type HubTab } from './components/TopBar.tsx';
import { GarageDock } from './components/GarageDock.tsx';
import { TrackSelectorDock } from './components/TrackSelectorDock.tsx';
import { MultiplayerPanel } from './components/MultiplayerPanel.tsx';
import { LeaderboardPanel } from './components/LeaderboardPanel.tsx';
import { RaceHud } from './components/RaceHud.tsx';
import { formatRaceTime } from './utils/formatTime.ts';

const STORAGE_VEHICLE_KEY = 'dune_circuit_vehicle_v2';
const STORAGE_NAME_KEY = 'dune_circuit_driver_v1';
const STORAGE_SIGNS_KEY = 'dune_circuit_custom_signs_v2';

function loadStoredCustomSigns(): CustomSignImagesMap {
  try {
    const raw = localStorage.getItem(STORAGE_SIGNS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as CustomSignImagesMap;
  } catch {
    return {};
  }
}

function loadStoredVehicle(): VehicleConfig {
  try {
    const raw = localStorage.getItem(STORAGE_VEHICLE_KEY);
    if (!raw) return DEFAULT_VEHICLE_CONFIG;
    const parsed = JSON.parse(raw) as Partial<VehicleConfig>;
    return {
      ...DEFAULT_VEHICLE_CONFIG,
      ...parsed,
      tuning: {
        ...DEFAULT_VEHICLE_CONFIG.tuning,
        ...(parsed.tuning ?? {}),
      },
    };
  } catch {
    return DEFAULT_VEHICLE_CONFIG;
  }
}

function loadStoredDriverName(): string {
  try {
    return localStorage.getItem(STORAGE_NAME_KEY) || 'Atreides 01';
  } catch {
    return 'Atreides 01';
  }
}

const INITIAL_HUD: HudSnapshot = {
  speedKmh: 0,
  gear: 1,
  rpmRatio: 0.2,
  nitroRatio: 1,
  nitroActive: false,
  spiceTimerMs: 0,
  spiceHarvestCount: 0,
  fireCooldownRatio: 0,
  flatTireTimerMs: 0,
  hitsLanded: 0,
  autoPilot: false,
  sandwormWarning: false,
  lap: 1,
  totalLaps: 3,
  position: 1,
  totalRacers: 4,
  elapsedMs: 0,
  currentLapMs: 0,
  bestLapMs: null,
  lastLapMs: null,
  countdown: 3,
  finished: false,
  standings: [],
  lapBanner: null,
};

export default function App() {
  const network = useRacingNetwork();
  const audioEngine = useMemo(() => new RacingAudioEngine(), []);
  const touchInputRef = useRef<TouchInputState>({
    throttle: false,
    brake: false,
    left: false,
    right: false,
    nitro: false,
    fire: false,
  });

  const [activeTab, setActiveTab] = useState<HubTab>('home');
  const [inRace, setInRace] = useState(false);
  const [raceMode, setRaceMode] = useState<RaceMode>('singleplayer');
  const [raceSessionId, setRaceSessionId] = useState(1);

  const [driverName, setDriverName] = useState<string>(loadStoredDriverName);
  const [vehicleConfig, setVehicleConfig] = useState<VehicleConfig>(loadStoredVehicle);
  const [selectedTrackId, setSelectedTrackId] = useState<TrackId>('desert');
  const [customSignImages, setCustomSignImages] = useState<CustomSignImagesMap>(loadStoredCustomSigns);
  const [laps, setLaps] = useState(3);
  const [aiCount, setAiCount] = useState(3);
  const [singleplayerAutoPilot, setSingleplayerAutoPilot] = useState(false);

  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraViewMode>('chase');
  const [muted, setMuted] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState<HudSnapshot>(INITIAL_HUD);
  const [finishResult, setFinishResult] = useState<{
    bestLapMs: number;
    totalRaceMs: number;
    position: number;
    standings: HudSnapshot['standings'];
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_VEHICLE_KEY, JSON.stringify(vehicleConfig));
    } catch {
      // Ignore storage quota issues
    }
  }, [vehicleConfig]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_NAME_KEY, driverName);
    } catch {
      // Ignore storage quota issues
    }
  }, [driverName]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_SIGNS_KEY, JSON.stringify(customSignImages));
    } catch {
      // Ignore storage quota issues
    }
  }, [customSignImages]);

  const handleChangeSignSlot = useCallback(
    (
      trackId: TrackId,
      slotIndex: 0 | 1 | 2,
      config: CustomSignImageConfig | null | undefined
    ) => {
      setCustomSignImages((prev) => {
        const current = prev[trackId] ?? [undefined, undefined, undefined];
        const nextSlots: [
          CustomSignImageConfig | null | undefined,
          CustomSignImageConfig | null | undefined,
          CustomSignImageConfig | null | undefined,
        ] = [current[0], current[1], current[2]];
        nextSlots[slotIndex] = config;
        return {
          ...prev,
          [trackId]: nextSlots,
        };
      });
    },
    []
  );

  const handleResetTrackSigns = useCallback((trackId: TrackId) => {
    setCustomSignImages((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
  }, []);

  // Keep multiplayer room player loadout synced if in a lobby
  useEffect(() => {
    if (network.currentRoom && network.currentRoom.status === 'lobby') {
      network.updateRoomPlayer(driverName, vehicleConfig);
    }
  }, [driverName, vehicleConfig, network.currentRoom?.id, network.currentRoom?.status]);

  // Automatically enter race when multiplayer room enters countdown / racing
  useEffect(() => {
    const room = network.currentRoom;
    if (!room) return;
    if ((room.status === 'countdown' || room.status === 'racing') && !inRace) {
      audioEngine.unlock();
      setRaceMode('multiplayer');
      setSelectedTrackId(room.trackId);
      setLaps(room.laps);
      setPaused(false);
      setFinishResult(null);
      setHud({
        ...INITIAL_HUD,
        totalLaps: room.laps,
        totalRacers: room.fillBots ? 4 : room.players.length,
        countdown: room.countdownValue ?? 3,
      });
      setRaceSessionId((id) => id + 1);
      setInRace(true);
    }
  }, [network.currentRoom?.status, network.currentRoom?.trackId, network.currentRoom?.laps, inRace, audioEngine]);

  useEffect(() => {
    return () => {
      audioEngine.dispose();
    };
  }, [audioEngine]);

  // Global keyboard shortcuts (H for dock collapse in hub, M for audio mute)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!inRace && e.code === 'KeyH' && (activeTab === 'garage' || activeTab === 'tracks')) {
        setDockCollapsed((prev) => !prev);
      } else if (e.code === 'KeyM') {
        setMuted((prev) => {
          const next = !prev;
          audioEngine.setMuted(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [inRace, activeTab, audioEngine]);

  const startSingleplayerRace = useCallback(
    (overrideTrackId?: TrackId) => {
      audioEngine.unlock();
      const targetTrack = overrideTrackId ?? selectedTrackId;
      if (overrideTrackId) setSelectedTrackId(overrideTrackId);
      setRaceMode('singleplayer');
      setPaused(false);
      setFinishResult(null);
      setHud({
        ...INITIAL_HUD,
        autoPilot: singleplayerAutoPilot,
        totalLaps: laps,
        totalRacers: 1 + aiCount,
        countdown: 3,
      });
      setRaceSessionId((id) => id + 1);
      setInRace(true);
    },
    [audioEngine, selectedTrackId, laps, aiCount, singleplayerAutoPilot]
  );

  const handleRaceAgain = useCallback(() => {
    audioEngine.unlock();
    setPaused(false);
    setFinishResult(null);
    setHud({
      ...INITIAL_HUD,
      autoPilot: raceMode === 'singleplayer' ? singleplayerAutoPilot : Boolean(network.currentRoom?.autoPilot),
      totalLaps: laps,
      totalRacers: 1 + aiCount,
      countdown: 3,
    });
    setRaceSessionId((id) => id + 1);
  }, [audioEngine, laps, aiCount, raceMode, singleplayerAutoPilot, network.currentRoom?.autoPilot]);

  const handleExitToGarage = useCallback(() => {
    setInRace(false);
    setPaused(false);
    setFinishResult(null);
    if (raceMode === 'multiplayer') {
      setActiveTab('multiplayer');
    } else {
      setActiveTab('garage');
    }
  }, [raceMode]);

  const handleCycleCamera = useCallback(() => {
    setCameraMode((prev) => (prev === 'chase' ? 'far' : prev === 'far' ? 'hood' : 'chase'));
  }, []);

  const handleToggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      audioEngine.setMuted(next);
      return next;
    });
  }, [audioEngine]);

  const handleTogglePause = useCallback(() => {
    setPaused((prev) => !prev);
  }, []);

  const handleRaceFinish = useCallback(
    (result: {
      bestLapMs: number;
      totalRaceMs: number;
      position: number;
      standings: HudSnapshot['standings'];
    }) => {
      setFinishResult(result);
      void network.submitLeaderboard({
        trackId: selectedTrackId,
        driverName: driverName || 'Driver',
        chassis: vehicleConfig.chassis,
        vehicleSummary: formatVehicleSummary(vehicleConfig),
        bestLapMs: result.bestLapMs,
        totalRaceMs: result.totalRaceMs,
        laps,
        mode: raceMode,
      });
    },
    [network, selectedTrackId, driverName, vehicleConfig, laps, raceMode]
  );

  const sceneMode: ViewportSceneMode = inRace
    ? 'race'
    : activeTab === 'tracks'
      ? 'track_preview'
      : 'showroom';

  const activeTrackMeta = TRACK_MAP[selectedTrackId];
  const vehicleStats = computeVehicleStats(vehicleConfig);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0b0d11] text-zinc-100">
      {/* Persistent 3D Three.js Viewport */}
      <RaceViewport
        sceneMode={sceneMode}
        trackId={selectedTrackId}
        customSignImages={customSignImages}
        vehicleConfig={vehicleConfig}
        driverName={driverName}
        raceMode={raceMode}
        singleplayerAutoPilot={singleplayerAutoPilot}
        totalLaps={laps}
        aiCount={aiCount}
        raceSessionId={raceSessionId}
        cameraMode={cameraMode}
        paused={paused}
        multiplayerRoom={network.currentRoom}
        clientId={network.clientId}
        multiplayerCountdown={network.countdownValue}
        remoteTelemetryRef={network.telemetryRef}
        combatEventsRef={network.combatEventsRef}
        sendWs={network.send}
        audioEngine={audioEngine}
        touchInputRef={touchInputRef}
        onHudUpdate={setHud}
        onRaceFinish={handleRaceFinish}
        onCycleCamera={handleCycleCamera}
        onTogglePause={handleTogglePause}
      />

      {/* Real-time Leaderboard Record Notification */}
      {network.latestRecordBanner && !inRace && (
        <div className="fixed top-20 right-5 z-30 px-4 py-2.5 rounded-lg bg-[#12161f]/95 border border-amber-500/50 shadow-xl">
          <div className="text-[11px] font-semibold text-amber-400">
            {network.latestRecordBanner.isTrackRecord ? 'New Track Record' : 'New Lap Posted'}
          </div>
          <div className="text-xs text-white mt-0.5 font-mono-tabular">
            {network.latestRecordBanner.entry.driverName} ·{' '}
            {TRACK_MAP[network.latestRecordBanner.entry.trackId]?.name} ·{' '}
            {formatRaceTime(network.latestRecordBanner.entry.bestLapMs)}
          </div>
        </div>
      )}

      {/* Hub Chrome (hidden during active race) */}
      {!inRace && (
        <div className="fixed inset-0 z-10 flex flex-col pointer-events-none">
          <div className="pointer-events-auto">
            <TopBar
              activeTab={activeTab}
              onSelectTab={(tab) => {
                setDockCollapsed(false);
                setActiveTab(tab);
              }}
              onQuickRace={() => startSingleplayerRace()}
            />

            {/* Mobile Secondary Navigation Strip */}
            <div className="flex md:hidden items-center gap-2 overflow-x-auto px-4 py-2 bg-[#0b0d11]/92 border-b border-white/10">
              {(['home', 'garage', 'tracks', 'multiplayer', 'leaderboards'] as HubTab[]).map(
                (t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setDockCollapsed(false);
                      setActiveTab(t);
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize whitespace-nowrap shrink-0 ${
                      activeTab === t
                        ? 'bg-amber-500 text-zinc-950 font-semibold'
                        : 'text-zinc-300'
                    }`}
                  >
                    {t}
                  </button>
                )
              )}
            </div>
          </div>

          {/* Hub Views */}
          {activeTab === 'home' && (
            <>
              <div className="px-6 pt-6 max-w-xl pointer-events-none">
                <p className="text-xs font-medium text-amber-400 mb-1.5">
                  Arrakis Championship · In Honor of the Duke
                </p>
                <h1
                  className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white leading-[1.08]"
                  style={{ textWrap: 'balance' }}
                >
                  Command the Sands. Race for the Duke.
                </h1>
              </div>

              <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-20 w-[min(940px,94vw)] bg-[#0e1118]/94 border border-white/12 rounded-xl p-4 shadow-2xl pointer-events-auto">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div className="flex flex-wrap items-center gap-5">
                    <div>
                      <label htmlFor="home-driver-name" className="block text-[11px] text-zinc-400 mb-1">
                        Driver Name
                      </label>
                      <input
                        id="home-driver-name"
                        type="text"
                        maxLength={20}
                        value={driverName}
                        onChange={(e) => setDriverName(e.target.value)}
                        className="px-3 py-1.5 text-sm font-medium text-white bg-[#161b26] border border-white/12 rounded-lg focus:outline-none focus:border-amber-500 w-40"
                      />
                    </div>

                    <div className="hidden sm:block h-9 w-px bg-white/10" />

                    <div>
                      <div className="text-[11px] text-zinc-400">Active Build</div>
                      <div className="text-sm font-semibold text-white">
                        {formatVehicleSummary(vehicleConfig)}
                      </div>
                      <div className="text-xs text-zinc-400 font-mono-tabular">
                        {vehicleStats.maxSpeedKmh} km/h · {vehicleStats.zeroToHundredSec}s 0-100
                      </div>
                    </div>

                    <div className="hidden lg:block h-9 w-px bg-white/10" />

                    <div className="hidden lg:block">
                      <div className="text-[11px] text-zinc-400">Selected Circuit</div>
                      <div className="text-sm font-semibold text-white">
                        {activeTrackMeta.name}
                      </div>
                      <div className="text-xs text-zinc-400 font-mono-tabular">
                        {laps} Laps · {aiCount === 0 ? 'Time Trial' : `${aiCount} AI Rivals`}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5">
                    <label
                      title="Line assist and stays within track limits automatically"
                      className={`inline-flex items-center gap-2 px-3 py-2.5 text-xs font-semibold rounded-lg border cursor-pointer select-none transition-colors whitespace-nowrap ${
                        singleplayerAutoPilot
                          ? 'bg-cyan-500/15 border-cyan-400/50 text-cyan-200'
                          : 'bg-[#171c26] border-white/10 text-zinc-300 hover:bg-[#1f2633]'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={singleplayerAutoPilot}
                        onChange={(e) => setSingleplayerAutoPilot(e.target.checked)}
                        className="accent-cyan-400 w-3.5 h-3.5 cursor-pointer"
                      />
                      <span>Auto Pilot</span>
                    </label>

                    <button
                      type="button"
                      onClick={() => setActiveTab('garage')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-zinc-200 bg-[#171c26] hover:bg-[#1f2633] border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      <span>Customize Car</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveTab('multiplayer')}
                      className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-zinc-200 bg-[#171c26] hover:bg-[#1f2633] border border-white/10 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Multiplayer</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => startSingleplayerRace()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-zinc-950 bg-amber-500 hover:bg-amber-400 rounded-lg transition-colors whitespace-nowrap cursor-pointer"
                    >
                      <Flag className="w-3.5 h-3.5" />
                      <span>Race Now</span>
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeTab === 'garage' && (
            <GarageDock
              vehicle={vehicleConfig}
              onChange={setVehicleConfig}
              collapsed={dockCollapsed}
              onToggleCollapse={() => setDockCollapsed((p) => !p)}
            />
          )}

          {activeTab === 'tracks' && (
            <TrackSelectorDock
              selectedTrackId={selectedTrackId}
              onSelectTrack={setSelectedTrackId}
              customSignImages={customSignImages}
              onChangeSignSlot={handleChangeSignSlot}
              onResetTrackSigns={handleResetTrackSigns}
              laps={laps}
              onChangeLaps={setLaps}
              aiCount={aiCount}
              onChangeAiCount={setAiCount}
              autoPilot={singleplayerAutoPilot}
              onChangeAutoPilot={setSingleplayerAutoPilot}
              leaderboards={network.leaderboards}
              onStartRace={() => startSingleplayerRace()}
              collapsed={dockCollapsed}
              onToggleCollapse={() => setDockCollapsed((p) => !p)}
            />
          )}

          {activeTab === 'multiplayer' && (
            <MultiplayerPanel
              connected={network.connected}
              clientId={network.clientId}
              driverName={driverName}
              onChangeDriverName={setDriverName}
              vehicle={vehicleConfig}
              rooms={network.rooms}
              currentRoom={network.currentRoom}
              roomError={network.roomError}
              onCreateRoom={network.createRoom}
              onJoinRoom={network.joinRoom}
              onLeaveRoom={network.leaveRoom}
              onToggleReady={network.setReady}
              onUpdateRoomSettings={network.updateRoomSettings}
              onStartRace={network.startRoomRace}
            />
          )}

          {activeTab === 'leaderboards' && (
            <LeaderboardPanel
              entries={network.leaderboards}
              connected={network.connected}
              currentDriverName={driverName}
              onStartRaceOnTrack={(tId) => startSingleplayerRace(tId)}
            />
          )}
        </div>
      )}

      {/* Active Race HUD */}
      {inRace && (
        <RaceHud
          hud={hud}
          track={activeTrackMeta}
          raceMode={raceMode}
          cameraMode={cameraMode}
          muted={muted}
          paused={paused}
          finishResult={finishResult}
          touchInputRef={touchInputRef}
          onCycleCamera={handleCycleCamera}
          onToggleMute={handleToggleMute}
          onTogglePause={handleTogglePause}
          onRaceAgain={handleRaceAgain}
          onExitToGarage={handleExitToGarage}
        />
      )}
    </div>
  );
}
