import http from 'node:http';
import { stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MAPS, createCourse, createRacer, stepPlayers } from './public/world.js';
import { CHARACTERS, COLORS } from './public/catalog.js';
import { roundResults, hasNextRound, startingSlots, eliminationQuota } from './public/match.js';
import { addRoundScores } from './public/results.js';
import { StateEncoder } from './public/network.js';
import { serveAsset, SECURITY_HEADERS } from './http-assets.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.mp3': 'audio/mpeg' };
const EMPTY_INPUT = { x: 0, z: 0, jump: false, dive: false };
const MAX_PLAYERS = 30;
const validCharacter = (id) => CHARACTERS.some((item) => item.id === id);
const validColor = (id) => COLORS.some((item) => item.id === id);
const validMap = (id) => MAPS.some((item) => item.id === id);

// 운영 한도입니다. 교실처럼 공유기 하나(같은 IP) 뒤에서 30명이 함께 접속해도 여유가 있게 잡았습니다.
export const DEFAULT_LIMITS = Object.freeze({
  maxRooms: 256,
  maxConnectionsPerIp: 128,
  maxRoomsPerIp: 20,
  joinFailuresPerMinute: 60,
  messagesPerSecond: 120,
  actionsPerSecond: 10,
  actionBurst: 20,
  idleRoomMs: 60 * 60_000,
});
// 한도를 넘겨도 버리지 않고 반영하되 방 전체 방송만 모아서 보내는 대기실 상태 요청입니다.
const COALESCED = new Set(['choosing', 'ready', 'customize', 'settings', 'view']);
// 퇴장과 방장의 경기 진행 요청은 경기 단계에 따라 스스로 제한되므로 요청 한도에서 뺍니다.
const UNMETERED = new Set(['leave', 'kick', 'start', 'next', 'lobby']);
const ANNOUNCE_DELAY_MS = 250;

export function createGameServer({ reconnectGraceMs = 20_000, countdownMs = 6_000, trustProxy = false, allowedOrigins = [], limits = {}, log = console } = {}) {
  const limit = { ...DEFAULT_LIMITS, ...limits };
  const origins = new Set(allowedOrigins.map((origin) => String(origin).trim().replace(/\/+$/, '').toLowerCase()).filter(Boolean));
  // ponytail: 방은 단일 Node 프로세스의 메모리에 보관. 다중 서버 운영 때 공유 저장소를 추가한다.
  const rooms = new Map();
  const connectionsByIp = new Map();
  const joinFailures = new Map();

  function reportError(where, cause, room) {
    try { log.error(`[camp-jelly] ${where} 처리 오류${room ? ` (방 ${room.code})` : ''}`, cause); } catch { /* 기록 실패가 게임을 멈추지 않게 합니다. */ }
  }

  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/healthz') {
        res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ok: true, rooms: rooms.size, connections: wss.clients.size }));
        return;
      }
      const pathname = decodeURIComponent(url.pathname);
      let path;
      if (pathname.startsWith('/vendor/three/')) {
        const name = pathname.slice('/vendor/three/'.length);
        if (!['three.module.js', 'three.core.js'].includes(name)) throw new Error('not found');
        path = resolve(ROOT, 'node_modules/three/build', name);
      } else {
        path = resolve(PUBLIC, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!path.startsWith(PUBLIC + sep) || pathname.includes('\\') || pathname.includes('\0')) throw new Error('not found');
      }
      const info = await stat(path);
      if (!info.isFile()) throw new Error('not found');
      const musicHash = pathname.match(/^\/music\/[a-z0-9-]+\.([a-f0-9]{12})\.mp3$/)?.[1];
      await serveAsset(req, res, path, info, MIME[extname(path)] || 'application/octet-stream', musicHash);
    } catch {
      if (!res.headersSent) res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('찾을 수 없는 페이지입니다.');
    }
  });

  // 연결 수립 전에 주소·출처·접속 수를 확인합니다. 잘못된 요청이 서버 전체를 멈추지 않게 여기서 거절합니다.
  const wss = new WebSocketServer({ noServer: true, maxPayload: 2_048 });
  function clientAddress(request) {
    let address = request.socket.remoteAddress || 'unknown';
    if (trustProxy) {
      const forwarded = String(request.headers['x-forwarded-for'] || '').split(',').map((part) => part.trim()).filter(Boolean).at(-1);
      if (forwarded) address = forwarded;
    }
    return address.startsWith('::ffff:') ? address.slice(7) : address;
  }
  function originAllowed(request) {
    const origin = request.headers.origin;
    if (!origin) return true; // 브라우저가 아닌 도구는 Origin을 보내지 않습니다.
    if (origins.has(origin.replace(/\/+$/, '').toLowerCase())) return true;
    try {
      const source = new URL(origin);
      const hosts = [request.headers.host, trustProxy ? request.headers['x-forwarded-host'] : null].filter(Boolean);
      return hosts.some((host) => new URL(`${source.protocol}//${String(host).split(',')[0].trim()}`).host === source.host);
    } catch { return false; }
  }
  function abortUpgrade(socket, status, message) {
    socket.once('finish', socket.destroy);
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\nConnection: close\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(message)}\r\n\r\n${message}`);
  }
  server.on('upgrade', (request, socket, head) => {
    socket.on('error', () => {});
    try {
      let compact;
      try { compact = new URL(request.url, 'http://localhost').searchParams.get('v') === '2'; }
      catch { abortUpgrade(socket, 400, 'Bad request'); return; }
      if (!originAllowed(request)) { abortUpgrade(socket, 403, 'Origin not allowed'); return; }
      const ip = clientAddress(request);
      if ((connectionsByIp.get(ip) || 0) >= limit.maxConnectionsPerIp) { abortUpgrade(socket, 429, 'Too many connections'); return; }
      wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request, { ip, compact }));
    } catch (cause) {
      reportError('upgrade', cause);
      socket.destroy();
    }
  });

  function send(socket, data) {
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount >= 1_000_000) { socket.close(1013, 'Reconnect to sync'); return; }
    socket.send(typeof data === 'string' ? data : JSON.stringify(data));
  }
  function error(socket, message) { send(socket, { type: 'error', message }); }
  function broadcast(room, data) {
    const payload = JSON.stringify(data);
    for (const player of room.players.values()) send(player.socket, payload);
  }
  function publicPlayer(player) {
    return {
      id: player.id, netId: player.netId, name: player.name, character: player.character, color: player.color,
      connected: Boolean(player.socket), finished: player.racer?.finished || false,
      eliminated: Boolean(player.eliminated), participating: Boolean(player.racer),
      fallCount: player.racer?.fallCount || 0, ready: Boolean(player.ready), choosing: Boolean(player.choosing),
    };
  }
  function roomSnapshot(room) {
    return {
      code: room.code, hostId: room.hostId, phase: room.phase, settings: room.settings,
      players: [...room.players.values()].map(publicPlayer), mapId: room.mapId,
      startsAt: room.startsAt, endsAt: room.endsAt, resultsAt: room.resultsAt, results: room.results,
      round: room.round, scores: room.scores, rule: room.rule, quota: room.quota, isFinal: room.isFinal,
      matchOver: room.matchOver, winnerId: room.winnerId, tieBreak: room.tieBreak, standings: room.standings,
    };
  }
  function announce(room) {
    clearTimeout(room.announceTimer); room.announceTimer = null;
    broadcast(room, { type: 'room', room: roomSnapshot(room) });
  }
  // 요청이 몰리면 방 상태 방송을 짧게 모아 마지막 상태 한 번으로 보냅니다.
  function scheduleAnnounce(room) {
    if (room.announceTimer) return;
    room.announceTimer = setTimeout(() => {
      room.announceTimer = null;
      try { if (rooms.get(room.code) === room) announce(room); } catch (cause) { reportError('announce', cause, room); }
    }, ANNOUNCE_DELAY_MS);
    room.announceTimer.unref();
  }
  // 바뀐 것이 없는 요청은 방 전체에 다시 보내지 않고 요청한 사람에게만 현재 상태로 답합니다.
  function acknowledge(socket, room, changed, throttled = false) {
    if (changed) { if (throttled) scheduleAnnounce(room); else announce(room); }
    else if (!throttled) send(socket, { type: 'room', room: roomSnapshot(room) });
  }
  function state(room, now = Date.now()) {
    return {
      type: 'state', epoch: room.startsAt >>> 0, collapsed: room.course?.collapsed || {}, time: Math.max(0, (now - room.startsAt) / 1_000),
      players: [...room.players.values()].filter((p) => p.racer).map((p) => ({ id: p.id, netId: p.netId, ...p.racer })),
    };
  }
  function sendState(socket, snapshot, full = false, legacy) {
    if (socket?.readyState !== WebSocket.OPEN || socket.bufferedAmount > 128_000) return;
    if (!socket.encoder) { send(socket, legacy ?? JSON.stringify(snapshot)); return; }
    const payload = socket.encoder.encode(snapshot, socket.view?.watchId || socket.player?.id, { full, hidden: socket.view?.hidden });
    if (payload) socket.send(payload);
  }
  function broadcastState(room, now = Date.now(), full = false) {
    const snapshot = state(room, now);
    let legacy;
    for (const p of room.players.values()) {
      // 이전 JSON 클라이언트용 문자열은 한 번만 만들어 모두에게 보냅니다.
      if (p.socket && !p.socket.encoder) legacy ??= JSON.stringify(snapshot);
      sendState(p.socket, snapshot, full, legacy);
    }
  }
  function resetMatch(room) {
    Object.assign(room, {
      mapId: null, startsAt: null, endsAt: null, resultsAt: null, results: [], course: null, round: 0, scores: [], playedMaps: [],
      roundPlayers: [], eliminationHistory: [], standings: [], matchOver: false, winnerId: null, tieBreak: false, rule: null, quota: null, isFinal: false,
    });
  }
  function closeRoom(room, message) {
    rooms.delete(room.code);
    clearTimeout(room.announceTimer);
    for (const player of room.players.values()) {
      clearTimeout(player.disconnectTimer);
      const socket = player.socket;
      if (!socket) continue;
      socket.player = null; socket.room = null;
      send(socket, { type: 'closed', message });
    }
    room.players.clear();
  }
  function removePlayer(room, player) {
    clearTimeout(player.disconnectTimer);
    player.withdrawn = true; player.eliminated = true;
    if (player.racer && !player.racer.finished) { player.racer.eliminated = true; player.racer.eliminatedAt = Math.max(0, (Date.now() - room.startsAt) / 1000); }
    const result = room.results.find((row) => row.id === player.id);
    if (result) result.connected = false;
    else if (player.racer && (room.phase === 'countdown' || room.phase === 'playing')) {
      room.results.push({ ...publicPlayer(player), connected: false, rank: null, time: null, status: 'dnf' });
    }
    room.players.delete(player.id);
    if (player.socket) { player.socket.player = null; player.socket.room = null; }
    if (!room.players.size) { rooms.delete(room.code); clearTimeout(room.announceTimer); return; }
    if (room.hostId === player.id) {
      room.hostId = ([...room.players.values()].find((p) => p.socket) || room.players.values().next().value).id;
    }
    announce(room);
  }
  function attach(socket, room, player) {
    clearTimeout(player.disconnectTimer);
    player.socket = socket;
    player.choosing = false;
    player.input = { ...EMPTY_INPUT };
    player.pendingJump = false; player.pendingDive = false;
    player.lastInput = Date.now();
    socket.player = player;
    socket.room = room;
    send(socket, { type: 'welcome', id: player.id, token: player.token, code: room.code });
    announce(room);
    if (room.phase !== 'lobby') sendState(socket, state(room), true);
  }
  function makePlayer(message, randomCharacter = false) {
    const name = typeof message.name === 'string' ? [...message.name.trim().replace(/[\u0000-\u001f\u007f]/g, '')].slice(0, 16).join('') : '';
    if (!name) return null;
    return {
      id: randomUUID(), netId: 0, token: randomBytes(24).toString('hex'), name,
      character: randomCharacter ? CHARACTERS[Math.floor(Math.random() * CHARACTERS.length)].id : (validCharacter(message.character) ? message.character : CHARACTERS[0].id),
      color: validColor(message.color) ? message.color : COLORS[0].id,
      socket: null, input: { ...EMPTY_INPUT }, racer: null, ready: false,
    };
  }
  function assignCharacters(room) {
    const pool = CHARACTERS.map((item) => item.id);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    [...room.players.values()].forEach((player, i) => { player.character = pool[i % pool.length]; });
  }
  function endRound(room) {
    const time = Math.max(0, (Math.min(Date.now(), room.endsAt) - room.startsAt) / 1000);
    room.results = roundResults(room.roundPlayers, { rule: room.rule, final: room.isFinal, quota: room.quota, time });
    if (room.settings.matchMode === 'elimination') {
      const qualified = room.results.filter((r) => r.qualified && room.players.has(r.id) && !room.players.get(r.id).withdrawn);
      const survivors = new Set(qualified.map((r) => r.id));
      for (const p of room.roundPlayers) {
        p.eliminated = !survivors.has(p.id);
        const result = room.results.find((r) => r.id === p.id);
        result.qualified = !p.eliminated;
        if (p.eliminated) room.eliminationHistory.push({ ...result, eliminationRound: room.round });
      }
      room.matchOver = qualified.length <= 1;
      room.winnerId = qualified.length === 1 ? qualified[0].id : null;
      room.tieBreak = room.isFinal && qualified.length > 1;
      if (room.matchOver) {
        room.standings = [...qualified.map((r) => ({ ...r, status: 'winner', rank: 1 })), ...room.eliminationHistory.slice().sort((a, b) => b.eliminationRound - a.eliminationRound || (a.rank ?? 99) - (b.rank ?? 99))];
        room.standings.forEach((r, i) => {
          if (r.status === 'winner') return;
          const previous = room.standings[i - 1];
          const tied = previous && previous.status !== 'winner' && previous.eliminationRound === r.eliminationRound && previous.roundRank === r.rank;
          r.roundRank = r.rank; r.rank = tied ? previous.rank : i + 1; r.status = 'eliminated';
        });
      }
    } else room.scores = addRoundScores(room.scores, room.results);
    room.phase = 'results'; room.resultsAt = Date.now(); room.activeAt = room.resultsAt;
    broadcastState(room, Date.now(), true); announce(room);
  }

  function startRound(room, now) {
    const knockout = room.settings.matchMode === 'elimination';
    const participants = [...room.players.values()].filter((p) => !knockout || !p.eliminated);
    room.isFinal = knockout && participants.length <= 5;
    room.rule = knockout ? (room.tieBreak ? 'race' : room.isFinal ? (Math.random() < .5 ? 'race' : 'survival') : room.round % 2 === 0 ? 'survival' : 'race') : room.settings.matchMode === 'series' ? 'race' : room.settings.roundRule;
    let maps = MAPS.filter((m) => m.rules.includes(room.rule) && (!room.isFinal || m.final));
    const selected = MAPS.find((m) => m.id === room.settings.mapId);
    if (selected && (!knockout || room.round === 1)) {
      room.rule = selected.rules.includes(room.rule) ? room.rule : selected.rules[0];
      maps = [selected];
    }
    const unplayed = maps.filter((m) => !room.playedMaps.includes(m.id)), pool = unplayed.length ? unplayed : maps;
    room.mapId = pool[Math.floor(Math.random() * pool.length)].id;
    room.playedMaps.push(room.mapId); room.course = createCourse(room.mapId, room.rule);
    room.quota = knockout ? (room.isFinal ? 1 : eliminationQuota(participants.length, room.round)) : participants.length;
    const slots = startingSlots(participants, { mode: room.settings.matchMode, rule: room.rule, round: room.round, scores: room.scores, results: room.results });
    room.phase = 'countdown'; room.startsAt = now + countdownMs; room.endsAt = room.startsAt + room.settings.duration * 1000; room.resultsAt = null; room.results = [];
    room.resultsSignature = ''; room.resultsKey = '[]'; room.activeAt = now;
    room.tieBreak = false;
    if (room.settings.characterMode === 'random' && (!knockout || room.round === 1)) assignCharacters(room);
    for (const p of room.players.values()) { p.racer = null; p.input = { ...EMPTY_INPUT }; p.pendingJump = false; p.pendingDive = false; }
    participants.forEach((p) => { p.racer = createRacer(slots.get(p.id), participants.length, room.course.spawnY || 0); p.withdrawn = false; });
    room.roundPlayers = participants;
    announce(room); broadcastState(room, now, true);
  }

  function roomsCreatedBy(ip) {
    let count = 0;
    for (const room of rooms.values()) if (room.creatorIp === ip) count++;
    return count;
  }
  // 없는 방 코드는 IP마다 "서로 다른 코드" 수로 셉니다. 서버 재시작 뒤 한 반 30명이 같은 옛 코드로
  // 다시 들어오려 해도 1개로 계산되고, 코드를 바꿔 가며 찾는 시도만 1분에 60개로 막힙니다.
  function joinBlocked(ip, now) {
    const entry = joinFailures.get(ip);
    return Boolean(entry && entry.resetAt > now && entry.codes.size >= limit.joinFailuresPerMinute);
  }
  function recordJoinFailure(ip, code, now) {
    let entry = joinFailures.get(ip);
    if (!entry || entry.resetAt <= now) { entry = { codes: new Set(), resetAt: now + 60_000 }; joinFailures.set(ip, entry); }
    if (entry.codes.size < limit.joinFailuresPerMinute) entry.codes.add(code);
  }
  // 입력 외 요청은 소켓마다 초당 10회(순간 20회)까지 받습니다. 방 전체 방송이 한 사람 때문에 폭증하지 않습니다.
  function allowAction(socket, now) {
    socket.actionTokens = Math.min(limit.actionBurst, socket.actionTokens + (now - socket.actionAt) / 1000 * limit.actionsPerSecond);
    socket.actionAt = now;
    if (socket.actionTokens < 1) return false;
    socket.actionTokens--;
    return true;
  }

  function createRoom(socket, message, now) {
    if (rooms.size >= limit.maxRooms) { error(socket, '현재 방이 많습니다. 잠시 뒤 다시 시도해 주세요.'); return; }
    if (roomsCreatedBy(socket.clientIp) >= limit.maxRoomsPerIp) { error(socket, '같은 네트워크에서 연 방이 너무 많습니다. 사용하지 않는 방을 닫은 뒤 다시 시도해 주세요.'); return; }
    const player = makePlayer(message);
    if (!player) { error(socket, '이름을 입력해 주세요.'); return; }
    let code;
    do { code = String(randomInt(100000, 1000000)); } while (rooms.has(code));
    const room = {
      code, hostId: player.id, phase: 'lobby', players: new Map([[player.id, player]]), creatorIp: socket.clientIp, activeAt: now,
      settings: { mapId: 'random', characterMode: 'choice', duration: 60, matchMode: 'elimination', roundRule: 'race', rounds: 3 },
    };
    resetMatch(room);
    rooms.set(code, room);
    attach(socket, room, player);
  }
  function joinRoom(socket, message, now) {
    const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
    const room = rooms.get(code);
    const reconnecting = typeof message.token === 'string';
    const returning = reconnecting && room ? [...room.players.values()].find((p) => p.token === message.token) : null;
    // 방 코드 대입을 막기 위해 같은 IP가 1분에 확인할 수 있는 없는 코드 수를 제한합니다.
    // 제한 중에도 올바른 재접속 토큰은 받아 주고, 나머지는 방의 존재 여부와 관계없이 같은 안내를 보냅니다.
    if (!returning && joinBlocked(socket.clientIp, now)) { error(socket, '방 코드를 여러 번 잘못 입력했어요. 1분 뒤 다시 시도해 주세요.'); return; }
    if (!room) { recordJoinFailure(socket.clientIp, code, now); error(socket, '방을 찾을 수 없습니다. 초대 링크를 확인해 주세요.'); return; }
    room.activeAt = now;
    if (reconnecting) {
      const player = returning;
      if (player) {
        if (player.socket) {
          const previous = player.socket;
          previous.player = null; previous.room = null;
          send(previous, { type: 'error', code: 'SESSION_REPLACED', message: '다른 창에서 같은 참가자로 접속했습니다.' });
          previous.close(4001, 'Session replaced');
        }
        attach(socket, room, player);
        return;
      }
      send(socket, { type: 'error', code: 'SESSION_EXPIRED', message: '재접속 시간이 지났습니다. 이름을 입력해 다시 입장해 주세요.' });
      return;
    }
    if (room.phase !== 'lobby') { error(socket, '게임이 진행 중입니다. 방장이 대기실로 돌아오면 입장할 수 있어요.'); return; }
    if (room.players.size >= MAX_PLAYERS) { error(socket, '방이 가득 찼습니다. 최대 30명까지 입장할 수 있어요.'); return; }
    const player = makePlayer(message, room.settings.characterMode === 'random');
    if (!player) { error(socket, '이름을 입력해 주세요.'); return; }
    if (room.settings.characterMode === 'random') {
      const used = new Set([...room.players.values()].map((p) => p.character));
      const free = CHARACTERS.filter((item) => !used.has(item.id));
      if (free.length) player.character = free[Math.floor(Math.random() * free.length)].id;
    }
    player.netId = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((i) => ![...room.players.values()].some((p) => p.netId === i));
    room.players.set(player.id, player);
    attach(socket, room, player);
  }
  function handleInput(socket, message, now) {
    const { room, player } = socket;
    // 퇴장 요청 직후 도착한 이동 패킷은 조용히 버린다.
    if (!room || !player) return;
    if (room.phase !== 'playing' || !player.racer || player.eliminated || player.racer.eliminated || player.racer.finished) return;
    if (message.jump === true && !player.input.jump) player.pendingJump = true;
    if (message.dive === true && !player.input.dive) player.pendingDive = true;
    player.input = {
      x: typeof message.x === 'number' && Number.isFinite(message.x) ? Math.max(-1, Math.min(1, message.x)) : 0,
      z: typeof message.z === 'number' && Number.isFinite(message.z) ? Math.max(-1, Math.min(1, message.z)) : 0,
      jump: message.jump === true, dive: message.dive === true,
    };
    player.lastInput = now;
  }

  // 방 안에서 받는 요청입니다. host는 방장 전용, hostError는 방장이 아닐 때의 안내입니다.
  const ROOM_ACTIONS = new Map(Object.entries({
    view: { run({ socket, room, player, message, throttled }) {
      const spectator = player.eliminated || player.racer?.finished || player.racer?.eliminated;
      const target = spectator && room.players.get(message.watchId);
      const view = { hidden: message.hidden === true, watchId: target?.racer && !target.racer.eliminated ? target.id : null };
      const changed = socket.view?.hidden !== view.hidden || socket.view?.watchId !== view.watchId;
      socket.view = view;
      // 한도를 넘긴 요청은 시야만 바꾸고, 전체 상태는 2초마다 오는 정기 동기화로 맞춥니다.
      if (changed && !throttled && room.course && socket.encoder) sendState(socket, state(room), true);
    } },
    leave: { run({ socket, room, player }) { removePlayer(room, player); send(socket, { type: 'left' }); } },
    kick: { host: true, hostError: '방장만 참가자를 내보낼 수 있습니다.', run({ socket, room, player, message }) {
      if (room.phase !== 'lobby') { error(socket, '참가자 관리는 대기실에서만 가능합니다.'); return; }
      const target = room.players.get(message.playerId);
      if (!target || target.id === player.id) { error(socket, '내보낼 참가자를 다시 확인해 주세요.'); return; }
      send(target.socket, { type: 'kicked', message: '방장이 이 방에서 내보냈습니다.' });
      removePlayer(room, target);
    } },
    choosing: { run({ socket, room, player, message, throttled }) {
      if (room.phase !== 'lobby' || typeof message.choosing !== 'boolean') { error(socket, '대기실에서만 캐릭터를 고를 수 있습니다.'); return; }
      const changed = player.choosing !== message.choosing || (message.choosing && player.ready);
      player.choosing = message.choosing;
      if (player.choosing) player.ready = false;
      acknowledge(socket, room, changed, throttled);
    } },
    ready: { run({ socket, room, player, message, throttled }) {
      if (room.phase !== 'lobby' || typeof message.ready !== 'boolean') { error(socket, '대기실에서 준비 상태를 선택해 주세요.'); return; }
      if (message.ready && player.choosing) { error(socket, '캐릭터 선택을 마친 뒤 준비해 주세요.'); return; }
      const changed = player.ready !== message.ready;
      player.ready = message.ready;
      acknowledge(socket, room, changed, throttled);
    } },
    customize: { run({ socket, room, player, message, throttled }) {
      if (room.phase !== 'lobby') { error(socket, '캐릭터는 대기실에서 변경할 수 있습니다.'); return; }
      const before = `${player.character}:${player.color}`;
      if (room.settings.characterMode === 'choice' && validCharacter(message.character)) player.character = message.character;
      if (validColor(message.color)) player.color = message.color;
      const changed = before !== `${player.character}:${player.color}`;
      if (changed) player.ready = false;
      acknowledge(socket, room, changed, throttled);
    } },
    settings: { host: true, run({ socket, room, message, throttled }) {
      if (room.phase !== 'lobby') { error(socket, '게임 설정과 시작은 대기실에서만 가능합니다.'); return; }
      const before = JSON.stringify(room.settings);
      if (message.mapId !== undefined && message.mapId !== 'random' && !validMap(message.mapId)) { error(socket, '존재하지 않는 맵입니다.'); return; }
      if (message.characterMode !== undefined && !['choice', 'random'].includes(message.characterMode)) { error(socket, '캐릭터 배정 옵션이 올바르지 않습니다.'); return; }
      if (message.matchMode !== undefined && !['single', 'series', 'elimination'].includes(message.matchMode)) { error(socket, '경기 모드가 올바르지 않습니다.'); return; }
      if (message.rounds !== undefined && ![3, 5, 7].includes(message.rounds)) { error(socket, '점수전은 3판, 5판, 7판 중 선택해 주세요.'); return; }
      if (message.roundRule !== undefined && !['race', 'survival'].includes(message.roundRule)) { error(socket, '라운드 종류가 올바르지 않습니다.'); return; }
      const mode = message.matchMode ?? room.settings.matchMode;
      const rule = mode === 'series' ? 'race' : message.roundRule ?? room.settings.roundRule;
      const mapId = message.mapId ?? room.settings.mapId;
      if (mode !== 'elimination' && mapId !== 'random' && !MAPS.find((m) => m.id === mapId).rules.includes(rule)) { error(socket, '이 모드에서 사용할 수 없는 맵입니다.'); return; }
      room.settings.roundRule = rule;
      if (message.mapId !== undefined) room.settings.mapId = message.mapId;
      if (message.matchMode !== undefined) room.settings.matchMode = message.matchMode;
      if (message.rounds !== undefined) room.settings.rounds = message.rounds;
      if (message.characterMode !== undefined && room.settings.characterMode !== message.characterMode) {
        room.settings.characterMode = message.characterMode;
        if (message.characterMode === 'random') assignCharacters(room);
      }
      const changed = JSON.stringify(room.settings) !== before;
      if (changed) for (const p of room.players.values()) p.ready = false;
      // 변경이 없으면 방장 화면만 서버에서 확정한 설정으로 다시 그립니다.
      acknowledge(socket, room, changed, throttled);
    } },
    start: { host: true, run({ socket, room, now }) {
      if (room.phase !== 'lobby') { error(socket, '게임 설정과 시작은 대기실에서만 가능합니다.'); return; }
      const waiting = [...room.players.values()].filter((p) => !p.socket || p.choosing || (p.id !== room.hostId && !p.ready));
      if (waiting.length) { error(socket, `아직 ${waiting.length}명이 준비 중입니다. 모두 준비하면 시작할 수 있어요.`); return; }
      resetMatch(room);
      room.round = 1;
      for (const p of room.players.values()) { p.eliminated = false; p.withdrawn = false; }
      startRound(room, now);
    } },
    next: { host: true, run({ socket, room, now }) {
      if (room.phase !== 'results' || !hasNextRound(room)) { error(socket, '다음 라운드를 시작할 수 없습니다.'); return; }
      room.round++;
      startRound(room, now);
    } },
    lobby: { host: true, run({ socket, room }) {
      // 화면에는 결과 발표 뒤에만 버튼이 있습니다. 경기 도중 전원을 대기실로 돌려보내는 요청은 받지 않습니다.
      if (room.phase !== 'results') { error(socket, room.phase === 'lobby' ? '이미 대기실에 있습니다.' : '경기 결과가 나온 뒤 대기실로 돌아갈 수 있습니다.'); return; }
      resetMatch(room);
      room.phase = 'lobby';
      for (const p of room.players.values()) { p.racer = null; p.eliminated = false; p.withdrawn = false; p.input = { ...EMPTY_INPUT }; p.ready = false; p.choosing = false; }
      announce(room);
    } },
  }));

  function handleMessage(socket, raw, isBinary) {
    const now = Date.now();
    if (now - socket.rateAt > 1_000) { socket.rateAt = now; socket.rateCount = 0; }
    if (++socket.rateCount > limit.messagesPerSecond) { socket.close(1008, 'Too many messages'); return; }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { error(socket, '메시지 형식이 올바르지 않습니다.'); return; }
    if (isBinary || !message || typeof message !== 'object' || Array.isArray(message)) { error(socket, '메시지 형식이 올바르지 않습니다.'); return; }
    if (message.type === 'input') { handleInput(socket, message, now); return; }
    // 대기실 상태 요청은 한도를 넘어도 반영하고 방송만 모읍니다. 나머지(방 만들기·입장 등)는 거절합니다.
    const allowed = UNMETERED.has(message.type) || allowAction(socket, now);
    if (!allowed && !COALESCED.has(message.type)) { error(socket, '요청이 너무 잦아요. 잠시 후 다시 시도해 주세요.'); return; }
    if (message.type === 'create' || message.type === 'join') {
      if (socket.room) { error(socket, '이미 방에 입장해 있습니다.'); return; }
      if (message.type === 'create') createRoom(socket, message, now);
      else joinRoom(socket, message, now);
      return;
    }
    const { room, player } = socket;
    if (!room || !player) { error(socket, '먼저 방을 만들거나 입장해 주세요.'); return; }
    const action = ROOM_ACTIONS.get(message.type);
    if (!action) { error(socket, '지원하지 않는 메시지입니다.'); return; }
    if (action.host && room.hostId !== player.id) { error(socket, action.hostError || '방장만 사용할 수 있는 기능입니다.'); return; }
    room.activeAt = now;
    action.run({ socket, room, player, message, now, throttled: !allowed });
  }
  function handleClose(socket) {
    const { room, player } = socket;
    if (!room || !player || player.socket !== socket) return;
    player.socket = null;
    player.ready = false;
    player.choosing = false;
    player.input = { ...EMPTY_INPUT };
    announce(room);
    player.disconnectTimer = setTimeout(() => {
      try { if (room.players.get(player.id) === player && !player.socket) removePlayer(room, player); }
      catch (cause) { reportError('reconnect-timeout', cause, room); }
    }, reconnectGraceMs);
    player.disconnectTimer.unref();
  }

  wss.on('connection', (socket, request, meta = {}) => {
    const ip = meta.ip ?? clientAddress(request);
    connectionsByIp.set(ip, (connectionsByIp.get(ip) || 0) + 1);
    const now = Date.now();
    Object.assign(socket, { clientIp: ip, encoder: meta.compact ? new StateEncoder() : null, alive: true, rateAt: now, rateCount: 0, actionAt: now, actionTokens: limit.actionBurst });
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, isBinary) => {
      try { handleMessage(socket, raw, isBinary); }
      catch (cause) {
        reportError('message', cause, socket.room);
        error(socket, '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      }
    });
    socket.on('close', () => {
      const left = (connectionsByIp.get(ip) || 1) - 1;
      if (left > 0) connectionsByIp.set(ip, left); else connectionsByIp.delete(ip);
      try { handleClose(socket); } catch (cause) { reportError('close', cause, socket.room); }
    });
  });

  function tickRoom(room, now, dt, sendFrame) {
    if (room.phase === 'lobby' || room.phase === 'results') {
      if (now - room.activeAt > limit.idleRoomMs) closeRoom(room, '오랫동안 활동이 없어 방을 닫았습니다. 새 방을 만들어 주세요.');
      return;
    }
    if (room.phase === 'countdown' && now >= room.startsAt) { room.phase = 'playing'; announce(room); }
    if (room.phase !== 'playing') return;
    const time = (now - room.startsAt) / 1_000;
    const active = [...room.players.values()].filter((p) => p.racer && !p.racer.finished && !p.racer.eliminated);
    for (const player of active) if (now - player.lastInput > 500) { player.input = { ...EMPTY_INPUT }; player.pendingJump = false; player.pendingDive = false; }
    stepPlayers(active.map((p) => p.racer), active.map((p) => ({ ...p.input, jump: p.input.jump || p.pendingJump, dive: p.input.dive || p.pendingDive })), room.course, time, dt);
    for (const player of active) { player.pendingJump = false; player.pendingDive = false; }
    // 완주·탈락·퇴장·연결 상태가 바뀐 틱에만 결과표를 다시 계산합니다.
    let changed = false;
    const signature = room.roundPlayers.map((p) => `${+p.racer.finished}${+p.racer.eliminated}${+!!p.withdrawn}${+!!p.socket}`).join('');
    if (signature !== room.resultsSignature) {
      room.resultsSignature = signature;
      const withdrawn = new Set(room.roundPlayers.filter((p) => p.withdrawn).map((p) => p.id));
      const rows = roundResults(room.roundPlayers, { rule: room.rule, final: room.isFinal, quota: room.quota, time });
      const completed = rows.filter((r) => r.status === 'finished' || r.status === 'eliminated' || withdrawn.has(r.id));
      const key = JSON.stringify(completed);
      changed = key !== room.resultsKey;
      room.resultsKey = key; room.results = completed;
    }
    const finished = room.roundPlayers.filter((p) => p.racer.finished).length;
    const remaining = room.roundPlayers.filter((p) => !p.withdrawn && !p.racer.finished && !p.racer.eliminated);
    const enough = room.settings.matchMode === 'elimination' && room.rule === 'race' && finished >= room.quota;
    const survivalDone = room.rule === 'survival' && remaining.length <= (room.settings.matchMode === 'elimination' ? room.quota : 1) && (room.roundPlayers.length > 1 || remaining.length === 0);
    if (now >= room.endsAt || !remaining.length || enough || survivalDone) endRound(room);
    else { if (changed) announce(room); if (sendFrame) broadcastState(room, now); }
  }
  // 한 방에서 예외가 나도 다른 방과 서버는 계속 동작합니다. 경기를 마무리하지 못하면 그 방만 닫습니다.
  function recoverRoom(room) {
    try { if (room.phase === 'countdown' || room.phase === 'playing') { endRound(room); return; } }
    catch (cause) { reportError('recover', cause, room); }
    closeRoom(room, '서버 오류로 방을 닫았습니다. 새 방을 만들어 주세요.');
  }

  let previousTick = Date.now();
  let frame = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(1 / 15, Math.max(0.001, (now - previousTick) / 1_000));
    previousTick = now;
    frame++;
    for (const room of rooms.values()) {
      try { tickRoom(room, now, dt, frame % 2 === 0); }
      catch (cause) { reportError('tick', cause, room); recoverRoom(room); }
    }
  }, 1_000 / 30);
  ticker.unref();
  const heartbeat = setInterval(() => {
    try {
      for (const socket of wss.clients) {
        if (!socket.alive) { socket.terminate(); continue; }
        socket.alive = false;
        socket.ping();
      }
      const now = Date.now();
      for (const [ip, entry] of joinFailures) if (entry.resetAt <= now) joinFailures.delete(ip);
    } catch (cause) { reportError('heartbeat', cause); }
  }, 15_000);
  heartbeat.unref();

  async function close() {
    clearInterval(ticker);
    clearInterval(heartbeat);
    for (const room of rooms.values()) {
      for (const player of room.players.values()) {
        clearTimeout(player.disconnectTimer);
        if (player.socket) { player.socket.room = null; player.socket.player = null; }
      }
    }
    rooms.clear();
    for (const socket of wss.clients) socket.terminate();
    await new Promise((done) => wss.close(done));
    if (server.listening) await new Promise((done) => server.close(done));
  }
  return { server, wss, rooms, close };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const number = (value) => (Number.isInteger(Number(value)) && Number(value) > 0 ? Number(value) : undefined);
  const limits = Object.fromEntries(Object.entries({
    maxConnectionsPerIp: number(process.env.MAX_CONNECTIONS_PER_IP),
    maxRoomsPerIp: number(process.env.MAX_ROOMS_PER_IP),
    joinFailuresPerMinute: number(process.env.MAX_WRONG_CODES_PER_MINUTE),
  }).filter(([, value]) => value !== undefined));
  const game = createGameServer({
    trustProxy: ['1', 'true'].includes(String(process.env.TRUST_PROXY).toLowerCase()),
    allowedOrigins: String(process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    limits,
  });
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  game.server.listen(port, host, () => {
    console.log(`Jelly Rush: http://localhost:${game.server.address().port}`);
    console.log('같은 네트워크에서는 이 PC의 IP 주소와 포트로 접속할 수 있습니다.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => game.close().then(() => process.exit(0)));
}
