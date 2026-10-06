import test from 'node:test';
import assert from 'node:assert/strict';
import { MAPS, createCourse, createRacer, stepPlayer, stepPlayers, obstaclePose, platformActive, platformTiming, platformPose, supportAt, conveyorVelocity, floodLevel } from '../public/world.js';

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

test('모든 선풍기는 강풍 때 1초에 몸 여러 개 너비를 밀지만 역방향 조작으로 버틸 수 있다',()=>{
  for(const map of MAPS) for(const rule of map.rules) {
    const source=createCourse(map.id,rule);
    for(const fan of source.obstacles.filter(o=>o.type==='fan')) {
      const c={...source,rule:'race',platforms:[{id:'p0',x:0,z:0,y:0,w:200,d:200}],obstacles:[{...fan,x:0,z:0,w:100,d:100}],checkpoints:[],finish:{x:90,z:90,y:0,radius:1}};
      const run=input=>{const p=Object.assign(createRacer(),{x:0,z:0});for(let i=0;i<90;i++)stepPlayers([p],[input],c,5+i/90,1/90);return p;};
      const idle=run({}),resist=run({[fan.axis]:-Math.sign(fan.force)}),jump=run({jump:true});
      const distance=idle[fan.axis]*Math.sign(fan.force),label=map.id+' '+fan.id;
      assert.ok(distance>6 && distance<8.5,label+' 강풍의 확실한 이동');
      assert.ok(resist[fan.axis]*Math.sign(fan.force)<-1,label+' 반대 방향으로 보행 가능');
      assert.ok(Math.abs(jump[fan.axis])>distance*1.7,label+' 공중에서 더 크게 밀림');
    }
  }
});

test('강해진 바람도 영역 밖에는 작용하지 않고 생존전 시작 3초는 보호한다',()=>{
  const c=createCourse('storm-island','survival');c.obstacles=c.obstacles.filter(o=>o.type==='fan');
  c.platforms=[{id:'p0',x:0,z:6,y:0,w:100,d:100}];
  const p=Object.assign(createRacer(),{x:0,z:6});
  for(let i=0;i<270;i++)stepPlayers([p],[{}],c,i/90,1/90);
  assert.equal(p.x,0);
  for(let i=270;i<360;i++)stepPlayers([p],[{}],c,i/90,1/90);
  assert.ok(p.x>2,'보호 시간이 지나면 약한 돌풍 주기에도 밀림');
  const outside=Object.assign(createRacer(),{x:-15,z:6});
  for(let i=0;i<90;i++)stepPlayers([outside],[{}],c,5+i/90,1/90);
  assert.equal(outside.x,-15);assert.equal(outside.vx,0);
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

test('24개 맵의 지원 규칙, 30명 출발 지점과 서로 다른 동선', () => {
  assert.equal(MAPS.length,24); assert.equal(new Set(MAPS.map(m=>m.id)).size,24);
  assert.equal(MAPS.filter(m=>m.rules.includes('race')).length,16);
  assert.equal(MAPS.filter(m=>m.rules.includes('survival')).length,10);
  const signatures=new Set();
  for(const map of MAPS) for(const rule of map.rules) {
    const course=createCourse(map.id,rule);
    assert.equal(course.rule,rule);
    const floorsOnly={...course,obstacles:[]};
    for(let i=0;i<30;i++) { const p=createRacer(i,30,course.spawnY||0); stepPlayer(p,{},floorsOnly,0,1/90); assert.equal(p.grounded,true,map.id+' 출발 '+i); }
    assert.equal(new Set(course.platforms.map(p=>p.id)).size,course.platforms.length);
    if(rule==='race') {
      for(const n of [...course.checkpoints,course.finish]) { const p=Object.assign(createRacer(),n); stepPlayer(p,{},floorsOnly,0,1/90); assert.equal(p.grounded,true,map.id+' 깃발 바닥'); }
      signatures.add(JSON.stringify(course.path));
    } else assert.equal(course.finish,null);
    for(const o of course.obstacles) for(const time of [0,1,10,60]) assert.ok(Object.values(obstaclePose(o,time)).every(v=>typeof v==='boolean'||Number.isFinite(v)));
  }
  assert.equal(signatures.size,16);
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

test('착지와 동시에 예약 점프로 떠도 붕괴 발판이 반응하고 번호 깃발을 인정한다',()=>{
  const field=createCourse('leaf-square','survival');
  const hopper=Object.assign(createRacer(),{x:2.4,z:8.4,y:.35,vy:-5,grounded:false});
  stepPlayers([hopper],[{jump:true}],field,4,1/90);
  for(let i=1;i<=7;i++) stepPlayers([hopper],[{}],field,4+i/90,1/90);
  assert.equal(hopper.jumpCount,1); assert.ok(hopper.vy>0,'착지 즉시 예약 점프');
  assert.equal(Object.keys(field.collapsed).length,1,'밟고 바로 뛰어도 발판은 경고 후 무너진다');
  const race=createCourse('jelly-garden'); race.obstacles=[];
  const flag=race.checkpoints[0];
  const runner=Object.assign(createRacer(),{x:flag.x,z:flag.z,y:flag.y+.35,vy:-5,grounded:false});
  stepPlayers([runner],[{jump:true}],race,10,1/90);
  for(let i=1;i<=7;i++) stepPlayers([runner],[{}],race,10+i/90,1/90);
  assert.equal(runner.jumpCount,1); assert.equal(runner.checkpoint,0,'깃발 위에서 곧바로 뛰어도 통과로 인정');
});

test('물결 징검마당은 준비 시간이 끝나며 잠길 발판도 1초 전에 경고한다',()=>{
  const tiles=createCourse('tide-tiles','survival').platforms.filter(p=>p.type==='disappear');
  const sinking=tiles.filter(p=>!platformActive(p,5)), staying=tiles.filter(p=>platformActive(p,5));
  assert.ok(sinking.length>0 && staying.length>0);
  for(const tile of sinking) {
    assert.equal(platformTiming(tile,3.9).warning,false);
    const timing=platformTiming(tile,4.2);
    assert.equal(timing.active,true); assert.equal(timing.warning,true,'사라지기 1초 전부터 경고');
    assert.ok(Math.abs(timing.remaining-.8)<1e-9,'경고 막대가 실제로 사라지는 시각까지 줄어든다');
  }
  for(const tile of staying) assert.equal(platformTiming(tile,4.5).warning,false,'계속 남는 발판은 경고하지 않는다');
});

test('생존전 시작 3초 동안은 몸이 겹치지 않게만 하고 밀쳐내는 충격은 주지 않는다',()=>{
  const arena={...createCourse('log-lake','survival'),obstacles:[],platforms:[{id:'p0',x:0,z:6,y:0,w:100,d:100}]};
  const impact=time=>{
    const racers=[Object.assign(createRacer(0),{x:0,z:4.65}),Object.assign(createRacer(1),{x:0,z:6})];
    stepPlayers(racers,[{z:1,dive:true},{}],arena,time,1/30);
    return racers;
  };
  const early=impact(1), later=impact(5);
  assert.ok(early[1].z-early[0].z>1.29,'보호 시간에도 서로 통과하지는 않는다');
  assert.ok(Math.abs(early[1].vz)<.5,'보호 시간에는 밀쳐내는 충격이 없다');
  assert.ok(later[1].vz>3,'보호 시간이 끝나면 몸싸움 충격이 돌아온다');
});

test('첫 깃발 전 실시간 순위는 출발 칸과 관계없이 같은 위치면 같은 진행도다',()=>{
  const course=createCourse('jelly-garden'); course.obstacles=[];
  const front=createRacer(29), back=createRacer(0);
  for(const racer of [front,back]) { Object.assign(racer,{x:0,z:14}); stepPlayers([racer],[{}],course,1,1/90); }
  assert.ok(front.progress>0);
  assert.equal(front.progress,back.progress);
});

test('인원이 모자란 앞줄은 가운데에 모여 서고 가득 찬 줄은 기존 자리를 유지한다',()=>{
  assert.equal(createRacer(6,7).x,0);
  assert.deepEqual([24,25].map(i=>createRacer(i,26).x),[-1.2,1.2]);
  assert.deepEqual([0,5].map(i=>createRacer(i,7).x),[-6,6]);
  assert.deepEqual(Array.from({length:30},(_,i)=>createRacer(i).x),Array.from({length:30},(_,i)=>(i%6-2.5)*2.4));
  for(let total=1;total<=30;total++) {
    const racers=Array.from({length:total},(_,i)=>createRacer(i,total));
    const front=racers.filter(r=>r.z===racers.at(-1).z);
    assert.ok(Math.abs(front.reduce((sum,r)=>sum+r.x,0))<1e-9,total+'명 앞줄 좌우 균형');
  }
});

// 새 기믹은 평평한 시험장 위에 하나씩 올려 실제 물리로 확인합니다.
const arena=(platforms=[],obstacles=[],extra={})=>({...createCourse('jelly-garden'),rule:'race',platforms:[{id:'p0',x:0,z:0,y:0,w:200,d:200,type:'normal'},...platforms],obstacles,checkpoints:[],finish:{x:95,z:95,y:0,radius:1},bounds:{x:300,minZ:-300,maxZ:300},...extra});
const simulate=(p,c,frames,input={},start=0)=>{for(let i=0;i<frames;i++)stepPlayers([p],[typeof input==='function'?input(i):input],c,start+(i+1)/90,1/90);return p;};

test('부스터는 패드 방향으로 멀리 날려 보내고, 진흙은 달리기와 점프를 둔하게 한다',()=>{
  const c=arena([{id:'p1',x:0,z:0,y:.04,w:4,d:4,type:'boost',dirX:1,dirZ:0,power:19}]);
  const p=simulate(Object.assign(createRacer(),{x:0,z:0}),c,54);
  assert.ok(p.x>6,'0.6초 만에 6m 이상'); assert.equal(p.springKind,3); assert.equal(p.springSource,'p1'); assert.ok(Math.abs(p.z)<.5);
  const runner=type=>simulate(Object.assign(createRacer(),{x:0,z:-20}),arena(type?[{id:'p1',x:0,z:0,y:.03,w:60,d:60,type}]:[]),90,{z:1});
  const normal=runner(),slow=runner('mud');
  assert.equal(slow.surface,6); assert.ok(slow.z+20<(normal.z+20)*.6,'진흙 위에서는 60% 미만 거리');
  const jump=type=>{const p=Object.assign(createRacer(),{x:0,z:0,y:type?.03:0});let top=0;simulate(p,arena(type?[{id:'p1',x:0,z:0,y:.03,w:60,d:60,type}]:[]),60,i=>{top=Math.max(top,p.y);return {jump:i<2};});return top;};
  assert.ok(jump('mud')<jump()*.7,'진흙 점프가 낮다');
});

test('펀치 벽은 경고 후 튀어나올 때만 세게 날리고, 들어가 있을 때는 벽이다',()=>{
  const puncher={id:'o0',type:'puncher',x:3,z:0,y:0,w:3,d:3,h:2.4,axis:'x',dir:-1,range:5,period:3,phase:0,speed:1};
  assert.equal(obstaclePose(puncher,1.6).warning,true); assert.equal(obstaclePose(puncher,1).warning,false);
  assert.equal(obstaclePose(puncher,1).x,3); assert.ok(Math.abs(obstaclePose(puncher,2.6).x+2)<1e-9,'완전히 튀어나오면 range만큼 이동');
  const c=arena([],[puncher]);
  const hit=simulate(Object.assign(createRacer(),{x:0,z:0}),c,30,{},2.3);
  assert.ok(hit.x<-4,'주먹에 맞아 크게 밀려남');
  const calm=simulate(Object.assign(createRacer(),{x:0,z:0}),c,60,{x:1},0);
  assert.ok(calm.x<1.1 && calm.x>.5,'들어가 있을 때는 막기만 함'); assert.ok(Math.abs(calm.vx)<1);
});

test('소용돌이는 가만히 있으면 가운데로 끌고 바깥으로 달리면 빠져나온다',()=>{
  const c=arena([],[{id:'o0',type:'vortex',x:0,z:0,y:0,w:30,d:30,h:3,force:55,speed:1}]);
  const idle=simulate(Object.assign(createRacer(),{x:10,z:0}),c,90,{},5);
  assert.ok(Math.hypot(idle.x,idle.z)<8,'1초 만에 2m 이상 끌려감');
  const escape=simulate(Object.assign(createRacer(),{x:10,z:0}),c,180,{x:1},5);
  assert.ok(escape.x>15,'바깥으로 달리면 빠져나옴');
  const outside=simulate(Object.assign(createRacer(),{x:20,z:0}),c,90,{},5);
  assert.equal(outside.x,20);
});

test('가짜 발판은 밟자마자 떨어지고 다시 숨으며 겉모습 정보도 숨긴다',()=>{
  const c=createCourse('tiptoe-bridge'), fakes=c.platforms.filter(t=>t.fake), real=c.platforms.filter(t=>t.w===4.8&&!t.fake);
  assert.ok(fakes.length>70 && real.length>=36);
  assert.ok(fakes.every(t=>t.type==='collapse'&&t.delay<=.15&&t.recover>0));
  const tile=fakes[0], p=Object.assign(createRacer(),{x:tile.x,z:tile.z});
  c.obstacles=[];
  simulate(p,c,40);
  assert.ok(p.y<-.5,'0.45초 안에 발밑이 꺼져 떨어짐');
  assert.equal(platformActive(tile,c.collapsed[tile.id]+tile.delay+tile.recover+.01,c.collapsed),true,'시간이 지나면 다시 나타남');
});

test('엘리베이터는 탄 사람을 위층까지 올렸다가 다시 내린다',()=>{
  const lift={id:'p1',x:0,z:0,y:3,w:8,d:8,type:'moving',axis:'y',range:3,speed:1,phase:-Math.PI/2};
  const c=arena([lift]); c.platforms[0]={...c.platforms[0],x:50};
  const p=Object.assign(createRacer(),{x:0,z:0,y:0,supportId:'p1'});
  let top=0,grounded=0;
  for(let i=0;i<566;i++){stepPlayers([p],[{}],c,(i+1)/90,1/90);top=Math.max(top,p.y);grounded+=p.grounded;}
  assert.ok(top>5.9,'꼭대기 높이까지'); assert.ok(p.y<.3,'한 바퀴 뒤 바닥으로'); assert.ok(grounded>550,'타는 동안 계속 발을 딛고 있음');
});

test('용암은 시간에 따라 차오르고 닿으면 탈락, 3층 탑은 아래층이 받아 준다',()=>{
  const lava=createCourse('lava-rise','survival');
  assert.equal(floodLevel(lava,0),lava.flood.from); assert.ok(floodLevel(lava,40)>floodLevel(lava,20)); assert.ok(floodLevel(lava,999)<=lava.flood.max);
  lava.obstacles=[];
  const low=Object.assign(createRacer(),{x:0,z:3});
  simulate(low,lava,90,{},25);
  assert.equal(low.eliminated,true,'바깥 단은 용암에 잠김');
  const top=Object.assign(createRacer(),{x:0,z:27,y:4.5});
  simulate(top,lava,90,{},58);
  assert.equal(top.eliminated,false,'꼭대기는 끝까지 안전');
  const tower=createCourse('triple-drop','survival');
  assert.equal(tower.spawnY,12);
  const p=createRacer(0,30,tower.spawnY);
  tower.collapsed[supportAt(tower,p.x,p.z,5,12.1).id]=0;
  simulate(p,tower,120,{},5);
  assert.equal(p.eliminated,false); assert.equal(p.y,6,'가운데층에 착지');
});
