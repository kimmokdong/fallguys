import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, createCourse, createRacer, stepPlayer, stepPlayers, obstaclePose, platformActive, platformTiming, platformPose, supportAt, conveyorVelocity } from '../public/world.js';

test('빙판은 관성과 드리프트가 크고, 벨트는 정지·역주행·정주행 모두 같은 방향으로 운반한다',()=>{
  const course=type=>({...createCourse('jelly-garden'),platforms:[{id:'p0',x:0,z:0,y:0,w:200,d:200,type,axis:'z',speed:7}],obstacles:[],checkpoints:[],finish:{x:90,z:90,y:0,radius:1}});
  const run=(type,input,start={})=>{const p=Object.assign(createRacer(),{x:0,z:0},start),c=course(type);for(let i=0;i<90;i++)stepPlayers([p],[input],c,(i+1)/90,1/90);return p;};
  const normal=run('normal',{}, {vz:10}),ice=run('ice',{}, {vz:10});
  assert.ok(ice.z>7 && ice.z>normal.z*8);assert.ok(ice.vz>5);
  const turn=run('ice',{x:1},{vz:10});assert.ok(turn.vz>4 && turn.vx>5,'방향을 바꿔도 기존 진행 관성 유지');
  assert.ok(Math.abs(run('conveyor',{}).z-7)<.03);
  assert.ok(run('conveyor',{z:-1}).z>-3.1 && run('conveyor',{z:-1}).z<-2);
  assert.ok(run('conveyor',{z:1}).z>16);
  const p=Object.assign(createRacer(),{x:0,z:0}),c=course('conveyor');Object.assign(c.platforms[0],{rotation:Math.PI/2,axis:'x',speed:-7});
  for(let i=0;i<90;i++)stepPlayers([p],[{}],c,(i+1)/90,1/90);
  assert.ok(Math.abs(p.x+7)<.03 && Math.abs(p.z)<.01);assert.deepEqual(conveyorVelocity(c.platforms[0]),{x:-7,z:0});
});

test('쿠션은 입사 속도에 비례해 반사하고, 트램펄린은 점프 입력 없이 높이 띄운다',()=>{
  const c={...createCourse('pinball-park'),platforms:[{id:'p0',x:0,z:0,y:0,w:100,d:100}],checkpoints:[],finish:{x:45,z:45,y:0,radius:1},obstacles:[{id:'o0',type:'cushion',x:0,z:0,y:0,w:4,d:4,h:3}]};
  const hit=speed=>{const p=Object.assign(createRacer(),{x:0,z:-2.5,vz:speed});stepPlayers([p],[{z:1}],c,1,1/90);return p;};
  const slow=hit(3),fast=hit(17);
  assert.ok(fast.vz<slow.vz-10);assert.ok(fast.vz<-24);assert.equal(fast.springKind,1);assert.equal(fast.springSource,'o0');
  for(let i=0;i<18;i++)stepPlayers([fast],[{z:1}],c,1+i/90,1/90);
  assert.ok(fast.vz<-15,'반사 속도가 공중 조작으로 즉시 사라지지 않음');assert.equal(fast.springCount,1);
  c.obstacles=[];c.platforms[0].type='trampoline';c.platforms[0].force=17;
  const p=Object.assign(createRacer(),{x:0,z:0});let height=0;
  for(let i=0;i<95;i++){stepPlayers([p],[{}],c,i/90,1/90);height=Math.max(height,p.y);}
  assert.ok(height>5.5);assert.equal(p.springCount,1);assert.equal(p.jumpCount,0);assert.equal(p.springSource,'p0');assert.equal(p.springKind,2);
});

test('회전 원판은 서 있는 사람을 원을 따라 운반하고 원 밖에서는 지지하지 않는다',()=>{
  const c={...createCourse('spin-city','survival'),obstacles:[]};
  c.platforms=[{id:'p0',type:'rotating',x:0,z:0,y:0,w:20,d:20,speed:Math.PI/2}];
  assert.equal(supportAt(c,9,9,0),null);
  const p=Object.assign(createRacer(),{x:0,z:5,supportId:'p0'});
  for(let i=1;i<=90;i++)stepPlayers([p],[{}],c,i/90,1/90);
  assert.ok(Math.abs(p.x-5)<.03 && Math.abs(p.z)<.03);assert.equal(p.surface,3);assert.equal(p.grounded,true);
  const airborne=Object.assign(createRacer(),{x:0,z:5,y:4,grounded:false,supportId:'p0'});
  stepPlayers([airborne],[{}],c,2,1/90);assert.equal(airborne.x,0,'공중에서는 원판에 끌려가지 않음');
});

test('16개 맵의 지원 규칙, 30명 출발 지점과 서로 다른 동선', () => {
  assert.equal(MAPS.length,16); assert.equal(new Set(MAPS.map(m=>m.id)).size,16);
  assert.equal(MAPS.filter(m=>m.rules.includes('race')).length,12);
  assert.equal(MAPS.filter(m=>m.rules.includes('survival')).length,6);
  const signatures=new Set();
  for(const map of MAPS) for(const rule of map.rules) {
    const course=createCourse(map.id,rule);
    assert.equal(course.rule,rule);
    const floorsOnly={...course,obstacles:[]};
    for(let i=0;i<30;i++) { const p=createRacer(i); stepPlayer(p,{},floorsOnly,0,1/90); assert.equal(p.grounded,true,map.id+' 출발 '+i); }
    assert.equal(new Set(course.platforms.map(p=>p.id)).size,course.platforms.length);
    if(rule==='race') {
      for(const n of [...course.checkpoints,course.finish]) { const p=Object.assign(createRacer(),n); stepPlayer(p,{},floorsOnly,0,1/90); assert.equal(p.grounded,true,map.id+' 깃발 바닥'); }
      signatures.add(JSON.stringify(course.path));
    } else assert.equal(course.finish,null);
    for(const o of course.obstacles) for(const time of [0,1,10,60]) assert.ok(Object.values(obstaclePose(o,time)).every(v=>typeof v==='boolean'||Number.isFinite(v)));
  }
  assert.equal(signatures.size,12);
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
  const finisher = Object.assign(createRacer(),course.finish,{checkpoint:course.checkpoints.length-1});
  run(finisher, {}, 1, 42);
  assert.equal(finisher.finished, true); assert.equal(finisher.finishTime, 42);
});

test('장애물은 실제 충돌하고 사라지는 발판은 실제로 발을 놓친다', () => {
  const course = createCourse('jelly-garden');
  course.obstacles = [{ id: 'wall', type: 'wall', x: 0, z: 15, y: 0, w: 24, d: 1, h: 3, speed: 0, phase: 0, range: 0 }];
  const racer = createRacer(); racer.x = 0;
  for (let i = 0; i < 90; i++) stepPlayer(racer, { z: 1 }, course, i / 30, 1 / 30);
  assert.ok(racer.z <= 14, '벽을 관통하지 않습니다');
  const blink = createCourse('tide-tiles','survival');
  const tile = blink.platforms.find(p=>p.type==='disappear'&&p.phase===0); tile.warmup=0;
  assert.equal(platformActive(tile, 0), true); assert.equal(platformActive(tile, 5), false);
  const falling = createRacer(); falling.x = tile.x; falling.z = tile.z;
  stepPlayer(falling, {}, blink, 5, 1 / 30);
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

test('뒤로 돌아오는 코스도 깃발을 차례로 지나야 완주한다',()=>{
  const c=createCourse('spin-city'); c.obstacles=[];
  const p=Object.assign(createRacer(),c.finish);
  stepPlayers([p],[{}],c,1,1/30); assert.equal(p.finished,false); assert.equal(p.checkpoint,-1);
  for(const [i,n] of c.checkpoints.entries()) { Object.assign(p,n,{vy:0,grounded:true}); stepPlayers([p],[{}],c,2+i,1/30); assert.equal(p.checkpoint,i); }
  assert.ok(c.finish.z<c.checkpoints[0].z);
  Object.assign(p,c.finish,{vy:0}); stepPlayers([p],[{}],c,10,1/30);
  assert.equal(p.finished,true); assert.equal(p.progress,1);
});

test('붕괴 경고·서버 공유·레이스 복구·생존 탈락과 이동 발판 탑승',()=>{
  const c=createCourse('leaf-square','survival');
  const p=Object.assign(createRacer(),{x:2.4,z:8.4});
  stepPlayers([p],[{}],c,4,1/30);
  const touched=Object.keys(c.collapsed)[0]; assert.ok(touched);
  const tile=c.platforms.find(p=>p.id===touched);
  assert.equal(platformTiming(tile,4.5,c.collapsed).warning,true);
  for(let i=0;i<180;i++) stepPlayers([p],[{}],c,4+i/90,1/90);
  assert.equal(p.eliminated,true); const before={...p}; stepPlayers([p],[{z:1,jump:true}],c,7,1/30); assert.deepEqual(p,before);
  const race=createCourse('blink-trail'); const t=race.platforms.find(p=>p.type==='collapse'); race.collapsed[t.id]=1;
  assert.equal(platformActive(t,2,race.collapsed),false); assert.equal(platformActive(t,6,race.collapsed),true);
  const ferry=createCourse('pendulum-port'); ferry.obstacles=[]; const platform=ferry.platforms.find(p=>p.type==='moving');
  const pose=platformPose(platform,0); const passenger=Object.assign(createRacer(),{x:pose.x,z:pose.z});
  stepPlayers([passenger],[{}],ferry,0,1/90);
  for(let i=1;i<=90;i++) stepPlayers([passenger],[{}],ferry,i/90,1/90);
  assert.ok(passenger.x>pose.x+4); assert.equal(passenger.fallCount,0); assert.equal(passenger.grounded,true);
});

test('압축기 경고와 낮은 통나무 충돌·점프 회피',()=>{
  const c=createCourse('neon-factory'),press=c.obstacles.find(o=>o.type==='crusher');
  assert.equal(obstaclePose(press,press.period-.5).warning,true); assert.equal(obstaclePose(press,press.period+.1).y,0);
  const lake=createCourse('log-lake','survival'); lake.obstacles=[{type:'log',x:0,z:15,w:22,d:1,h:1,y:0,speed:0,phase:0}];
  const p=Object.assign(createRacer(),{x:0,z:14.5}); stepPlayers([p],[{z:1}],lake,4,1/30); assert.ok(p.hitCooldown>0);
  const jumper=Object.assign(createRacer(),{x:0,z:15,y:1.5,grounded:false}); stepPlayers([jumper],[{}],lake,4,1/90); assert.equal(jumper.hitCooldown,0);
});
