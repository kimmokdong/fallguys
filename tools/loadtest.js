#!/usr/bin/env node
// 캠프 젤리 서버 수용 인원 부하 테스트 봇입니다. 로컬·테스트 서버 전용이며 수업 중인 운영 서버에는 절대 쓰지 않습니다.
//
// 사용 예 (서버는 운영과 같은 CPU 1.5 제한으로 띄웁니다. 봇이 모두 같은 IP라 접속 한도를 완화합니다):
//   docker run -d --name jelly-load -p 127.0.0.1:3000:3000 --cpus 1.5 --memory 512m \
//     -e TRUST_PROXY=1 -e MAX_CONNECTIONS_PER_IP=2000 -e MAX_ROOMS_PER_IP=100 <이미지>
//   node tools/loadtest.js --stages 30,60,90,120,150,180 --measure 45 --container jelly-load --out loadtest.json
//
// 단계마다 30명씩 방을 채우고 모든 방을 동시에 시작한 뒤, 경기 중 상태 프레임 수신 간격과 /healthz 응답 지연을 잽니다.
// 봇은 초당 15회 이동 입력을 보내며 무작위로 방향을 바꿔 출발 지점 근처에 몰립니다(가장 무거운 경우).
// 상태 패킷은 방마다 probe 소켓 몇 개만 해석하고 나머지 소켓은 받기만 해서 봇이 병목이 되지 않게 합니다.
import http from 'node:http';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const options = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
  const [key, ...rest] = part.trim().split(/\s+/);
  return [key, rest.join(' ') || 'true'];
}));
const BASE = new URL(options.url || 'http://127.0.0.1:3000');
const STAGES = String(options.stages || '30,60,90,120,150,180').split(',').map(Number);
const MEASURE_S = Number(options.measure || 45);
const WARMUP_S = Number(options.warmup || 3);
const PROBES = Number(options.probes || 2);
const INPUT_HZ = Number(options.rate || 15);
const ROOM_SIZE = 30;
const FRAME_MS = 1000 / 15;

if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(BASE.hostname) && options['allow-remote'] !== 'true') {
  console.error(`로컬이 아닌 서버(${BASE.hostname})입니다. 운영 서버에 부하를 걸지 않도록 막았습니다. 테스트 서버라면 --allow-remote를 붙이세요.`);
  process.exit(2);
}
// 경기는 60초입니다. 한 경기 안에서 측정을 끝내야 단계별 부하가 일정합니다.
if (WARMUP_S + MEASURE_S > 55) { console.error('warmup + measure는 55초 이하여야 합니다(경기 60초).'); process.exit(2); }

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const wsUrl = `${BASE.protocol === 'https:' ? 'wss:' : 'ws:'}//${BASE.host}/?v=2`;
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
const round = (value, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

// 측정 중인 구간의 기록입니다. probe 소켓과 healthz 폴러가 여기에 쌓습니다.
const sample = { on: false, startedAt: 0, intervals: [], frames: 0, bytes: 0, playingMs: 0, health: [], healthErrors: 0, cpu: [], closes: 0, errors: [] };

class Bot {
  constructor(room, index, probe) {
    Object.assign(this, { room, index, probe, id: null, socket: null, heading: Math.random() * Math.PI * 2, turnAt: 0, lastFrame: 0 });
  }
  connect() {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(wsUrl, { perMessageDeflate: false });
      this.socket = socket;
      socket.once('open', resolve);
      socket.once('error', reject);
      socket.on('close', () => { if (sample.on) sample.closes++; });
      socket.on('message', (data, isBinary) => this.receive(data, isBinary));
    });
  }
  receive(data, isBinary) {
    if (isBinary) {
      // 상태 프레임은 probe 소켓만 헤더를 확인하고 도착 간격을 기록합니다.
      if (!this.probe || !sample.on || this.room.phase !== 'playing' || data[0] !== 0x4a) return;
      const now = performance.now();
      if (this.lastFrame) sample.intervals.push(now - this.lastFrame);
      this.lastFrame = now;
      sample.frames++; sample.bytes += data.length;
      return;
    }
    const text = data.toString();
    // probe가 아닌 소켓은 입장 확인 뒤에는 오류·종료 안내만 봅니다.
    if (this.id && !this.probe && this !== this.room.host && !text.startsWith('{"type":"error"') && !text.startsWith('{"type":"closed"')) return;
    const message = JSON.parse(text);
    if (message.type === 'welcome') { this.id = message.id; this.room.welcomed(this, message); }
    else if (message.type === 'room' && this === this.room.host) this.room.update(message.room);
    else if (message.type === 'error' || message.type === 'closed') {
      if (sample.on) sample.errors.push(message.message);
      this.room.lastError = message.message;
    }
  }
  send(data) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data)); }
  // 1~3초마다 방향을 바꾸고 가끔 점프합니다. 같은 입력이 이어져도 실제 앱처럼 매번 보냅니다.
  input(now) {
    if (now >= this.turnAt) { this.heading = Math.random() * Math.PI * 2; this.turnAt = now + 1000 + Math.random() * 2000; }
    this.send({ type: 'input', x: round(Math.cos(this.heading), 3), z: round(Math.sin(this.heading), 3), jump: Math.random() < 0.03, dive: false });
  }
}

class Room {
  constructor(index, size) {
    this.index = index;
    this.bots = Array.from({ length: size }, (_, i) => new Bot(this, i, i > 0 && i <= PROBES));
    this.host = this.bots[0];
    Object.assign(this, { code: null, phase: null, snapshot: null, waiters: [], lastError: null, timer: null });
  }
  welcomed(bot, message) { if (bot === this.host) this.code = message.code; }
  update(snapshot) {
    const was = this.phase;
    this.snapshot = snapshot; this.phase = snapshot.phase;
    if (sample.on && was === 'playing' && this.phase !== 'playing') this.endedEarly = true;
    this.waiters = this.waiters.filter(({ test, done }) => !(test(snapshot) && (done(), true)));
  }
  until(test, timeoutMs, what) {
    if (this.snapshot && test(this.snapshot)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`방 ${this.index + 1}: ${what} 대기 시간 초과 (${this.lastError || '오류 없음'})`)), timeoutMs);
      this.waiters.push({ test, done: () => { clearTimeout(timer); resolve(); } });
    });
  }
  async open() {
    await this.host.connect();
    this.host.send({ type: 'create', name: `봇${this.index + 1}-0` });
    await this.until((room) => room.players.length === 1, 5000, '방 만들기');
    // 단판 레이스·무작위 맵으로 고정합니다. 기본 탈락전은 라운드마다 인원이 줄어 부하가 일정하지 않습니다.
    this.host.send({ type: 'settings', matchMode: 'single', roundRule: 'race', mapId: 'random' });
    await this.until((room) => room.settings.matchMode === 'single', 5000, '설정');
    for (const bot of this.bots.slice(1)) {
      await bot.connect();
      bot.send({ type: 'join', code: this.code, name: `봇${this.index + 1}-${bot.index}` });
    }
    await this.until((room) => room.players.length === this.bots.length, 10_000, '전원 입장');
  }
  async toLobby() {
    if (this.phase === 'countdown' || this.phase === 'playing') await this.until((room) => room.phase === 'results', 75_000, '경기 종료');
    if (this.phase === 'results') { this.host.send({ type: 'lobby' }); await this.until((room) => room.phase === 'lobby', 5000, '대기실 복귀'); }
  }
  async start() {
    for (const bot of this.bots.slice(1)) bot.send({ type: 'ready', ready: true });
    await this.until((room) => room.players.every((p) => p.id === room.hostId || p.ready), 10_000, '전원 준비');
    this.endedEarly = false;
    this.host.send({ type: 'start' });
    await this.until((room) => room.phase === 'playing', 15_000, '경기 시작');
    // 실제 접속자들처럼 방마다 입력 주기를 어긋나게 보냅니다.
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.phase !== 'playing') return;
      const now = Date.now();
      for (const bot of this.bots) bot.input(now);
    }, 1000 / INPUT_HZ);
  }
  stopInput() { clearInterval(this.timer); this.timer = null; }
}

function healthz() {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const req = http.get(new URL('/healthz', BASE), { agent: false, timeout: 5000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ ms: performance.now() - started, body: JSON.parse(body) }));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}
async function pollHealth() {
  while (sample.on) {
    try { sample.health.push((await healthz()).ms); } catch { sample.healthErrors++; }
    await sleep(500);
  }
}
// --container를 주면 docker stats로 서버 컨테이너 CPU 사용률(100% = 1코어)을 함께 기록합니다.
function watchContainer(name) {
  if (!name) return null;
  const child = spawn('docker', ['stats', '--format', '{{.CPUPerc}}', name], { stdio: ['ignore', 'pipe', 'ignore'] });
  child.stdout.on('data', (chunk) => {
    for (const match of chunk.toString().matchAll(/([\d.]+)%/g)) if (sample.on) sample.cpu.push(Number(match[1]));
  });
  return child;
}

async function main() {
  console.log(`대상 ${BASE.href} · 단계 ${STAGES.join('→')}명 · 측정 ${MEASURE_S}s · 방마다 probe ${PROBES}개 · 입력 ${INPUT_HZ}Hz`);
  console.log('기준 서버 버전:', JSON.stringify((await healthz()).body));
  const stats = watchContainer(options.container);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const rooms = [];
  const results = [];
  try {
    for (const target of STAGES) {
      let total = rooms.reduce((sum, room) => sum + room.bots.length, 0);
      while (total < target) {
        const room = new Room(rooms.length, Math.min(ROOM_SIZE, target - total));
        await room.open();
        rooms.push(room); total += room.bots.length;
      }
      await Promise.all(rooms.map((room) => room.toLobby()));
      await Promise.all(rooms.map((room) => room.start()));
      await sleep(WARMUP_S * 1000);

      Object.assign(sample, { on: true, startedAt: performance.now(), intervals: [], frames: 0, bytes: 0, health: [], healthErrors: 0, cpu: [], closes: 0, errors: [] });
      for (const room of rooms) for (const bot of room.bots) bot.lastFrame = 0;
      loop.reset();
      const botCpu = process.cpuUsage();
      const poller = pollHealth();
      await sleep(MEASURE_S * 1000);
      sample.on = false;
      await poller;
      const botCpuUsed = process.cpuUsage(botCpu);

      const intervals = sample.intervals.sort((a, b) => a - b);
      const health = sample.health.sort((a, b) => a - b);
      const cpu = sample.cpu.sort((a, b) => a - b);
      const probes = rooms.reduce((sum, room) => sum + room.bots.filter((bot) => bot.probe).length, 0);
      const expected = probes * MEASURE_S * 1000 / FRAME_MS;
      const row = {
        players: total, rooms: rooms.length,
        frameP50: round(percentile(intervals, 0.5)), frameP95: round(percentile(intervals, 0.95)), frameP99: round(percentile(intervals, 0.99)), frameMax: round(intervals.at(-1)),
        framesDelivered: round(sample.frames / expected * 100), late100: round(intervals.filter((ms) => ms > 100).length / intervals.length * 100, 2),
        healthP50: round(percentile(health, 0.5)), healthP95: round(percentile(health, 0.95)), healthMax: round(health.at(-1)), healthErrors: sample.healthErrors,
        serverCpuAvg: cpu.length ? round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null, serverCpuMax: cpu.length ? round(cpu.at(-1)) : null,
        // 같은 방 probe가 받은 평균 패킷 크기로 전체 송신량을 어림합니다(WebSocket·TCP 헤더 제외).
        frameBytes: sample.frames ? Math.round(sample.bytes / sample.frames) : null,
        egressKBps: sample.frames ? round(sample.bytes / sample.frames * total * 15 / 1024) : null,
        botCpu: round((botCpuUsed.user + botCpuUsed.system) / 1000 / (MEASURE_S * 1000) * 100), botLoopP99: round(loop.percentile(99) / 1e6), botLoopMax: round(loop.max / 1e6),
        closes: sample.closes, errors: sample.errors.length, endedEarly: rooms.filter((room) => room.endedEarly).length,
      };
      results.push(row);
      console.log(`[${String(total).padStart(3)}명/${rooms.length}방] 프레임 p50 ${row.frameP50} p95 ${row.frameP95} p99 ${row.frameP99} 최대 ${row.frameMax}ms · 수신률 ${row.framesDelivered}% · >100ms ${row.late100}% · healthz p50 ${row.healthP50} p95 ${row.healthP95} 최대 ${row.healthMax}ms · 패킷 ${row.frameBytes}B · 서버 CPU 평균 ${row.serverCpuAvg}% 최대 ${row.serverCpuMax}% · 봇 CPU ${row.botCpu}% 루프p99 ${row.botLoopP99}ms · 끊김 ${row.closes} 오류 ${row.errors} 조기종료 ${row.endedEarly}`);
      if (sample.errors.length) console.log('  오류 예:', [...new Set(sample.errors)].slice(0, 3).join(' / '));
      rooms.forEach((room) => room.stopInput());
    }
  } finally {
    stats?.kill();
    for (const room of rooms) { room.stopInput(); for (const bot of room.bots) bot.socket?.terminate(); }
  }
  console.table(results.map((r) => ({ 인원: r.players, '프레임p50': r.frameP50, '프레임p95': r.frameP95, '프레임최대': r.frameMax, 'healthz p95': r.healthP95, 'healthz최대': r.healthMax, 'CPU평균%': r.serverCpuAvg })));
  if (options.out) await writeFile(options.out, JSON.stringify({ at: new Date().toISOString(), url: BASE.href, measureSeconds: MEASURE_S, results }, null, 2));
}

main().catch((cause) => { console.error(cause); process.exit(1); });
