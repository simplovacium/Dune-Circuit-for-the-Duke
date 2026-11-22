import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientWsMessage,
  LeaderboardEntry,
  MultiplayerRoomState,
  MultiplayerRoomSummary,
  RoomTelemetryPacket,
  ServerWsMessage,
  TrackId,
  VehicleConfig,
} from '../shared/types.ts';

export type CombatNetworkEvent = Extract<
  ServerWsMessage,
  { type: 'race:fired' | 'race:hit_applied' | 'race:worm_event' }
>;

export interface RacingNetworkState {
  connected: boolean;
  clientId: string | null;
  rooms: MultiplayerRoomSummary[];
  currentRoom: MultiplayerRoomState | null;
  roomError: string | null;
  countdownValue: number | null;
  raceStartEpochMs: number | null;
  remoteTelemetry: RoomTelemetryPacket[];
  leaderboards: LeaderboardEntry[];
  latestRecordBanner: { entry: LeaderboardEntry; isTrackRecord: boolean } | null;
}

export function useRacingNetwork() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const telemetryRef = useRef<RoomTelemetryPacket[]>([]);
  const combatEventsRef = useRef<CombatNetworkEvent[]>([]);

  const [state, setState] = useState<RacingNetworkState>({
    connected: false,
    clientId: null,
    rooms: [],
    currentRoom: null,
    roomError: null,
    countdownValue: null,
    raceStartEpochMs: null,
    remoteTelemetry: [],
    leaderboards: [],
    latestRecordBanner: null,
  });

  const send = useCallback((msg: ClientWsMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  useEffect(() => {
    let active = true;

    // Initial REST fetch for leaderboards & rooms
    fetch('/api/leaderboards')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (active && data?.entries) {
          setState((prev) => ({ ...prev, leaderboards: data.entries }));
        }
      })
      .catch(() => {});

    const connect = () => {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setState((prev) => ({ ...prev, connected: true, roomError: null }));
        ws.send(JSON.stringify({ type: 'rooms:subscribe' } satisfies ClientWsMessage));
      };

      ws.onmessage = (event) => {
        if (!active) return;
        let msg: ServerWsMessage;
        try {
          msg = JSON.parse(event.data) as ServerWsMessage;
        } catch {
          return;
        }

        switch (msg.type) {
          case 'connected':
            setState((prev) => ({ ...prev, clientId: msg.clientId }));
            break;
          case 'rooms:list':
            setState((prev) => ({ ...prev, rooms: msg.rooms }));
            break;
          case 'room:state':
            setState((prev) => ({
              ...prev,
              currentRoom: msg.room,
              roomError: null,
              countdownValue: msg.room?.countdownValue ?? null,
              raceStartEpochMs: msg.room?.raceStartEpochMs ?? null,
            }));
            break;
          case 'room:error':
            setState((prev) => ({ ...prev, roomError: msg.message }));
            break;
          case 'race:countdown':
            setState((prev) => ({ ...prev, countdownValue: msg.value }));
            break;
          case 'race:started':
            setState((prev) => ({
              ...prev,
              countdownValue: 0,
              raceStartEpochMs: msg.startEpochMs,
            }));
            break;
          case 'race:telemetry':
            telemetryRef.current = msg.players;
            setState((prev) => ({ ...prev, remoteTelemetry: msg.players }));
            break;
          case 'race:fired':
          case 'race:hit_applied':
          case 'race:worm_event':
            combatEventsRef.current.push(msg);
            break;
          case 'leaderboards:sync':
            setState((prev) => ({ ...prev, leaderboards: msg.entries }));
            break;
          case 'leaderboard:new_record':
            setState((prev) => ({
              ...prev,
              latestRecordBanner: { entry: msg.entry, isTrackRecord: msg.isTrackRecord },
            }));
            window.setTimeout(() => {
              if (active) {
                setState((prev) => ({ ...prev, latestRecordBanner: null }));
              }
            }, 5000);
            break;
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setState((prev) => ({ ...prev, connected: false }));
        reconnectTimerRef.current = window.setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, []);

  const createRoom = useCallback(
    (params: {
      roomName: string;
      trackId: TrackId;
      laps: number;
      fillBots: boolean;
      autoPilot: boolean;
      driverName: string;
      vehicle: VehicleConfig;
    }) => {
      send({ type: 'room:create', ...params });
    },
    [send]
  );

  const joinRoom = useCallback(
    (roomId: string, driverName: string, vehicle: VehicleConfig) => {
      send({ type: 'room:join', roomId, driverName, vehicle });
    },
    [send]
  );

  const leaveRoom = useCallback(() => {
    telemetryRef.current = [];
    combatEventsRef.current = [];
    send({ type: 'room:leave' });
  }, [send]);

  const setReady = useCallback(
    (ready: boolean) => {
      send({ type: 'room:ready', ready });
    },
    [send]
  );

  const updateRoomPlayer = useCallback(
    (driverName: string, vehicle: VehicleConfig) => {
      send({ type: 'room:update_player', driverName, vehicle });
    },
    [send]
  );

  const updateRoomSettings = useCallback(
    (trackId: TrackId, laps: number, fillBots: boolean, autoPilot: boolean) => {
      send({ type: 'room:update_settings', trackId, laps, fillBots, autoPilot });
    },
    [send]
  );

  const startRoomRace = useCallback(() => {
    send({ type: 'room:start' });
  }, [send]);

  const submitLeaderboard = useCallback(
    async (payload: {
      trackId: TrackId;
      driverName: string;
      chassis: VehicleConfig['chassis'];
      vehicleSummary: string;
      bestLapMs: number;
      totalRaceMs: number;
      laps: number;
      mode: 'singleplayer' | 'multiplayer';
    }) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        send({ type: 'leaderboard:submit', ...payload });
      } else {
        await fetch('/api/leaderboards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {});
      }
    },
    [send]
  );

  return {
    ...state,
    telemetryRef,
    combatEventsRef,
    send,
    createRoom,
    joinRoom,
    leaveRoom,
    setReady,
    updateRoomPlayer,
    updateRoomSettings,
    startRoomRace,
    submitLeaderboard,
  };
}
