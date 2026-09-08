import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createGameServer } from '../server.js';
import { MAPS } from '../public/world.js';
import { CHARACTERS, COLORS } from '../public/catalog.js';

async function setup(t, options = {}) {
  const app = createGameServer({ countdownMs: 20, reconnectGraceMs: 1_000, ...options });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  return { ...app, url: `http://127.0.0.1:${app.server.address().port}` };
}

async function client(url) {
  const socket = new WebSocket(url.replace('http:', 'ws:'));
  const messages = [];
  const waiters = new Set();
  socket.on('error', () => {});
  socket.on('message', (raw) => {
    messages.push(JSON.parse(raw));
    for (const check of [...waiters]) check();
  });
  await once(socket, 'open');
  return {
    socket, messages,
    send: (message) => socket.send(JSON.stringify(message)),
    wait(predicate, timeoutMs = 3_000) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(check); reject(new Error('메시지 대기 시간 초과')); }, timeoutMs);
        function check() {
          const index = messages.findIndex(predicate);
          if (index < 0) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve(messages.splice(index, 1)[0]);
        }
        waiters.add(check);
        check();
      });
    },
  };
}

async function prepareRoom(clients, host, total) {
  for (const member of clients) member.send({ type: 'ready', ready: true });
  await host.wait(roomWhere(r => r.players.length === total && r.players.every(p => p.id === r.hostId || p.ready)));
}

const roomWhere = (condition) => (message) => message.type === 'room' && condition(message.room);
const ofType = (type) => (message) => message.type === type;

test('30명 방, 권한, 옵션, 재접속, 서버 경기 종료와 방장 이전', async (t) => {
  const app = await setup(t);
  const host = await client(app.url);
  host.send({ type: 'create', name: '  방장  ', character: CHARACTERS[0].id, color: COLORS[0].id });
  const welcome = await host.wait(ofType('welcome'));
  const initial = await host.wait(roomWhere((room) => room.players.length === 1));
  assert.equal(initial.room.players[0].name, '방장');
  assert.equal(initial.room.hostId, welcome.id);
  assert.equal(JSON.stringify(initial.room).includes(welcome.token), false, '재접속 비밀은 다른 참가자에게 노출하지 않는다.');
  host.send({ type: 'settings', characterMode: 'random' });
  await host.wait(roomWhere((room) => room.settings.characterMode === 'random'));

  const guests = await Promise.all(Array.from({ length: 29 }, async (_, i) => {
    const guest = await client(app.url);
    guest.send({ type: 'join', code: welcome.code.toLowerCase(), name: `참가자${i + 1}`, character: CHARACTERS[i % CHARACTERS.length].id, color: COLORS[0].id });
    const joined = await guest.wait(ofType('welcome'));
    return { ...guest, ...joined };
  }));
  const full = await host.wait(roomWhere((room) => room.players.length === 30));
  assert.equal(new Set(full.room.players.map((p) => p.id)).size, 30);
  assert.equal(new Set(full.room.players.map((p) => p.character)).size, 30, '랜덤 모드에 차례로 들어온 30명도 중복 없이 배정한다.');
  const extra = await client(app.url);
  extra.send({ type: 'join', code: welcome.code, name: '31번째' });
  assert.match((await extra.wait(ofType('error'))).message, /30명/);

  const guest = guests[0];
  guest.send({ type: 'settings', mapId: MAPS[0].id });
  assert.match((await guest.wait(ofType('error'))).message, /방장/);
  guest.send({ type: 'start' });
  assert.match((await guest.wait(ofType('error'))).message, /방장/);
  host.send({ type: 'settings', mapId: 'missing-map', duration: 10 });
  assert.match((await host.wait(ofType('error'))).message, /맵/);
  assert.equal(app.rooms.get(welcome.code).settings.duration, 180, '잘못된 설정은 부분 적용하지 않는다.');
  host.send({ type: 'settings', mapId: MAPS[1].id, characterMode: 'random', duration: 120 });
  const randomized = await host.wait(roomWhere((room) => room.settings.characterMode === 'random' && room.settings.mapId === MAPS[1].id && room.settings.duration === 120));
  assert.equal(randomized.room.settings.mapId, MAPS[1].id);
  assert.equal(randomized.room.settings.duration, 120);
  assert.equal(new Set(randomized.room.players.map((p) => p.character)).size, 30, '무작위 배정은 30개 캐릭터를 중복 없이 나눈다.');
  const assigned = randomized.room.players.find((p) => p.id === guest.id).character;
  guest.send({ type: 'customize', character: CHARACTERS.find((c) => c.id !== assigned).id, color: COLORS[1].id });
  const recolored = await guest.wait(roomWhere((room) => room.players.find((p) => p.id === guest.id)?.color === COLORS[1].id));
  assert.equal(recolored.room.players.find((p) => p.id === guest.id).character, assigned);

  await prepareRoom(guests, host, app.rooms.get(welcome.code).players.size);
  host.send({ type: 'start' });
  const countdown = await host.wait(roomWhere((room) => room.phase === 'countdown'));
  assert.equal(countdown.room.mapId, MAPS[1].id);
  assert.equal(countdown.room.endsAt - countdown.room.startsAt, 120_000);
  await host.wait(roomWhere((room) => room.phase === 'playing'));
  const state = await host.wait((m) => m.type === 'state' && m.time > 0);
  assert.equal(state.players.length, 30);
  assert.ok(state.players.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)));
  extra.send({ type: 'join', code: welcome.code, name: '늦은 참가자' });
  assert.match((await extra.wait(ofType('error'))).message, /진행 중/);
  host.send({ type: 'settings', mapId: MAPS[2].id });
  assert.match((await host.wait(ofType('error'))).message, /대기실/);
  guest.send({ type: 'input', x: 999999, z: 'invalid', jump: 'true', dive: true, y: 9999, finished: true });
  await new Promise((done) => setTimeout(done, 20));
  const authoritative = app.rooms.get(welcome.code).players.get(guest.id);
  assert.deepEqual(authoritative.input, { x: 1, z: 0, jump: false, dive: true });
  assert.equal(authoritative.racer.finished, false, '클라이언트가 승리나 위치를 선언할 수 없다.');

  guest.socket.terminate();
  await host.wait(roomWhere((room) => room.players.find((p) => p.id === guest.id)?.connected === false));
  const restored = await client(app.url);
  restored.send({ type: 'join', code: welcome.code, token: guest.token, name: '이름 바꾸기 시도' });
  const reconnected = await restored.wait(ofType('welcome'));
  assert.equal(reconnected.id, guest.id);
  const restoredRoom = await restored.wait(roomWhere((room) => room.players.find((p) => p.id === guest.id)?.connected));
  assert.equal(restoredRoom.room.players.find((p) => p.id === guest.id).name, '참가자1');
  await restored.wait(ofType('state'));
  app.rooms.get(welcome.code).endsAt = Date.now() - 1;
  const results = await host.wait(roomWhere((room) => room.phase === 'results'));
  assert.equal(results.room.results.length, 30);
  assert.ok(results.room.results.every((row) => row.status === 'dnf' && row.time === null));

  host.send({ type: 'lobby' });
  await host.wait(roomWhere((room) => room.phase === 'lobby' && room.mapId === null && room.settings.characterMode === 'random'));
  host.send({ type: 'leave' });
  await host.wait(ofType('left'));
  const migrated = await restored.wait(roomWhere((room) => room.hostId === guest.id));
  assert.equal(migrated.room.players.length, 29);
  restored.send({ type: 'settings', characterMode: 'choice' });
  await restored.wait(roomWhere((room) => room.settings.characterMode === 'choice'));
  restored.send({ type: 'customize', character: CHARACTERS[2].id, color: COLORS[3].id });
  const chosen = await restored.wait(roomWhere((room) => room.players.find((p) => p.id === guest.id)?.character === CHARACTERS[2].id && room.players.find((p) => p.id === guest.id)?.color === COLORS[3].id));
  assert.equal(chosen.room.phase, 'lobby');
});

test('경기 도중 탈퇴 기록, 재접속 유예, 같은 토큰 연결 교체와 연속 완주 순위', async (t) => {
  const app = await setup(t);
  const host = await client(app.url);
  host.send({ type: 'create', name: '완주 방장' });
  const welcome = await host.wait(ofType('welcome'));
  const runners = [];
  for (const name of ['재접속 참가자', '중도 퇴장']) {
    const runner = await client(app.url);
    runner.send({ type: 'join', code: welcome.code, name });
    runners.push({ ...runner, ...await runner.wait(ofType('welcome')) });
  }
  const [returning, leaver] = runners;
  host.send({ type: 'settings', mapId: MAPS[0].id });
  await host.wait(roomWhere((room) => room.settings.mapId === MAPS[0].id));
  await prepareRoom(runners, host, app.rooms.get(welcome.code).players.size);
  host.send({ type: 'start' });
  await host.wait(roomWhere((room) => room.phase === 'playing'));
  leaver.send({ type: 'leave' });
  await leaver.wait(ofType('left'));
  returning.socket.terminate();
  await host.wait(roomWhere((room) => room.players.find((p) => p.id === returning.id)?.connected === false));
  const active = app.rooms.get(welcome.code);
  const first = active.players.get(welcome.id).racer;
  Object.assign(first, { x: 0, y: 0, z: active.course.finishZ + 1, vx: 0, vy: 0, vz: 0, grounded: true });
  const firstFinish = await host.wait(roomWhere((room) => room.results.some((row) => row.id === welcome.id && row.status === 'finished')));
  assert.equal(firstFinish.room.phase, 'playing', '재접속 유예 중인 참가자가 있으면 조기에 결과를 확정하지 않는다.');
  assert.equal(firstFinish.room.results[0].rank, 1, '먼저 탈퇴한 DNF를 완주 순위에 포함하지 않는다.');
  assert.equal(firstFinish.room.results.find((row) => row.id === leaver.id).status, 'dnf');
  const restored = await client(app.url);
  restored.send({ type: 'join', code: welcome.code, token: returning.token });
  assert.equal((await restored.wait(ofType('welcome'))).id, returning.id);
  const replacement = await client(app.url);
  const replacedClose = once(restored.socket, 'close');
  replacement.send({ type: 'join', code: welcome.code, token: returning.token });
  assert.equal((await replacement.wait(ofType('welcome'))).id, returning.id);
  assert.equal((await restored.wait(ofType('error'))).code, 'SESSION_REPLACED');
  assert.equal((await replacedClose)[0], 4001);
  assert.equal(active.players.size, 2, '연결 교체가 중복 참가자를 만들지 않는다.');
  const invalid = await client(app.url);
  invalid.send({ type: 'join', code: welcome.code, token: 'expired', name: '만료된 자리' });
  assert.equal((await invalid.wait(ofType('error'))).code, 'SESSION_EXPIRED');
  const second = active.players.get(returning.id).racer;
  Object.assign(second, { x: 0, y: 0, z: active.course.finishZ + 1, vx: 0, vy: 0, vz: 0, grounded: true });
  const final = await replacement.wait(roomWhere((room) => room.phase === 'results'));
  assert.equal(final.room.results.length, 3, '출발한 세 명 모두 결과에 한 번씩 남는다.');
  assert.equal(new Set(final.room.results.map((row) => row.id)).size, 3);
  assert.deepEqual(final.room.results.map((row) => [row.id, row.rank, row.status]), [
    [welcome.id, 1, 'finished'], [returning.id, 2, 'finished'], [leaver.id, null, 'dnf'],
  ]);
});

test('정적 파일 경계, 잘못된 메시지, 초과 크기, 연결 종료 정리', async (t) => {
  const app = await setup(t, { reconnectGraceMs: 100 });
  const home = await fetch(app.url);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  const response = await fetch(app.url + '/world.js');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/javascript/);
  for (const path of ['/server.js', '/package.json', '/%2e%2e%5cserver.js', '/vendor/three/../../server.js', '/vendor/three/../package.json', '/%00']) {
    assert.equal((await fetch(app.url + path)).status, 404, path);
  }
  assert.equal((await fetch(app.url + '/vendor/three/three.module.js')).status, 200);
  assert.equal((await fetch(app.url, { method: 'POST' })).status, 405);
  const bad = await client(app.url);
  bad.socket.send('{bad');
  assert.match((await bad.wait(ofType('error'))).message, /형식/);
  bad.send(null);
  assert.match((await bad.wait(ofType('error'))).message, /형식/);
  bad.send({ type: 'create', name: '   ' });
  assert.match((await bad.wait(ofType('error'))).message, /이름/);
  bad.send({ type: 'create', name: '한'.repeat(30) });
  const joined = await bad.wait(ofType('welcome'));
  const created = await bad.wait(roomWhere((room) => room.code === joined.code));
  assert.equal([...created.room.players[0].name].length, 16);
  bad.send({ type: '__proto__' });
  assert.match((await bad.wait(ofType('error'))).message, /지원하지/);
  const closed = once(bad.socket, 'close');
  bad.socket.send('x'.repeat(3_000));
  assert.equal((await closed)[0], 1009);
  await new Promise((done) => setTimeout(done, 160));
  assert.equal(app.rooms.size, 0, '재접속 유예 이후 빈 방을 정리한다.');
  const health = await client(app.url);
  health.send({ type: 'create', name: '정상 사용자' });
  await health.wait(ofType('welcome'));
  health.send({ type: 'leave' });
  health.send({ type: 'input', z: 1 });
  await health.wait(ofType('left'));
  health.send({ type: 'create', name: '퇴장 뒤 재입장' });
  await health.wait(ofType('welcome'));
  assert.equal(health.messages.some(m => m.type === 'error'), false, '퇴장 뒤 도착한 이동 입력은 불필요한 안내를 띄우지 않는다.');
});

test('3판 누적 점수전: 라운드 전환 권한, 맵 중복 방지, 점수 누적과 초기화', async (t) => {
  const app = await setup(t);
  const host = await client(app.url); host.send({ type: 'create', name: '방장' });
  const welcome = await host.wait(ofType('welcome'));
  const guest = await client(app.url); guest.send({ type: 'join', code: welcome.code, name: '친구' });
  const joined = await guest.wait(ofType('welcome'));
  host.send({ type: 'settings', matchMode: 'series', rounds: 3 });
  await host.wait(roomWhere((r) => r.settings.matchMode === 'series'));
  host.send({ type: 'settings', rounds: 4 });
  assert.match((await host.wait(ofType('error'))).message, /3판/);
  await prepareRoom([guest], host, app.rooms.get(welcome.code).players.size);
  host.send({ type: 'start' });
  const maps = new Set();
  for (let round = 1; round <= 3; round++) {
    await host.wait(roomWhere((r) => r.phase === 'playing' && r.round === round));
    const active = app.rooms.get(welcome.code); maps.add(active.mapId);
    const finisher = active.players.get(round === 1 ? welcome.id : joined.id);
    Object.assign(finisher.racer, { x: 0, y: 0, z: active.course.finishZ + 1, vy: 0 });
    await host.wait(roomWhere((r) => r.round === round && r.results.some((row) => row.status === 'finished')));
    active.endsAt = Date.now() - 1;
    const result = await host.wait(roomWhere((r) => r.phase === 'results' && r.round === round));
    assert.ok(Number.isFinite(result.room.resultsAt));
    assert.equal(result.room.scores.find((r) => r.id === welcome.id).score, 2);
    assert.equal(result.room.scores.find((r) => r.id === joined.id).score, (round - 1) * 2);
    guest.send({ type: 'next' }); assert.match((await guest.wait(ofType('error'))).message, /방장/);
    if (round < 3) host.send({ type: 'next' });
  }
  assert.equal(maps.size, 3);
  assert.equal(app.rooms.get(welcome.code).scores[0].id, joined.id, '누적 점수로 역전 우승한다');
  host.send({ type: 'next' }); assert.match((await host.wait(ofType('error'))).message, /다음 라운드/);
  host.send({ type: 'lobby' });
  const lobby = await host.wait(roomWhere((r) => r.phase === 'lobby' && r.round === 0 && r.scores.length === 0 && r.settings.matchMode === 'series'));
  assert.equal(lobby.room.settings.matchMode, 'series');
});

test('실제 WebSocket 경기에서도 플레이어 충돌이 서버 상태에 반영된다', async (t) => {
  const app = await setup(t);
  const host = await client(app.url); host.send({ type: 'create', name: '밀기' });
  const welcome = await host.wait(ofType('welcome'));
  const guest = await client(app.url); guest.send({ type: 'join', code: welcome.code, name: '막기' });
  const joined = await guest.wait(ofType('welcome'));
  host.send({ type: 'settings', mapId: 'jelly-garden' });
  await host.wait(roomWhere((r) => r.settings.mapId === 'jelly-garden'));
  await prepareRoom([guest], host, app.rooms.get(welcome.code).players.size);
  host.send({ type: 'start' }); await host.wait(roomWhere((r) => r.phase === 'playing'));
  const room = app.rooms.get(welcome.code);
  Object.assign(room.players.get(welcome.id).racer, { x: 0, z: 20 });
  Object.assign(room.players.get(joined.id).racer, { x: 0, z: 22 });
  host.send({ type: 'input', z: 1 }); guest.send({ type: 'input', z: -1 });
  await new Promise((resolve) => setTimeout(resolve, 350));
  host.messages.length = 0;
  const packet = await host.wait(ofType('state'));
  const a = packet.players.find((p) => p.id === welcome.id), b = packet.players.find((p) => p.id === joined.id);
  assert.ok(b.z - a.z >= 1.28, '접속한 참가자끼리 서로 관통하지 않는다');
  assert.ok(a.bumpTime > 0 && b.bumpTime > 0, '충돌 피드백도 양쪽에 전달한다');
});

test('준비 확인은 서버에서 강제하며 옵션·캐릭터 변경과 재접속은 재확인이 필요하다', async (t) => {
  const app = await setup(t);
  const host = await client(app.url); host.send({ type: 'create', name: '준비 방장' });
  const welcome = await host.wait(ofType('welcome'));
  const guest = await client(app.url); guest.send({ type: 'join', code: welcome.code, name: '준비 친구' });
  const joined = await guest.wait(ofType('welcome'));
  const active = app.rooms.get(welcome.code);
  host.send({ type: 'start' });
  assert.match((await host.wait(ofType('error'))).message, /1명이 준비/);
  guest.send({ type: 'ready', ready: 'true' });
  assert.match((await guest.wait(ofType('error'))).message, /준비 상태/);
  assert.equal(active.players.get(joined.id).ready, false);
  await prepareRoom([guest], host, 2);
  host.messages.length = 0;
  host.send({ type: 'settings', mapId: active.settings.mapId });
  await host.wait(roomWhere(r => r.players.some(p => p.id === joined.id && p.ready)));
  host.send({ type: 'settings', mapId: 'blink-trail' });
  await host.wait(roomWhere(r => r.settings.mapId === 'blink-trail' && r.players.every(p => !p.ready)));
  await prepareRoom([guest], host, 2);
  host.messages.length = 0;
  guest.send({ type: 'customize', color: COLORS[2].id });
  await host.wait(roomWhere(r => r.players.some(p => p.id === joined.id && p.color === COLORS[2].id && !p.ready)));
  await prepareRoom([guest], host, 2);
  host.messages.length = 0;
  guest.socket.terminate();
  await host.wait(roomWhere(r => r.players.some(p => p.id === joined.id && !p.connected && !p.ready)));
  host.send({ type: 'start' });
  assert.match((await host.wait(ofType('error'))).message, /준비/);
  const restored = await client(app.url);
  restored.send({ type: 'join', code: welcome.code, token: joined.token });
  await restored.wait(ofType('welcome'));
  assert.equal(active.players.get(joined.id).ready, false);
  await prepareRoom([restored], host, 2);
  host.send({ type: 'start' });
  await host.wait(roomWhere(r => r.phase === 'playing'));
  restored.send({ type: 'ready', ready: false });
  assert.match((await restored.wait(ofType('error'))).message, /대기실/);
  active.endsAt = Date.now() - 1;
  await host.wait(roomWhere(r => r.phase === 'results'));
  host.messages.length = 0;
  host.send({ type: 'lobby' });
  await host.wait(roomWhere(r => r.phase === 'lobby' && r.round === 0 && r.players.every(p => !p.ready)));
});

test('한 틱 안에서 눌렀다 뗀 점프도 한 번 실행하고 계속 누르기는 반복하지 않는다', async (t) => {
  const app = await setup(t);
  const host = await client(app.url); host.send({ type: 'create', name: '빠른 점프' });
  const welcome = await host.wait(ofType('welcome'));
  host.send({ type: 'start' }); await host.wait(roomWhere(r => r.phase === 'playing'));
  host.send({ type: 'input', jump: true }); host.send({ type: 'input', jump: false });
  await host.wait(m => m.type === 'state' && m.players[0].jumpCount === 1 && m.players[0].y > 0);
  const player = app.rooms.get(welcome.code).players.get(welcome.id);
  assert.equal(player.input.jump, false);
  await new Promise(resolve => setTimeout(resolve, 1000));
  assert.equal(player.racer.y, 0);
  host.send({ type: 'input', jump: true });
  const keepHeld = setInterval(() => host.send({ type: 'input', jump: true }), 100);
  t.after(() => clearInterval(keepHeld));
  await new Promise(resolve => setTimeout(resolve, 1200));
  clearInterval(keepHeld);
  assert.equal(player.racer.jumpCount, 2);
  assert.equal(player.racer.y, 0);
});
