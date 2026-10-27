#!/usr/bin/env node
// 캠프 페인트 서버 수용 인원 부하 테스트 봇입니다. 로컬·테스트 서버 전용이며 수업 중인 운영 서버에는 절대 쓰지 않습니다.
// 같은 서버를 나눠 쓰는 캠프 젤리의 SERVER_CAPACITY를 정하려고 이 레포에 둡니다(tools/loadtest.js와 같은 측정 방식).
//
// 사용 예 (페인트 레포에서 이미지를 만들고 운영 compose와 같은 CPU 1.2·메모리 256MB 제한으로 띄웁니다):
//   docker run -d --name paint-load -p 127.0.0.1:3001:3001 --cpus 1.2 --memory 256m \
//     -e NODE_ENV=production -e ALLOWED_ORIGINS=http://localhost:5173 -e CAPACITY_POLICY=players-plus-host -e METRICS_TOKEN=loadtest <이미지>
//   node tools/loadtest-paint.js --stages 30,60,90,120 --measure 45 --container paint-load --token loadtest --out paint.json
//
// 방마다 관전 방장 1명 + 플레이어 30명(6팀)이 들어가 경기를 시작하고, 플레이어는 초당 20회 이동·발사 입력을 보냅니다.
// 상태 프레임(정상 100ms 간격)은 방마다 플레이어 probe 소켓 몇 개만 확인하고, 단계 사이에는 방장이 경기를 끝내고 다시 시작합니다.
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { WebSocket } from 'ws';

const options = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((part) => {
  const [key, ...rest] = part.trim().split(/\s+/);
  return [key, rest.join(' ') || 'true'];
}));
const BASE = new URL(options.url || 'http://127.0.0.1:3001');
const ORIGIN = options.origin || 'http://localhost:5173';
const STAGES = String(options.stages || '30,60,90,120').split(',').map(Number);
const MEASURE_S = Number(options.measure || 45);
const WARMUP_S = Number(options.warmup || 3);
const PROBES = Number(options.probes || 2);
const INPUT_HZ = Number(options.rate || 20);
const ROOM_SIZE = 30;
const FRAME_MS = 100;
const PROTOCOL = 4;

if (!['127.0.0.1', 'localhost', '::1', '[::1]'].includes(BASE.hostname) && options['allow-remote'] !== 'true') {
  console.error(`로컬이 아닌 서버(${BASE.hostname})입니다. 운영 서버에 부하를 걸지 않도록 막았습니다. 테스트 서버라면 --allow-remote를 붙이세요.`);
  process.exit(2);
}

// --insecure: 로컬 Caddy(tls internal)처럼 자체 서명 인증서를 쓰는 테스트 프록시를 거칠 때만 씁니다.
const TLS = options.insecure === 'true' ? { rejectUnauthorized: false } : {};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const wsUrl = `${BASE.protocol === 'https:' ? 'wss:' : 'ws:'}//${BASE.host}/ws`;
const percentile = (sorted, p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN);
const round = (value, digits = 1) => (Number.isFinite(value) ? Number(value.toFixed(digits)) : null);

const sample = { on: false, intervals: [], frames: 0, bytes: 0, health: [], healthErrors: 0, cpu: [], closes: 0, errors: [] };

class Bot {
  constructor(room, index, probe) {
    Object.assign(this, { room, index, probe, id: null, socket: null, seq: 0, heading: Math.random() * Math.PI * 2, turnAt: 0, lastFrame: 0 });
  }
  connect(first) {
    return new Promise((resolve, reject) => {
      // 브라우저처럼 permessage-deflate를 협상합니다. 서버가 1KB 넘는 메시지를 압축하므로 운영과 같은 비용이 듭니다.
      const socket = new WebSocket(wsUrl, { ...TLS, origin: ORIGIN });
      this.socket = socket;
      this.welcome = new Promise((done) => { this.welcomed = done; });
      socket.once('open', () => { this.send({ ...first, protocol: PROTOCOL }); resolve(); });
      socket.once('error', reject);
      socket.on('close', () => { if (sample.on) sample.closes++; });
      socket.on('message', (data) => this.receive(data));
    });
  }
  receive(data) {
    if (this === this.room.host) { this.room.update(JSON.parse(data.toString())); return; }
    const text = data.toString();
    if (text.startsWith('{"type":"frame3"')) {
      if (!this.probe || !sample.on || this.room.phase !== 'playing') return;
      const now = performance.now();
      if (this.lastFrame) sample.intervals.push(now - this.lastFrame);
      this.lastFrame = now;
      sample.frames++; sample.bytes += data.length;
      return;
    }
    // 경기 이벤트·상태는 probe가 아닌 소켓에서 해석하지 않습니다. 입장 확인과 오류만 봅니다.
    if (this.id && !text.startsWith('{"type":"error"')) return;
    const message = JSON.parse(text);
    if (message.type === 'welcome') { this.id = message.id; this.welcomed(message); }
    else if (message.type === 'error') { if (sample.on) sample.errors.push(message.message); this.room.lastError = message.message; }
  }
  send(data) { if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(data)); }
  // 1~3초마다 방향을 바꾸며 계속 물풍선을 쏩니다. 실제 화면처럼 입력마다 번호를 올립니다.
  input(now) {
    if (now >= this.turnAt) { this.heading = Math.random() * Math.PI * 2; this.turnAt = now + 1000 + Math.random() * 2000; }
    this.send({ type: 'input', x: round(Math.cos(this.heading), 3), z: round(Math.sin(this.heading), 3), yaw: round(this.heading + Math.sin(now / 700), 3), fire: true, seq: ++this.seq });
  }
}

class Room {
  constructor(index, size) {
    this.index = index;
    this.host = new Bot(this, 0, false);
    this.players = Array.from({ length: size }, (_, i) => new Bot(this, i + 1, i < PROBES));
    Object.assign(this, { code: null, phase: null, waiters: [], lastError: null, timer: null });
  }
  get bots() { return [this.host, ...this.players]; }
  update(message) {
    if (message.type === 'welcome') { this.code = message.code; this.host.id = message.id; this.host.welcomed(message); return; }
    if (message.type === 'error') { if (sample.on) sample.errors.push(message.message); this.lastError = message.message; return; }
    if (!message.phase) return;
    if (sample.on && this.phase === 'playing' && message.phase !== 'playing') this.endedEarly = true;
    this.phase = message.phase;
    if (message.players) this.roster = message.players;
    this.waiters = this.waiters.filter(({ test, done }) => !(test(this) && (done(), true)));
  }
  until(test, timeoutMs, what) {
    if (test(this)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`방 ${this.index + 1}: ${what} 대기 시간 초과 (${this.lastError || '오류 없음'})`)), timeoutMs);
      this.waiters.push({ test, done: () => { clearTimeout(timer); resolve(); } });
    });
  }
  async open() {
    // 교실처럼 선생님이 관전 방장으로 방을 열고 6팀 2분 경기로 설정합니다.
    await this.host.connect({ type: 'create', profile: { name: `봇${this.index + 1}방장`, role: 'spectator' }, settings: { teamCount: 6, duration: 120 } });
    await this.host.welcome;
    for (const bot of this.players) {
      await bot.connect({ type: 'join', code: this.code, profile: { name: `봇${this.index + 1}-${bot.index}` } });
      await bot.welcome;
    }
    await this.until((room) => room.roster?.length === this.players.length + 1, 10_000, '전원 입장');
  }
  async toLobby() {
    if (this.phase === 'countdown' || this.phase === 'playing') { this.host.send({ type: 'end', phase: this.phase }); await this.until((room) => room.phase !== 'playing' && room.phase !== 'countdown', 10_000, '경기 종료'); }
    if (this.phase === 'results') { this.host.send({ type: 'lobby' }); await this.until((room) => room.phase === 'lobby', 10_000, '대기실 복귀'); }
  }
  async start() {
    for (const bot of this.players) bot.send({ type: 'ready', ready: true });
    await this.until((room) => room.roster?.every((p) => p.role !== 'player' || p.ready), 10_000, '전원 준비');
    this.endedEarly = false;
    this.host.send({ type: 'start', confirmWarnings: true });
    await this.until((room) => room.phase === 'playing', 15_000, '경기 시작');
    clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (this.phase !== 'playing') return;
      const now = Date.now();
      for (const bot of this.players) bot.input(now);
    }, 1000 / INPUT_HZ);
  }
  stopInput() { clearInterval(this.timer); this.timer = null; }
}

function health(auth = false) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const headers = auth && options.token ? { Authorization: `Bearer ${options.token}` } : {};
    const req = (BASE.protocol === 'https:' ? https : http).get(new URL('/health', BASE), { ...TLS, agent: false, timeout: 5000, headers }, (res) => {
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
    try { sample.health.push((await health()).ms); } catch { sample.healthErrors++; }
    await sleep(500);
  }
}
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
  console.log('기준 서버 상태:', JSON.stringify((await health()).body));
  const stats = watchContainer(options.container);
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  const rooms = [];
  const results = [];
  try {
    for (const target of STAGES) {
      let total = rooms.reduce((sum, room) => sum + room.players.length, 0);
      while (total < target) {
        const room = new Room(rooms.length, Math.min(ROOM_SIZE, target - total));
        await room.open();
        rooms.push(room); total += room.players.length;
      }
      await Promise.all(rooms.map((room) => room.toLobby()));
      await Promise.all(rooms.map((room) => room.start()));
      await sleep(WARMUP_S * 1000);

      Object.assign(sample, { on: true, intervals: [], frames: 0, bytes: 0, health: [], healthErrors: 0, cpu: [], closes: 0, errors: [] });
      for (const room of rooms) for (const bot of room.players) bot.lastFrame = 0;
      loop.reset();
      const before = options.token ? (await health(true)).body : null;
      const botCpu = process.cpuUsage();
      const poller = pollHealth();
      await sleep(MEASURE_S * 1000);
      sample.on = false;
      await poller;
      const after = options.token ? (await health(true)).body : null;
      const botCpuUsed = process.cpuUsage(botCpu);

      const intervals = sample.intervals.sort((a, b) => a - b);
      const healthMs = sample.health.sort((a, b) => a - b);
      const cpu = sample.cpu.sort((a, b) => a - b);
      const probes = rooms.reduce((sum, room) => sum + room.players.filter((bot) => bot.probe).length, 0);
      const expected = probes * MEASURE_S * 1000 / FRAME_MS;
      const ticks = after && before ? after.ticks - before.ticks : 0;
      const row = {
        players: total, connections: total + rooms.length, rooms: rooms.length,
        frameP50: round(percentile(intervals, 0.5)), frameP95: round(percentile(intervals, 0.95)), frameP99: round(percentile(intervals, 0.99)), frameMax: round(intervals.at(-1)),
        framesDelivered: round(sample.frames / expected * 100), late150: round(intervals.filter((ms) => ms > 150).length / intervals.length * 100, 2),
        healthP50: round(percentile(healthMs, 0.5)), healthP95: round(percentile(healthMs, 0.95)), healthMax: round(healthMs.at(-1)), healthErrors: sample.healthErrors,
        // 서버 자체 지표: 틱 처리 평균(20Hz 예산 50ms), 처리한 틱 비율(100% = 초당 20틱).
        tickMs: ticks ? round((after.tickMsTotal - before.tickMsTotal) / ticks, 2) : null, tickRate: ticks ? round(ticks / MEASURE_S / 20 * 100) : null,
        serverCpuAvg: cpu.length ? round(cpu.reduce((a, b) => a + b, 0) / cpu.length) : null, serverCpuMax: cpu.length ? round(cpu.at(-1)) : null,
        egressKBps: after && before ? round((after.sentWireBytes - before.sentWireBytes) / MEASURE_S / 1024) : null,
        botCpu: round((botCpuUsed.user + botCpuUsed.system) / 1000 / (MEASURE_S * 1000) * 100), botLoopP99: round(loop.percentile(99) / 1e6),
        closes: sample.closes, errors: sample.errors.length, endedEarly: rooms.filter((room) => room.endedEarly).length,
      };
      results.push(row);
      console.log(`[${String(total).padStart(3)}명/${rooms.length}방] 프레임 p50 ${row.frameP50} p95 ${row.frameP95} p99 ${row.frameP99} 최대 ${row.frameMax}ms · 수신률 ${row.framesDelivered}% · >150ms ${row.late150}% · health p50 ${row.healthP50} p95 ${row.healthP95} 최대 ${row.healthMax}ms · 틱 ${row.tickMs}ms(${row.tickRate}%) · 서버 CPU 평균 ${row.serverCpuAvg}% 최대 ${row.serverCpuMax}% · 송신 ${row.egressKBps}KB/s · 봇 CPU ${row.botCpu}% 루프p99 ${row.botLoopP99}ms · 끊김 ${row.closes} 오류 ${row.errors} 조기종료 ${row.endedEarly}`);
      if (sample.errors.length) console.log('  오류 예:', [...new Set(sample.errors)].slice(0, 3).join(' / '));
      rooms.forEach((room) => room.stopInput());
    }
  } finally {
    stats?.kill();
    for (const room of rooms) { room.stopInput(); for (const bot of room.bots) bot.socket?.terminate(); }
  }
  console.table(results.map((r) => ({ 인원: r.players, '프레임p50': r.frameP50, '프레임p95': r.frameP95, '프레임최대': r.frameMax, 'health p95': r.healthP95, '틱ms': r.tickMs, 'CPU평균%': r.serverCpuAvg })));
  if (options.out) await writeFile(options.out, JSON.stringify({ at: new Date().toISOString(), url: BASE.href, measureSeconds: MEASURE_S, results }, null, 2));
}

main().catch((cause) => { console.error(cause); process.exit(1); });
