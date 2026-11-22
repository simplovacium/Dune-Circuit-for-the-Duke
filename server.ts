import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import type {
  ClientWsMessage,
  LeaderboardEntry,
  MultiplayerRoomState,
  MultiplayerRoomSummary,
  RoomPlayerInfo,
  RoomTelemetryPacket,
  ServerWsMessage,
  TrackId,
  VehicleConfig,
} from './src/shared/types.ts';
import { TRACK_MAP } from './src/shared/tracks.ts';
import { DEFAULT_VEHICLE_CONFIG } from './src/shared/vehicles.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.join(__dirname, 'data');
const LEADERBOARD_FILE = path.join(DATA_DIR, 'leaderboards.json');

function ensureDataFile(): LeaderboardEntry[] {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LEADERBOARD_FILE)) {
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  try {
    const raw = fs.readFileSync(LEADERBOARD_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

let leaderboardEntries: LeaderboardEntry[] = ensureDataFile();

function saveLeaderboards() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(LEADERBOARD_FILE, JSON.stringify(leaderboardEntries, null, 2), 'utf-8');
  } catch (err) {
    console.error('Failed to persist leaderboards:', err);
  }
}

function recordLeaderboardEntry(input: {
  trackId: TrackId;
  driverName: string;
  chassis: LeaderboardEntry['chassis'];
  vehicleSummary: string;
  bestLapMs: number;
  totalRaceMs: number;
  laps: number;
  mode: LeaderboardEntry['mode'];
}): { entry: LeaderboardEntry; isTrackRecord: boolean } | null {
  if (!TRACK_MAP[input.trackId]) return null;
  if (!Number.isFinite(input.bestLapMs) || input.bestLapMs < 6000) return null;
  if (!Number.isFinite(input.totalRaceMs) || input.totalRaceMs < 6000) return null;

  const cleanName = String(input.driverName || 'Driver')
    .trim()
    .slice(0, 24) || 'Driver';

  const existingTrackBest = leaderboardEntries
    .filter((e) => e.trackId === input.trackId)
    .reduce((min, e) => Math.min(min, e.bestLapMs), Infinity);

  const isTrackRecord = input.bestLapMs < existingTrackBest;

  const entry: LeaderboardEntry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    trackId: input.trackId,
    driverName: cleanName,
    chassis: input.chassis,
    vehicleSummary: String(input.vehicleSummary || input.chassis).slice(0, 60),
    bestLapMs: Math.round(input.bestLapMs),
    totalRaceMs: Math.round(input.totalRaceMs),
    laps: Math.max(1, Math.min(10, Math.round(input.laps || 3))),
    mode: input.mode === 'multiplayer' ? 'multiplayer' : 'singleplayer',
    createdAt: new Date().toISOString(),
  };

  leaderboardEntries.push(entry);
  // Keep fastest 300 entries overall to keep payload crisp
  leaderboardEntries.sort((a, b) => a.bestLapMs - b.bestLapMs);
  if (leaderboardEntries.length > 300) {
    leaderboardEntries = leaderboardEntries.slice(0, 300);
  }
  saveLeaderboards();
  return { entry, isTrackRecord };
}

interface InternalRoom {
  id: string;
  name: string;
  trackId: TrackId;
  laps: number;
  status: 'lobby' | 'countdown' | 'racing' | 'finished';
  maxPlayers: number;
  fillBots: boolean;
  autoPilot: boolean;
  hostId: string;
  players: Map<string, RoomPlayerInfo>;
  telemetry: Map<string, RoomTelemetryPacket>;
  botTelemetry: RoomTelemetryPacket[];
  countdownValue: number | null;
  raceStartEpochMs: number | null;
  countdownTimer: NodeJS.Timeout | null;
  telemetryTimer: NodeJS.Timeout | null;
}

interface ClientSession {
  id: string;
  ws: WebSocket;
  roomId: string | null;
}

const clients = new Map<string, ClientSession>();
const rooms = new Map<string, InternalRoom>();

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return rooms.has(code) ? generateRoomCode() : code;
}

function sendToClient(ws: WebSocket, msg: ServerWsMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcastAll(msg: ServerWsMessage) {
  const payload = JSON.stringify(msg);
  for (const client of clients.values()) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function getRoomSummaries(): MultiplayerRoomSummary[] {
  return Array.from(rooms.values()).map((r) => ({
    id: r.id,
    name: r.name,
    trackId: r.trackId,
    laps: r.laps,
    status: r.status,
    playerCount: r.players.size,
    maxPlayers: r.maxPlayers,
    fillBots: r.fillBots,
    autoPilot: r.autoPilot,
  }));
}

function toPublicRoomState(room: InternalRoom): MultiplayerRoomState {
  return {
    id: room.id,
    name: room.name,
    trackId: room.trackId,
    laps: room.laps,
    status: room.status,
    playerCount: room.players.size,
    maxPlayers: room.maxPlayers,
    fillBots: room.fillBots,
    autoPilot: room.autoPilot,
    hostId: room.hostId,
    players: Array.from(room.players.values()).sort((a, b) => a.gridSlot - b.gridSlot),
    countdownValue: room.countdownValue,
    raceStartEpochMs: room.raceStartEpochMs,
  };
}

function broadcastRoomList() {
  broadcastAll({ type: 'rooms:list', rooms: getRoomSummaries() });
}

function broadcastRoomState(room: InternalRoom) {
  const msg: ServerWsMessage = { type: 'room:state', room: toPublicRoomState(room) };
  for (const playerId of room.players.keys()) {
    const client = clients.get(playerId);
    if (client) sendToClient(client.ws, msg);
  }
}

function broadcastRoomTelemetry(room: InternalRoom) {
  const packets: RoomTelemetryPacket[] = [
    ...Array.from(room.telemetry.values()),
    ...room.botTelemetry,
  ];
  if (packets.length === 0) return;
  const msg: ServerWsMessage = { type: 'race:telemetry', players: packets };
  const raw = JSON.stringify(msg);
  for (const playerId of room.players.keys()) {
    const client = clients.get(playerId);
    if (client && client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(raw);
    }
  }
}

function cleanupRoomTimers(room: InternalRoom) {
  if (room.countdownTimer) {
    clearInterval(room.countdownTimer);
    room.countdownTimer = null;
  }
  if (room.telemetryTimer) {
    clearInterval(room.telemetryTimer);
    room.telemetryTimer = null;
  }
}

function reassignGridSlots(room: InternalRoom) {
  let slot = 0;
  for (const p of room.players.values()) {
    p.gridSlot = slot++;
  }
}

function leaveCurrentRoom(session: ClientSession) {
  if (!session.roomId) return;
  const room = rooms.get(session.roomId);
  session.roomId = null;
  sendToClient(session.ws, { type: 'room:state', room: null });

  if (!room) return;
  room.players.delete(session.id);
  room.telemetry.delete(session.id);

  if (room.players.size === 0) {
    cleanupRoomTimers(room);
    rooms.delete(room.id);
    broadcastRoomList();
    return;
  }

  if (room.hostId === session.id) {
    const nextHost = room.players.values().next().value as RoomPlayerInfo | undefined;
    if (nextHost) {
      room.hostId = nextHost.id;
      nextHost.isHost = true;
    }
  }

  if (room.status === 'lobby') {
    reassignGridSlots(room);
  }
  broadcastRoomState(room);
  broadcastRoomList();
}

function startRoomRace(room: InternalRoom) {
  if (room.status === 'countdown' || room.status === 'racing') return;
  cleanupRoomTimers(room);
  room.status = 'countdown';
  room.countdownValue = 3;
  room.telemetry.clear();
  room.botTelemetry = [];
  broadcastRoomState(room);
  broadcastRoomList();

  for (const playerId of room.players.keys()) {
    const client = clients.get(playerId);
    if (client) sendToClient(client.ws, { type: 'race:countdown', value: 3 });
  }

  room.countdownTimer = setInterval(() => {
    if (!rooms.has(room.id)) {
      cleanupRoomTimers(room);
      return;
    }
    const next = (room.countdownValue ?? 1) - 1;
    room.countdownValue = next;

    if (next > 0) {
      for (const playerId of room.players.keys()) {
        const client = clients.get(playerId);
        if (client) sendToClient(client.ws, { type: 'race:countdown', value: next });
      }
      broadcastRoomState(room);
    } else {
      if (room.countdownTimer) {
        clearInterval(room.countdownTimer);
        room.countdownTimer = null;
      }
      room.status = 'racing';
      room.countdownValue = null;
      room.raceStartEpochMs = Date.now();
      broadcastRoomState(room);
      broadcastRoomList();

      for (const playerId of room.players.keys()) {
        const client = clients.get(playerId);
        if (client) {
          sendToClient(client.ws, {
            type: 'race:started',
            startEpochMs: room.raceStartEpochMs,
          });
        }
      }

      room.telemetryTimer = setInterval(() => {
        if (!rooms.has(room.id) || room.status !== 'racing') return;
        broadcastRoomTelemetry(room);
      }, 40);
    }
  }, 1000);
}

async function bootstrap() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, rooms: rooms.size, leaderboardCount: leaderboardEntries.length });
  });

  app.get('/api/leaderboards', (req, res) => {
    const trackId = req.query.trackId as string | undefined;
    const mode = req.query.mode as string | undefined;
    let list = leaderboardEntries;
    if (trackId && trackId !== 'all') {
      list = list.filter((e) => e.trackId === trackId);
    }
    if (mode && mode !== 'all') {
      list = list.filter((e) => e.mode === mode);
    }
    res.json({ entries: list.slice(0, 100) });
  });

  app.post('/api/leaderboards', (req, res) => {
    const result = recordLeaderboardEntry(req.body ?? {});
    if (!result) {
      res.status(400).json({ error: 'Invalid leaderboard payload' });
      return;
    }
    broadcastAll({ type: 'leaderboards:sync', entries: leaderboardEntries.slice(0, 100) });
    broadcastAll({
      type: 'leaderboard:new_record',
      entry: result.entry,
      isTrackRecord: result.isTrackRecord,
    });
    res.status(201).json(result);
  });

  app.get('/api/rooms', (_req, res) => {
    res.json({ rooms: getRoomSummaries() });
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    const clientId = `p_${Math.random().toString(36).slice(2, 10)}`;
    const session: ClientSession = { id: clientId, ws, roomId: null };
    clients.set(clientId, session);

    sendToClient(ws, { type: 'connected', clientId });
    sendToClient(ws, { type: 'rooms:list', rooms: getRoomSummaries() });
    sendToClient(ws, { type: 'leaderboards:sync', entries: leaderboardEntries.slice(0, 100) });

    ws.on('message', (raw) => {
      let msg: ClientWsMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientWsMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case 'rooms:subscribe': {
          sendToClient(ws, { type: 'rooms:list', rooms: getRoomSummaries() });
          break;
        }

        case 'room:create': {
          leaveCurrentRoom(session);
          const roomId = generateRoomCode();
          const trackId = TRACK_MAP[msg.trackId] ? msg.trackId : 'desert';
          const laps = Math.max(1, Math.min(10, Math.round(msg.laps || 3)));
          const cleanName = String(msg.roomName || `${msg.driverName || 'Host'}'s Grid`).trim().slice(0, 32) || 'Ducal Grid';
          const driverName = String(msg.driverName || 'Driver').trim().slice(0, 20) || 'Driver';

          const hostPlayer: RoomPlayerInfo = {
            id: clientId,
            name: driverName,
            ready: true,
            isHost: true,
            gridSlot: 0,
            vehicle: msg.vehicle || DEFAULT_VEHICLE_CONFIG,
          };

          const room: InternalRoom = {
            id: roomId,
            name: cleanName,
            trackId,
            laps,
            status: 'lobby',
            maxPlayers: 4,
            fillBots: Boolean(msg.fillBots),
            autoPilot: Boolean(msg.autoPilot),
            hostId: clientId,
            players: new Map([[clientId, hostPlayer]]),
            telemetry: new Map(),
            botTelemetry: [],
            countdownValue: null,
            raceStartEpochMs: null,
            countdownTimer: null,
            telemetryTimer: null,
          };

          rooms.set(roomId, room);
          session.roomId = roomId;
          broadcastRoomState(room);
          broadcastRoomList();
          break;
        }

        case 'room:join': {
          const code = String(msg.roomId || '').trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            sendToClient(ws, { type: 'room:error', message: `Room ${code} was not found.` });
            return;
          }
          if (room.status !== 'lobby') {
            sendToClient(ws, { type: 'room:error', message: 'Race already in progress in that room.' });
            return;
          }
          if (room.players.size >= room.maxPlayers) {
            sendToClient(ws, { type: 'room:error', message: 'That room is currently full (4/4).' });
            return;
          }

          leaveCurrentRoom(session);
          const driverName = String(msg.driverName || 'Driver').trim().slice(0, 20) || 'Driver';
          const player: RoomPlayerInfo = {
            id: clientId,
            name: driverName,
            ready: false,
            isHost: false,
            gridSlot: room.players.size,
            vehicle: msg.vehicle || DEFAULT_VEHICLE_CONFIG,
          };
          room.players.set(clientId, player);
          session.roomId = room.id;
          broadcastRoomState(room);
          broadcastRoomList();
          break;
        }

        case 'room:leave': {
          leaveCurrentRoom(session);
          break;
        }

        case 'room:ready': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.status !== 'lobby') return;
          const player = room.players.get(clientId);
          if (!player) return;
          player.ready = Boolean(msg.ready);
          broadcastRoomState(room);
          break;
        }

        case 'room:update_player': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room) return;
          const player = room.players.get(clientId);
          if (!player) return;
          player.name = String(msg.driverName || player.name).trim().slice(0, 20) || 'Driver';
          if (msg.vehicle) player.vehicle = msg.vehicle;
          broadcastRoomState(room);
          break;
        }

        case 'room:update_settings': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.hostId !== clientId || room.status !== 'lobby') return;
          if (TRACK_MAP[msg.trackId]) room.trackId = msg.trackId;
          room.laps = Math.max(1, Math.min(10, Math.round(msg.laps || 3)));
          room.fillBots = Boolean(msg.fillBots);
          room.autoPilot = Boolean(msg.autoPilot);
          broadcastRoomState(room);
          broadcastRoomList();
          break;
        }

        case 'room:start': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.hostId !== clientId || room.status !== 'lobby') return;
          startRoomRace(room);
          break;
        }

        case 'race:input_state': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.status !== 'racing') return;
          const player = room.players.get(clientId);
          if (!player) return;

          room.telemetry.set(clientId, {
            playerId: clientId,
            name: player.name,
            x: msg.x,
            y: msg.y,
            z: msg.z,
            heading: msg.heading,
            speedKmh: msg.speedKmh,
            steer: msg.steer,
            lap: msg.lap,
            progress: msg.progress,
            totalProgress: msg.totalProgress,
            finished: msg.finished,
            finishTimeMs: msg.finishTimeMs,
            bestLapMs: msg.bestLapMs,
            nitroActive: msg.nitroActive,
            spiceActive: Boolean(msg.spiceActive),
            flatTire: Boolean(msg.flatTire),
            vehicle: player.vehicle,
          });

          if (room.hostId === clientId && Array.isArray(msg.bots)) {
            room.botTelemetry = msg.bots;
          }

          // Check if all human players finished
          const allHumanFinished = Array.from(room.players.keys()).every(
            (pid) => room.telemetry.get(pid)?.finished === true
          );
          if (allHumanFinished && room.players.size > 0) {
            broadcastRoomTelemetry(room);
            room.status = 'finished';
            cleanupRoomTimers(room);
            broadcastRoomState(room);
            broadcastRoomList();
            // Reset room to lobby after 6 seconds so players can rematch
            setTimeout(() => {
              const activeRoom = rooms.get(room.id);
              if (activeRoom && activeRoom.status === 'finished') {
                activeRoom.status = 'lobby';
                activeRoom.raceStartEpochMs = null;
                activeRoom.telemetry.clear();
                activeRoom.botTelemetry = [];
                for (const p of activeRoom.players.values()) {
                  p.ready = p.isHost;
                }
                broadcastRoomState(activeRoom);
                broadcastRoomList();
              }
            }, 6000);
          }
          break;
        }

        case 'race:fire': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.status !== 'racing') return;
          if (!room.players.has(clientId)) return;
          const firedMsg: ServerWsMessage = {
            type: 'race:fired',
            shooterId: clientId,
            x: Number(msg.x) || 0,
            y: Number(msg.y) || 0,
            z: Number(msg.z) || 0,
            heading: Number(msg.heading) || 0,
            speedMs: Number(msg.speedMs) || 0,
          };
          for (const pid of room.players.keys()) {
            if (pid === clientId) continue;
            const targetClient = clients.get(pid);
            if (targetClient) sendToClient(targetClient.ws, firedMsg);
          }
          break;
        }

        case 'race:hit': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.status !== 'racing') return;
          const shooter = room.players.get(clientId);
          if (!shooter) return;
          const targetId = String(msg.targetId || '');
          if (!targetId || targetId === clientId) return;
          const hitMsg: ServerWsMessage = {
            type: 'race:hit_applied',
            shooterId: clientId,
            shooterName: shooter.name,
            targetId,
          };
          for (const pid of room.players.keys()) {
            const targetClient = clients.get(pid);
            if (targetClient) sendToClient(targetClient.ws, hitMsg);
          }
          break;
        }

        case 'race:worm_event': {
          if (!session.roomId) return;
          const room = rooms.get(session.roomId);
          if (!room || room.status !== 'racing') return;
          if (!room.players.has(clientId)) return;
          const wormMsg: ServerWsMessage = {
            type: 'race:worm_event',
            senderId: clientId,
            action: msg.action === 'shot' ? 'shot' : 'spawn',
            sampleIndex: Math.max(0, Math.round(Number(msg.sampleIndex) || 0)),
            direction: msg.direction === -1 ? -1 : 1,
          };
          for (const pid of room.players.keys()) {
            if (pid === clientId) continue;
            const targetClient = clients.get(pid);
            if (targetClient) sendToClient(targetClient.ws, wormMsg);
          }
          break;
        }

        case 'leaderboard:submit': {
          const result = recordLeaderboardEntry(msg);
          if (result) {
            broadcastAll({
              type: 'leaderboards:sync',
              entries: leaderboardEntries.slice(0, 100),
            });
            broadcastAll({
              type: 'leaderboard:new_record',
              entry: result.entry,
              isTrackRecord: result.isTrackRecord,
            });
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      leaveCurrentRoom(session);
      clients.delete(clientId);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    let viteMiddlewares: express.RequestHandler | null = null;
    const viteReady = createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    })
      .then((vite) => {
        viteMiddlewares = vite.middlewares;
      })
      .catch((err) => {
        console.error('Failed to initialize Vite dev middleware:', err);
      });

    app.use(async (req, res, next) => {
      if (!viteMiddlewares) {
        await viteReady;
      }
      if (viteMiddlewares) {
        viteMiddlewares(req, res, next);
      } else {
        res.status(503).send('Vite dev middleware unavailable');
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const getArgValue = (flag: string): string | undefined => {
    const idx = process.argv.indexOf(flag);
    if (idx !== -1 && idx + 1 < process.argv.length) {
      return process.argv[idx + 1];
    }
    const prefix = `${flag}=`;
    const match = process.argv.find((arg) => arg.startsWith(prefix));
    return match ? match.slice(prefix.length) : undefined;
  };

  const cliPort = Number(getArgValue('--port'));
  const envPort = Number(process.env.PORT);
  const defaultDevPort = Number(process.env.DEFAULT_APP_PORT) || 3000;
  const port =
    Number.isFinite(cliPort) && cliPort > 0
      ? cliPort
      : process.env.NODE_ENV !== 'production' && (!Number.isFinite(envPort) || envPort === 8080)
        ? defaultDevPort
        : Number.isFinite(envPort) && envPort > 0
          ? envPort
          : 3000;
  const host = getArgValue('--host') || '0.0.0.0';

  server.on('error', (err) => {
    console.error(`Server failed to listen on ${host}:${port}:`, err);
    process.exit(1);
  });

  server.listen(port, host, () => {
    console.log(`Dune Circuit for the Duke server listening on http://localhost:${port}`);
  });
}

bootstrap();
