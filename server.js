import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { MAPS, createCourse, createRacer, stepPlayers } from './public/world.js';
import { CHARACTERS, COLORS } from './public/catalog.js';
import { addRoundScores } from './public/results.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const EMPTY_INPUT = { x: 0, z: 0, jump: false, dive: false };
const validCharacter = (id) => CHARACTERS.some((item) => item.id === id);
const validColor = (id) => COLORS.some((item) => item.id === id);
const validMap = (id) => MAPS.some((item) => item.id === id);

export function createGameServer({ reconnectGraceMs = 20_000, countdownMs = 6_000 } = {}) {
  // ponytail: 방은 단일 Node 프로세스의 메모리에 보관. 다중 서버 운영 때 공유 저장소를 추가한다.
  const rooms = new Map();
  const server = http.createServer(async (req, res) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    try {
      const url = new URL(req.url, 'http://localhost');
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
      res.writeHead(200, {
        'Content-Type': MIME[extname(path)] || 'application/octet-stream',
        'Content-Length': info.size,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      res.end(req.method === 'HEAD' ? undefined : await readFile(path));
    } catch {
      if (!res.headersSent) res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('찾을 수 없는 페이지입니다.');
    }
  });
  const wss = new WebSocketServer({ server, maxPayload: 2_048 });

  function send(socket, data) {
    if (socket?.readyState === WebSocket.OPEN && socket.bufferedAmount < 1_000_000) socket.send(JSON.stringify(data));
  }
  function error(socket, message) { send(socket, { type: 'error', message }); }
  function broadcast(room, data) {
    for (const player of room.players.values()) send(player.socket, data);
  }
  function publicPlayer(player) {
    return {
      id: player.id, name: player.name, character: player.character, color: player.color,
      connected: Boolean(player.socket), finished: player.racer?.finished || false,
      fallCount: player.racer?.fallCount || 0, ready: Boolean(player.ready),
    };
  }
  function roomSnapshot(room) {
    return {
      code: room.code, hostId: room.hostId, phase: room.phase, settings: room.settings,
      players: [...room.players.values()].map(publicPlayer), mapId: room.mapId,
      startsAt: room.startsAt, endsAt: room.endsAt, resultsAt: room.resultsAt, results: room.results,
      round: room.round, scores: room.scores,
    };
  }
  function announce(room) { broadcast(room, { type: 'room', room: roomSnapshot(room) }); }
  function state(room, now = Date.now()) {
    return {
      type: 'state', time: Math.max(0, (now - room.startsAt) / 1_000),
      players: [...room.players.values()].filter((p) => p.racer).map((p) => ({ id: p.id, ...p.racer })),
    };
  }
  function removePlayer(room, player) {
    clearTimeout(player.disconnectTimer);
    const result = room.results.find((row) => row.id === player.id);
    if (result) result.connected = false;
    else if (room.phase === 'countdown' || room.phase === 'playing') {
      room.results.push({ ...publicPlayer(player), connected: false, rank: null, time: null, status: 'dnf' });
    }
    room.players.delete(player.id);
    if (player.socket) { player.socket.player = null; player.socket.room = null; }
    if (!room.players.size) { rooms.delete(room.code); return; }
    if (room.hostId === player.id) {
      room.hostId = ([...room.players.values()].find((p) => p.socket) || room.players.values().next().value).id;
    }
    announce(room);
  }
  function attach(socket, room, player) {
    clearTimeout(player.disconnectTimer);
    player.socket = socket;
    player.input = { ...EMPTY_INPUT };
    player.pendingJump = false; player.pendingDive = false;
    player.lastInput = Date.now();
    socket.player = player;
    socket.room = room;
    send(socket, { type: 'welcome', id: player.id, token: player.token, code: room.code });
    announce(room);
    if (room.phase !== 'lobby') send(socket, state(room));
  }
  function makePlayer(message, randomCharacter = false) {
    const name = typeof message.name === 'string' ? [...message.name.trim().replace(/[\u0000-\u001f\u007f]/g, '')].slice(0, 16).join('') : '';
    if (!name) return null;
    return {
      id: randomUUID(), token: randomBytes(24).toString('hex'), name,
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
    room.phase = 'results';
    room.resultsAt = Date.now();
    const finished = room.results.map((row) => row.id);
    const remaining = [...room.players.values()].filter((p) => !finished.includes(p.id));
    remaining.sort((a, b) => (b.racer?.z || 0) - (a.racer?.z || 0));
    room.results.push(...remaining.map((p) => ({
      ...publicPlayer(p), rank: null, time: null, status: 'dnf',
    })));
    room.scores = addRoundScores(room.scores, room.results);
    broadcast(room, state(room));
    announce(room);
  }

  function startRound(room, now) {
    const available = MAPS.filter((map) => !room.playedMaps.includes(map.id));
    const pool = available.length ? available : MAPS;
    room.mapId = room.settings.mapId === 'random' ? pool[Math.floor(Math.random() * pool.length)].id : room.settings.mapId;
    room.playedMaps.push(room.mapId);
    room.course = createCourse(room.mapId);
    room.phase = 'countdown'; room.startsAt = now + countdownMs; room.endsAt = room.startsAt + room.settings.duration * 1_000; room.resultsAt = null; room.results = [];
    if (room.settings.characterMode === 'random') assignCharacters(room);
    [...room.players.values()].forEach((p, i) => { p.racer = createRacer(i); p.input = { ...EMPTY_INPUT }; p.pendingJump = false; p.pendingDive = false; });
    announce(room);
    broadcast(room, state(room, now));
  }

  wss.on('connection', (socket) => {
    socket.alive = true;
    socket.rateAt = Date.now();
    socket.rateCount = 0;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => {});
    socket.on('message', (raw, isBinary) => {
      const now = Date.now();
      if (now - socket.rateAt > 1_000) { socket.rateAt = now; socket.rateCount = 0; }
      if (++socket.rateCount > 120) { socket.close(1008, 'Too many messages'); return; }
      let message;
      try { message = JSON.parse(raw.toString()); } catch { error(socket, '메시지 형식이 올바르지 않습니다.'); return; }
      if (isBinary || !message || typeof message !== 'object' || Array.isArray(message)) {
        error(socket, '메시지 형식이 올바르지 않습니다.'); return;
      }
      if (message.type === 'create' || message.type === 'join') {
        if (socket.room) { error(socket, '이미 방에 입장해 있습니다.'); return; }
        if (message.type === 'create') {
          if (rooms.size >= 256) { error(socket, '현재 방이 많습니다. 잠시 뒤 다시 시도해 주세요.'); return; }
          const player = makePlayer(message);
          if (!player) { error(socket, '이름을 입력해 주세요.'); return; }
          let code;
          do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
          const room = {
            code, hostId: player.id, phase: 'lobby', players: new Map([[player.id, player]]),
            settings: { mapId: 'random', characterMode: 'choice', duration: 180, matchMode: 'single', rounds: 3 },
            mapId: null, startsAt: null, endsAt: null, resultsAt: null, results: [], course: null, round: 0, scores: [], playedMaps: [],
          };
          rooms.set(code, room);
          attach(socket, room, player);
          return;
        }
        const code = typeof message.code === 'string' ? message.code.trim().toUpperCase() : '';
        const room = rooms.get(code);
        if (!room) { error(socket, '방을 찾을 수 없습니다. 초대 링크를 확인해 주세요.'); return; }
        if (typeof message.token === 'string') {
          const player = [...room.players.values()].find((p) => p.token === message.token);
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
        if (room.players.size >= 30) { error(socket, '방이 가득 찼습니다. 최대 30명까지 입장할 수 있어요.'); return; }
        const player = makePlayer(message, room.settings.characterMode === 'random');
        if (!player) { error(socket, '이름을 입력해 주세요.'); return; }
        if (room.settings.characterMode === 'random') {
          const used = new Set([...room.players.values()].map((p) => p.character));
          const free = CHARACTERS.filter((item) => !used.has(item.id));
          if (free.length) player.character = free[Math.floor(Math.random() * free.length)].id;
        }
        room.players.set(player.id, player);
        attach(socket, room, player);
        return;
      }
      const room = socket.room;
      const player = socket.player;
      if (!room || !player) { error(socket, '먼저 방을 만들거나 입장해 주세요.'); return; }
      if (message.type === 'leave') { removePlayer(room, player); send(socket, { type: 'left' }); return; }
      if (message.type === 'input') {
        if (room.phase !== 'playing') return;
        if (message.jump === true && !player.input.jump) player.pendingJump = true;
        if (message.dive === true && !player.input.dive) player.pendingDive = true;
        player.input = {
          x: typeof message.x === 'number' && Number.isFinite(message.x) ? Math.max(-1, Math.min(1, message.x)) : 0,
          z: typeof message.z === 'number' && Number.isFinite(message.z) ? Math.max(-1, Math.min(1, message.z)) : 0,
          jump: message.jump === true, dive: message.dive === true,
        };
        player.lastInput = now;
        return;
      }
      if (message.type === 'ready') {
        if (room.phase !== 'lobby' || typeof message.ready !== 'boolean') { error(socket, '대기실에서 준비 상태를 선택해 주세요.'); return; }
        player.ready = message.ready;
        announce(room); return;
      }
      if (message.type === 'customize') {
        if (room.phase !== 'lobby') { error(socket, '캐릭터는 대기실에서 변경할 수 있습니다.'); return; }
        const before = `${player.character}:${player.color}`;
        if (room.settings.characterMode === 'choice' && validCharacter(message.character)) player.character = message.character;
        if (validColor(message.color)) player.color = message.color;
        if (before !== `${player.character}:${player.color}`) player.ready = false;
        announce(room);
        return;
      }
      if (!['settings', 'start', 'next', 'lobby'].includes(message.type)) { error(socket, '지원하지 않는 메시지입니다.'); return; }
      if (room.hostId !== player.id) { error(socket, '방장만 사용할 수 있는 기능입니다.'); return; }
      if (message.type === 'next') {
        if (room.phase !== 'results' || room.settings.matchMode !== 'series' || room.round >= room.settings.rounds) { error(socket, '다음 라운드를 시작할 수 없습니다.'); return; }
        room.round++;
        startRound(room, now);
        return;
      }
      if (message.type === 'lobby') {
        room.phase = 'lobby'; room.mapId = null; room.startsAt = null; room.endsAt = null; room.resultsAt = null; room.results = []; room.course = null;
        room.round = 0; room.scores = []; room.playedMaps = [];
        for (const p of room.players.values()) { p.racer = null; p.input = { ...EMPTY_INPUT }; p.ready = false; }
        announce(room);
        return;
      }
      if (room.phase !== 'lobby') { error(socket, '게임 설정과 시작은 대기실에서만 가능합니다.'); return; }
      if (message.type === 'settings') {
        const before = JSON.stringify(room.settings);
        if (message.mapId !== undefined && message.mapId !== 'random' && !validMap(message.mapId)) { error(socket, '존재하지 않는 맵입니다.'); return; }
        if (message.characterMode !== undefined && !['choice', 'random'].includes(message.characterMode)) { error(socket, '캐릭터 배정 옵션이 올바르지 않습니다.'); return; }
        if (message.duration !== undefined && (!Number.isInteger(message.duration) || message.duration < 120 || message.duration > 300)) { error(socket, '라운드 시간은 120초부터 300초까지 설정할 수 있습니다.'); return; }
        if (message.matchMode !== undefined && !['single', 'series'].includes(message.matchMode)) { error(socket, '경기 모드가 올바르지 않습니다.'); return; }
        if (message.rounds !== undefined && ![3, 5, 7].includes(message.rounds)) { error(socket, '점수전은 3판, 5판, 7판 중 선택해 주세요.'); return; }
        if (message.mapId !== undefined) room.settings.mapId = message.mapId;
        if (message.duration !== undefined) room.settings.duration = message.duration;
        if (message.matchMode !== undefined) room.settings.matchMode = message.matchMode;
        if (message.rounds !== undefined) room.settings.rounds = message.rounds;
        if (message.characterMode !== undefined && room.settings.characterMode !== message.characterMode) {
          room.settings.characterMode = message.characterMode;
          if (message.characterMode === 'random') assignCharacters(room);
        }
        if (JSON.stringify(room.settings) !== before) for (const p of room.players.values()) p.ready = false;
        announce(room);
        return;
      }
      const waiting = [...room.players.values()].filter(p => !p.socket || (p.id !== room.hostId && !p.ready));
      if (waiting.length) { error(socket, `아직 ${waiting.length}명이 준비 중입니다. 모두 준비하면 시작할 수 있어요.`); return; }
      room.round = 1; room.scores = []; room.playedMaps = [];
      startRound(room, now);
    });
    socket.on('close', () => {
      const { room, player } = socket;
      if (!room || !player || player.socket !== socket) return;
      player.socket = null;
      player.ready = false;
      player.input = { ...EMPTY_INPUT };
      announce(room);
      player.disconnectTimer = setTimeout(() => removePlayer(room, player), reconnectGraceMs);
      player.disconnectTimer.unref();
    });
  });

  let previousTick = Date.now();
  let frame = 0;
  const ticker = setInterval(() => {
    const now = Date.now();
    const dt = Math.min(1 / 15, Math.max(0.001, (now - previousTick) / 1_000));
    previousTick = now;
    frame++;
    for (const room of rooms.values()) {
      if (room.phase === 'countdown' && now >= room.startsAt) { room.phase = 'playing'; announce(room); }
      if (room.phase !== 'playing') continue;
      const time = (now - room.startsAt) / 1_000;
      let changed = false;
      const active = [...room.players.values()].filter((p) => !p.racer.finished);
      for (const player of active) if (now - player.lastInput > 500) { player.input = { ...EMPTY_INPUT }; player.pendingJump = false; player.pendingDive = false; }
      stepPlayers(active.map((p) => p.racer), active.map((p) => ({ ...p.input, jump: p.input.jump || p.pendingJump, dive: p.input.dive || p.pendingDive })), room.course, time, dt);
      for (const player of active) { player.pendingJump = false; player.pendingDive = false; }
      for (const player of room.players.values()) {
        if (player.racer.finished && !room.results.some((row) => row.id === player.id)) {
          const finishCount = room.results.filter((row) => row.status === 'finished').length;
          room.results.splice(finishCount, 0, { ...publicPlayer(player), rank: finishCount + 1, time: player.racer.finishTime ?? time, status: 'finished' });
          changed = true;
        }
      }
      if (now >= room.endsAt || [...room.players.values()].every((p) => p.racer.finished)) {
        endRound(room);
      } else {
        if (changed) announce(room);
        if (frame % 2 === 0) broadcast(room, state(room, now));
      }
    }
  }, 1_000 / 30);
  ticker.unref();
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (!socket.alive) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
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
  const game = createGameServer();
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  game.server.listen(port, host, () => {
    console.log(`Jelly Rush: http://localhost:${game.server.address().port}`);
    console.log('같은 네트워크에서는 이 PC의 IP 주소와 포트로 접속할 수 있습니다.');
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => game.close().then(() => process.exit(0)));
}
