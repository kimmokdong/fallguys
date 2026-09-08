import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, createCourse, createRacer, stepPlayer, stepPlayers, obstaclePose, platformActive, platformTiming } from '../public/world.js';

test('12개 코스의 30명 시작점, 체크포인트, 결승점이 실제 발판 위에 있다', () => {
  assert.equal(MAPS.length, 12);
  assert.equal(new Set(MAPS.map((m) => m.id)).size, 12);
  const signatures = new Set();
  for (const map of MAPS) {
    const course = createCourse(map.id);
    const hasFloor = ({ x, y, z }) => course.platforms.some((p) => p.type !== 'disappear' && Math.abs(x - p.x) < p.w / 2 && Math.abs(z - p.z) < p.d / 2 && Math.abs(y - p.y) < 0.1);
    for (let i = 0; i < 30; i++) assert.ok(hasFloor(createRacer(i)), `${map.id} 시작 ${i}`);
    for (const checkpoint of course.checkpoints) assert.ok(hasFloor(checkpoint), `${map.id} 체크포인트`);
    assert.ok(hasFloor({ x: 0, y: 0, z: course.finishZ }), `${map.id} 결승점`);
    signatures.add(JSON.stringify([course.platforms, course.obstacles.map(({ id, ...o }) => o)]));
    for (const obstacle of course.obstacles) {
      for (const t of [0, 1, 4, 20]) assert.ok(Object.values(obstaclePose(obstacle, t)).every((v) => typeof v === 'boolean' || Number.isFinite(v)));
    }
  }
  assert.equal(signatures.size, 12, '맵마다 실제 구조가 달라야 합니다');
});

test('이동, 대각선 속도, 점프 에지, 다이브, 낙하 복귀와 완주 판정', () => {
  const course = createCourse('jelly-garden');
  course.obstacles = [];
  const run = (p, input, frames, start = 0) => { for (let i = 0; i < frames; i++) stepPlayer(p, input, course, start + i / 30, 1 / 30); };
  const forward = createRacer(); run(forward, { z: 1 }, 30);
  assert.ok(forward.z > 10 && forward.z < 13);
  const diagonal = createRacer(); run(diagonal, { x: 1, z: 1 }, 30);
  assert.ok(Math.abs(Math.hypot(diagonal.vx, diagonal.vz) - 10) < 0.01);
  const jumper = createRacer(); run(jumper, { jump: true }, 10);
  assert.ok(jumper.y > 1.5);
  run(jumper, { jump: true }, 60, 1 / 3);
  assert.equal(jumper.y, 0, '누르고 있으면 연속 점프하지 않습니다');
  run(jumper, { jump: false }, 1); run(jumper, { jump: true }, 1);
  assert.ok(jumper.vy > 0);
  const diver = createRacer(); run(diver, { dive: true, z: 1 }, 1);
  assert.ok(diver.vz > 15);
  const fallen = createRacer(); fallen.checkpoint = 0; fallen.y = -12;
  run(fallen, {}, 1);
  assert.equal(fallen.fallCount, 1); assert.equal(fallen.z, course.checkpoints[0].z);
  const finisher = createRacer(); finisher.z = course.finishZ + 1;
  run(finisher, {}, 1, 42);
  assert.equal(finisher.finished, true); assert.equal(finisher.finishTime, 42);
});

test('장애물은 실제 충돌하고 사라지는 발판은 실제로 발을 놓친다', () => {
  const course = createCourse('jelly-garden');
  course.obstacles = [{ id: 'wall', type: 'wall', x: 0, z: 15, y: 0, w: 24, d: 1, h: 3, speed: 0, phase: 0, range: 0 }];
  const racer = createRacer(); racer.x = 0;
  for (let i = 0; i < 90; i++) stepPlayer(racer, { z: 1 }, course, i / 30, 1 / 30);
  assert.ok(racer.z <= 14, '벽을 관통하지 않습니다');
  const blink = createCourse('blink-trail');
  const tile = blink.platforms.find((p) => p.type === 'disappear');
  assert.equal(platformActive(tile, 0), true); assert.equal(platformActive(tile, 4), false);
  const falling = createRacer(); falling.x = tile.x; falling.z = tile.z;
  stepPlayer(falling, {}, blink, 4, 1 / 30);
  assert.ok(falling.y < 0); assert.equal(falling.grounded, false);
});

test('플레이어가 서로 막고 밀며, 다이빙 충격·높이차·복귀 보호를 처리한다', () => {
  const course = createCourse('jelly-garden'); course.obstacles = [];
  const pair = () => [Object.assign(createRacer(0), { x: 0, z: 20 }), Object.assign(createRacer(1), { x: 0, z: 22 })];
  const headOn = pair();
  for (let i = 0; i < 90; i++) {
    stepPlayers(headOn, [{ z: 1 }, { z: -1 }], course, i / 30, 1 / 30);
    assert.ok(headOn[1].z - headOn[0].z >= 1.29, '마주 달려도 서로 관통하지 않는다');
  }
  const pushed = pair();
  for (let i = 0; i < 60; i++) stepPlayers(pushed, [{ z: 1 }, {}], course, i / 30, 1 / 30);
  assert.ok(pushed[1].z > 25, '앞에 선 상대를 실제로 밀어낸다');
  function impact(dive) {
    const racers = pair(); racers[0].z = 20.65;
    stepPlayers(racers, [{ z: 1, dive }, {}], course, 1, 1 / 30);
    return racers[1].vz;
  }
  assert.ok(impact(true) > impact(false) + 2, '다이빙은 일반 달리기보다 큰 충격을 준다');
  const above = pair(); Object.assign(above[0], { z: 22, y: 2.4, grounded: false });
  stepPlayers(above, [{}, {}], course, 0, 1 / 30);
  assert.equal(above[1].x, 0); assert.equal(above[1].z, 22, '머리 위로 점프한 상대는 가로막지 않는다');
  const ghost = pair(); Object.assign(ghost[0], { z: 22, ghostTime: .8 });
  stepPlayers(ghost, [{}, {}], course, 0, 1 / 30);
  assert.equal(ghost[1].x, 0); assert.equal(ghost[1].z, 22, '복귀 직후 잠깐 보호한다');
});

test('몸싸움으로 벽을 뚫지 않고, 30명이 겹쳐도 물리가 안정된다', () => {
  const course = createCourse('jelly-garden');
  course.obstacles = [{ type: 'wall', x: 0, z: 15, y: 0, w: 24, d: 1, h: 3, speed: 0, phase: 0, range: 0 }];
  const racers = [Object.assign(createRacer(0), { x: 0, z: 12 }), Object.assign(createRacer(1), { x: 0, z: 13.5 })];
  for (let i = 0; i < 60; i++) stepPlayers(racers, [{ z: 1 }, { z: 1 }], course, i / 30, 1 / 30);
  assert.ok(racers.every((p) => p.z <= 13.961), '뒤에서 밀어도 벽을 통과하지 않는다');
  assert.ok(racers[1].z - racers[0].z > 1.22);
  course.obstacles = [];
  const crowd = Array.from({ length: 30 }, (_, i) => Object.assign(createRacer(i), { x: 0, z: 20 }));
  for (let i = 0; i < 60; i++) stepPlayers(crowd, crowd.map(() => ({})), course, i / 30, 1 / 30);
  assert.ok(crowd.every((p) => [p.x, p.y, p.z, p.vx, p.vz].every(Number.isFinite)));
  for (let i = 0; i < crowd.length; i++) for (let j = i + 1; j < crowd.length; j++) assert.ok(Math.hypot(crowd[i].x - crowd[j].x, crowd[i].z - crowd[j].z) > 1.2);
});

test('발판을 떠난 직후 점프와 착지 직전 입력은 허용하고 이단 점프는 막는다', () => {
  const course = createCourse('jelly-garden');
  course.obstacles = [];
  course.platforms = [{ x: 0, y: 0, z: 0, w: 20, d: 20 }];
  const tick = (p, input = {}, frames = 1) => { for (let i = 0; i < frames; i++) stepPlayers([p], [input], course, i / 90, 1 / 90); };
  for (const [frames, allowed] of [[4, true], [11, false]]) {
    const p = Object.assign(createRacer(), { x: 0, z: 9.9 });
    tick(p); p.z = 10.5;
    tick(p, {}, frames);
    tick(p, { jump: true });
    assert.equal(p.jumpCount, allowed ? 1 : 0, `${frames / 90}초 뒤 코요테 점프`);
    if (allowed) {
      tick(p); tick(p, { jump: true });
      assert.equal(p.jumpCount, 1, '공중 재입력으로 이단 점프하지 않는다');
    }
  }
  const buffered = Object.assign(createRacer(), { x: 0, z: 0, y: .35, vy: -5, grounded: false });
  tick(buffered, { jump: true }); tick(buffered, {}, 7);
  assert.equal(buffered.landCount, 1);
  assert.equal(buffered.jumpCount, 1);
  assert.ok(buffered.vy > 0, '착지 직전 짧은 탭도 착지 후 점프로 이어진다');
  const expired = Object.assign(createRacer(), { x: 0, z: 0, y: 3, vy: -2, grounded: false });
  tick(expired, { jump: true }); tick(expired, {}, 60);
  assert.equal(expired.jumpCount, 0, '120ms보다 오래된 입력은 착지할 때 실행하지 않는다');
  assert.equal(expired.y, 0);
});

test('사라지는 발판은 마지막 1초만 경고하고 숨김·재등장 시점이 물리와 일치한다', () => {
  const p = { type: 'disappear', period: 5, phase: .5 };
  for (const [time, active, warning] of [[0, true, false], [1.99, true, false], [2, true, true], [2.99, true, true], [3, false, false], [4.49, false, false], [4.5, true, false], [7, true, true]]) {
    const timing = platformTiming(p, time);
    assert.equal(timing.active, active, `활성 ${time}`);
    assert.equal(timing.warning, warning, `경고 ${time}`);
    assert.equal(platformActive(p, time), active);
    assert.ok(timing.remaining > 0);
  }
});

test('12개 맵의 안전 우회로와 점프 지름길 모두 실제 물리로 완주할 수 있다', () => {
  for (const map of MAPS) {
    const course = createCourse(map.id), routes = course.routes;
    const safe = Object.assign(createRacer(), { x: 8, z: routes.startZ, vx: 0, vz: 0 });
    let frame = 0;
    for (const point of [...routes.safePoints.slice(1), { x: 8, z: course.finishZ + 1 }]) {
      let remaining = 450;
      while (Math.hypot(point.x - safe.x, point.z - safe.z) > .45 && !safe.finished && remaining-- > 0) {
        const distance = Math.hypot(point.x - safe.x, point.z - safe.z);
        stepPlayers([safe], [{ x: (point.x - safe.x) / distance, z: (point.z - safe.z) / distance }], course, frame++ / 90, 1 / 90);
      }
      assert.ok(remaining > 0, `${map.id} 안전길 경유점 도달`);
    }
    assert.equal(safe.fallCount, 0, `${map.id} 안전길은 점프 없이 완주`);
    assert.ok(safe.finished, `${map.id} 안전길 결승선`);
    const shortcut = Object.assign(createRacer(), { x: -7, z: routes.startZ, vx: 0, vz: 10 });
    const planks = course.platforms.filter(p => p.route === 'shortcut');
    let shortFrame = 0;
    while (!shortcut.finished && shortFrame < 1800) {
      const edge = planks.find(p => shortcut.z >= p.z - p.d / 2 && shortcut.z <= p.z + p.d / 2);
      const jump = shortcut.grounded && !!edge && edge.z + edge.d / 2 - shortcut.z < .9;
      stepPlayers([shortcut], [{ z: 1, jump }], course, shortFrame++ / 90, 1 / 90);
    }
    assert.equal(shortcut.fallCount, 0, `${map.id} 지름길 간격을 점프로 넘을 수 있다`);
    assert.ok(shortcut.finished, `${map.id} 지름길 결승선`);
    assert.ok(shortFrame < frame, `${map.id} 지름길이 우회로보다 빠르다`);
  }
});
