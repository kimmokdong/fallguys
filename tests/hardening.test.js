import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { COLORS } from '../public/catalog.js';
import { setup, client, attempt, roomWhere, ofType, barrier } from './helpers.js';

const quiet = () => { const errors = []; return { errors, log: { error: (...args) => errors.push(args) } }; };

async function rawUpgrade(url, target) {
  const { port } = new URL(url);
  const socket = net.connect(Number(port), '127.0.0.1');
  await once(socket, 'connect');
  let response = '';
  socket.on('data', (chunk) => { response += chunk; });
  socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
  await once(socket, 'close');
  return response;
}

test('잘못된 WebSocket 주소와 다른 사이트의 연결은 거절하고 서버는 계속 동작한다', async (t) => {
  const app = await setup(t, { allowedOrigins: ['https://tv.example/'] });
  for (const target of ['//[', '//%', '//a:b@:x']) {
    assert.match(await rawUpgrade(app.url, target), /^HTTP\/1\.1 400/, target);
  }
  assert.equal((await fetch(app.url + '/healthz')).status, 200, '잘못된 요청 뒤에도 서버가 살아 있다');
  assert.equal(await attempt(app.url, { origin: 'https://evil.example' }), 403, '다른 사이트의 스크립트 연결 거절');
  assert.equal(await attempt(app.url, { origin: app.url }), 'open', '같은 주소의 게임 화면은 연결');
  assert.equal(await attempt(app.url, { origin: 'https://tv.example' }), 'open', 'ALLOWED_ORIGINS에 등록한 주소는 연결');
  assert.equal(await attempt(app.url), 'open', 'Origin이 없는 도구 연결은 허용');
  const player = await client(app.url, true, { origin: app.url });
  player.send({ type: 'create', name: '정상 접속' });
  await player.wait(ofType('welcome'));
});

test('IP별 동시 접속·방 개수와 방 코드 대입 시도를 제한한다', async (t) => {
  const app = await setup(t, { limits: { maxConnectionsPerIp: 3, maxRoomsPerIp: 1, joinFailuresPerMinute: 2 } });
  const [first, second, third] = await Promise.all([client(app.url), client(app.url), client(app.url)]);
  assert.equal(await attempt(app.url), 429, '같은 IP의 네 번째 동시 연결 거절');
  first.send({ type: 'create', name: '첫 방' });
  const room = await first.wait(ofType('welcome'));
  second.send({ type: 'create', name: '두 번째 방' });
  assert.match((await second.wait(ofType('error'))).message, /너무 많습니다/);
  for (const code of ['000000', '111111']) {
    second.send({ type: 'join', code, name: '추측' });
    assert.match((await second.wait(ofType('error'))).message, /찾을 수 없습니다/);
  }
  second.send({ type: 'join', code: room.code, name: '추측' });
  assert.match((await second.wait(ofType('error'))).message, /잘못 입력/, '실패가 쌓이면 맞는 코드도 잠시 확인하지 않는다');
  third.send({ type: 'join', code: room.code, token: room.token });
  assert.equal((await third.wait(ofType('welcome'))).id, room.id, '재접속 토큰은 코드 대입 제한과 별개로 동작한다');
  second.socket.close();
  await once(second.socket, 'close');
  // 서버가 닫힘을 처리하는 즉시 자리가 돌아옵니다.
  let result;
  for (let i = 0; i < 100 && (result = await attempt(app.url)) !== 'open'; i++) await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(result, 'open', '연결을 닫으면 다시 접속할 수 있다');
});

test('프록시 뒤에서는 X-Forwarded-For의 실제 접속 IP로 한도를 적용한다', async (t) => {
  const app = await setup(t, { trustProxy: true, limits: { maxConnectionsPerIp: 1 } });
  const a = await client(app.url, true, { headers: { 'X-Forwarded-For': '203.0.113.1' } });
  assert.equal(await attempt(app.url, { headers: { 'X-Forwarded-For': '198.51.100.7, 203.0.113.2' } }), 'open', '다른 IP는 별도로 계산');
  assert.equal(await attempt(app.url, { headers: { 'X-Forwarded-For': '203.0.113.1' } }), 429, '같은 IP의 두 번째 연결 거절');
  a.socket.close();
  const direct = await setup(t, { limits: { maxConnectionsPerIp: 1 } });
  const b = await client(direct.url, true, { headers: { 'X-Forwarded-For': '203.0.113.1' } });
  assert.equal(await attempt(direct.url, { headers: { 'X-Forwarded-For': '203.0.113.9' } }), 429, '프록시를 믿지 않을 때는 헤더를 조작해도 우회할 수 없다');
  b.socket.close();
});

test('바뀐 것이 없는 요청은 방 전체에 다시 보내지 않고, 지나치게 잦은 요청은 막는다', async (t) => {
  const app = await setup(t);
  const host = await client(app.url); host.send({ type: 'create', name: '방장' });
  const opened = await host.wait(ofType('welcome'));
  const guest = await client(app.url); guest.send({ type: 'join', code: opened.code, name: '친구' });
  const joined = await guest.wait(ofType('welcome'));
  guest.send({ type: 'ready', ready: true });
  await host.wait(roomWhere((r) => r.players.some((p) => p.id === joined.id && p.ready)));
  await barrier(guest); await barrier(host);
  host.messages.length = 0; guest.messages.length = 0;
  for (const message of [{ type: 'ready', ready: true }, { type: 'choosing', choosing: false }, { type: 'customize', color: 'not-a-color' }]) guest.send(message);
  await barrier(guest); await barrier(host);
  assert.equal(host.messages.filter(ofType('room')).length, 0, '다른 참가자에게는 방송하지 않는다');
  assert.equal(guest.messages.filter(ofType('room')).length, 3, '요청한 사람에게는 현재 상태로 응답한다');
  guest.messages.length = 0;
  // 한도를 넘는 연속 클릭도 마지막 상태는 반영하고, 방 전체 방송만 모아서 보냅니다.
  for (let i = 0; i < 40; i++) guest.send({ type: 'customize', color: COLORS[i % 2 + 1].id });
  guest.send({ type: 'customize', color: COLORS[3].id });
  guest.send({ type: 'choosing', choosing: true }); guest.send({ type: 'choosing', choosing: false });
  await barrier(guest);
  const player = app.rooms.get(opened.code).players.get(joined.id);
  assert.equal(player.color, COLORS[3].id, '한도를 넘긴 마지막 클릭도 반영한다');
  assert.equal(player.choosing, false, '창을 닫은 상태가 한도에 막혀 사라지지 않는다');
  await host.wait(roomWhere((r) => r.players.some((p) => p.id === joined.id && p.color === COLORS[3].id && !p.choosing)));
  assert.ok(host.messages.filter(ofType('room')).length + 1 <= 25, '한 사람이 방 전체 방송을 폭증시키지 못한다');
  assert.equal(guest.messages.some((m) => m.type === 'error'), false, '대기실 상태 요청은 한도 안내 없이 처리한다');
  for (let i = 0; i < 25; i++) guest.send({ type: 'create', name: '반복' });
  await guest.wait((m) => m.type === 'error' && /너무 잦아요/.test(m.message));
  assert.equal(guest.socket.readyState, guest.socket.OPEN, '제한에 걸려도 연결은 유지한다');
});

test('서버 재시작 뒤 한 반이 같은 옛 방 코드로 다시 들어와도 새 방 입장은 막히지 않는다', async (t) => {
  const app = await setup(t, { limits: { joinFailuresPerMinute: 3 } });
  const students = await Promise.all(Array.from({ length: 10 }, () => client(app.url)));
  for (const student of students) {
    student.send({ type: 'join', code: '424242', token: 'old-token', name: '학생' });
    student.send({ type: 'join', code: '424242', name: '학생' });
  }
  for (const student of students) for (let i = 0; i < 2; i++) assert.match((await student.wait(ofType('error'))).message, /찾을 수 없습니다/);
  const teacher = await client(app.url); teacher.send({ type: 'create', name: '선생님' });
  const room = await teacher.wait(ofType('welcome'));
  students[0].send({ type: 'join', code: room.code, name: '학생' });
  assert.equal((await students[0].wait(ofType('welcome'))).code, room.code, '같은 옛 코드 반복은 한 번으로 센다');
  for (const code of ['111111', '222222', '333333']) { students[1].send({ type: 'join', code, name: '추측' }); await students[1].wait(ofType('error')); }
  students[1].send({ type: 'join', code: room.code, name: '추측' });
  assert.match((await students[1].wait(ofType('error'))).message, /잘못 입력/, '서로 다른 코드를 바꿔 가며 찾는 시도는 막는다');
});

test('대기실 복귀는 결과 발표 뒤에만 되고, 오래 활동이 없는 방은 정리한다', async (t) => {
  const app = await setup(t, { limits: { idleRoomMs: 500 } });
  const host = await client(app.url); host.send({ type: 'create', name: '방장' });
  const opened = await host.wait(ofType('welcome'));
  host.send({ type: 'start' }); await host.wait(roomWhere((r) => r.phase === 'playing'));
  host.send({ type: 'lobby' });
  assert.match((await host.wait(ofType('error'))).message, /결과가 나온 뒤/);
  assert.equal(app.rooms.get(opened.code).phase, 'playing', '경기 중에는 대기실로 돌려보내지 않는다');
  app.rooms.get(opened.code).endsAt = Date.now() - 1;
  await host.wait(roomWhere((r) => r.phase === 'results'));
  host.send({ type: 'lobby' });
  await host.wait(roomWhere((r) => r.phase === 'lobby' && r.rule === null && r.round === 0));
  assert.match((await host.wait(ofType('closed'), 3_000)).message, /활동이 없어/);
  assert.equal(app.rooms.size, 0);
  host.send({ type: 'create', name: '다시 시작' });
  await host.wait(ofType('welcome'));
});

test('한 방의 처리 오류는 그 방만 정리하고 다른 방과 서버는 계속 동작한다', async (t) => {
  const { errors, log } = quiet();
  const app = await setup(t, { log });
  const broken = await client(app.url); broken.send({ type: 'create', name: '고장 난 방' });
  const a = await broken.wait(ofType('welcome'));
  const healthy = await client(app.url); healthy.send({ type: 'create', name: '정상 방' });
  const b = await healthy.wait(ofType('welcome'));
  broken.send({ type: 'start' }); await broken.wait(roomWhere((r) => r.phase === 'playing'));
  app.rooms.get(a.code).course = null; // 물리 계산 중 예외를 일으킵니다.
  await broken.wait(roomWhere((r) => r.phase === 'results'));
  app.rooms.get(b.code).settings = null; // 메시지 처리 중 예외를 일으킵니다.
  healthy.send({ type: 'settings', mapId: 'random' });
  assert.match((await healthy.wait(ofType('error'))).message, /처리하지 못했습니다/);
  assert.ok(errors.length >= 2, '오류는 기록한다');
  assert.equal((await fetch(app.url + '/healthz')).status, 200);
  const next = await client(app.url); next.send({ type: 'create', name: '새 방' });
  await next.wait(ofType('welcome'));
});

test('보안 헤더와 import map 해시·방문 집계만 허용하는 CSP, 상태 확인 주소를 제공한다', async (t) => {
  const app = await setup(t);
  const page = await fetch(app.url + '/');
  const csp = page.headers.get('content-security-policy');
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(importMap).digest('base64')}'`), 'import map 해시 허용');
  assert.ok(!/unsafe-(inline|eval)/.test(csp.split(';').find((part) => part.trim().startsWith('script-src'))), '인라인·eval 스크립트 차단');
  assert.ok(csp.split(';').find(part => part.trim().startsWith('script-src')).includes('https://hsstudio.pages.dev/project-visits.js'), '방문 집계 스크립트 파일만 허용');
  assert.ok(csp.split(';').find(part => part.trim().startsWith('connect-src')).includes('https://rzystmknekmqyovifmhu.supabase.co/rest/v1/rpc/record_portal_visit'), '방문 집계 API 경로만 허용');
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "connect-src 'self' ws: wss:"]) assert.ok(csp.includes(directive), directive);
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('referrer-policy'), 'same-origin');
  const script = await fetch(app.url + '/app.js');
  assert.equal(script.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(script.headers.get('content-security-policy'), null, 'CSP는 문서에만 붙인다');
  const missing = await fetch(app.url + '/missing.html');
  assert.equal(missing.status, 404); assert.equal(missing.headers.get('x-content-type-options'), 'nosniff');
  const health = await fetch(app.url + '/healthz');
  assert.equal(health.status, 200); assert.equal(health.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await health.json(), { ok: true, rooms: 0, connections: 0 });
});


test('상태 조회의 연결 수는 방 입장 전 연결도 포함하고 종료 뒤 감소한다', async (t) => {
  const app = await setup(t), health = async () => (await fetch(app.url + '/healthz')).json();
  const member = await client(app.url);
  assert.deepEqual(await health(), { ok: true, rooms: 0, connections: 1 });
  member.send({ type: 'create', name: '접속 확인' }); await member.wait(ofType('welcome'));
  assert.deepEqual(await health(), { ok: true, rooms: 1, connections: 1 });
  const closed = once([...app.wss.clients][0], 'close');
  member.socket.close(); await closed;
  assert.equal((await health()).connections, 0);
});
