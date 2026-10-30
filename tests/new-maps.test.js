import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS,PHYSICS,createCourse,createRacer,stepPlayers,supportAt,platformPose,platformTiming,obstaclePose,signalState,floodLevel} from '../public/world.js';
import {StateEncoder,StateDecoder} from '../public/network.js';
import {layerFaded} from '../public/scene.js';

test('맵 열여섯 가지에서 30명의 입력·몸싸움·낙하를 처리해도 좌표와 시소 각도는 유한하다',()=>{
  for(const id of ['seesaw-trail','signal-square','rotating-maze','snow-jumps','rocket-road','choco-swamp','tiptoe-bridge','sky-tower','lava-rise','triple-drop','whirlpool-bay','punch-arena','spin-city','cloud-hop','log-lake','sumo-ring']) {
    const c=createCourse(id,MAPS.find(m=>m.id===id).rules[0]),players=Array.from({length:30},(_,i)=>createRacer(i,30,c.spawnY||0));
    for(let frame=0;frame<(id==='lava-rise'?1800:360);frame++) {
      stepPlayers(players,players.map((_,i)=>({x:Math.sin(i+frame*.03),z:1,jump:frame%35===i%35})),c,frame/30,1/30);
      assert.ok(players.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)),id);
    }
    if(id==='seesaw-trail') assert.ok(Object.values(c.collapsed).every(angle=>Math.abs(angle)<=.35));
  }
});

test('시소는 좌우 무게 차이가 남으면 계속 기울고 균형이면 유지하며 패킷도 일치한다',()=>{
  const c=createCourse('seesaw-trail'),board=c.platforms.find(p=>p.type==='seesaw');
  const make=x=>Object.assign(createRacer(),{x:board.x+x,z:board.z,y:board.y,supportId:board.id,netId:0,id:'test'});
  const p=make(board.w*.25);
  let earlier;
  for(let i=0;i<60;i++) stepPlayers([p],[{}],c,(i+1)/90,1/90);
  earlier=c.collapsed[board.id];
  for(let i=60;i<135;i++) stepPlayers([p],[{}],c,(i+1)/90,1/90);
  assert.ok(c.collapsed[board.id]<earlier-.05);assert.ok(Math.abs(c.collapsed[board.id])<=.35);
  assert.ok(c.collapsed[board.id]<-.02); assert.ok(p.y<board.y); assert.equal(p.fallCount,0);
  const decoder=new StateDecoder(); decoder.setRoom({startsAt:1234,players:[{...p,participating:true}]});
  const state=decoder.decode(new StateEncoder().encode({epoch:1234,time:1,players:[p],collapsed:c.collapsed},p.id));
  assert.ok(Math.abs(platformPose(board,1,state.collapsed).rise-platformPose(board,1,c.collapsed).rise)<.00001);
  c.collapsed[board.id]=-.2;const balanced=[make(-3),make(3)];
  for(const p of balanced) p.y=supportAt(c,p.x,p.z,1).y;
  stepPlayers(balanced,[{},{}],c,1,1/90);assert.equal(c.collapsed[board.id],-.2);
  stepPlayers([],[],c,2,1/30);assert.ok(c.collapsed[board.id]>-.2);
});

test('신호등은 미리 색·모양을 알려 주고 안전한 발판만 남기며 틀린 발판에서는 탈락한다',()=>{
  const c=createCourse('signal-square','survival');
  assert.ok(c.platforms.every(p=>platformTiming(p,0).active));
  assert.equal(signalState(9).group,0);
  const safe=c.platforms.find(p=>p.signalGroup===0),unsafe=c.platforms.find(p=>p.signalGroup!==0);
  assert.equal(platformTiming(unsafe,8.5).warning,true);
  assert.equal(c.platforms.filter(p=>platformTiming(p,9.6).active).length,9);
  c.obstacles=[];
  const survivor=Object.assign(createRacer(),safe),fallen=Object.assign(createRacer(),unsafe);
  for(let i=0;i<90;i++) stepPlayers([survivor,fallen],[{},{}],c,9.6+i/90,1/90);
  assert.equal(fallen.eliminated,true);assert.equal(survivor.eliminated,false);
  assert.equal(signalState(12).group,2);assert.ok(c.platforms.every(p=>platformTiming(p,11.2).active));
});

test('신호 대기는 매번 .25초씩 줄어 최소 1초이며 열림·간격·경고 시점은 유지한다',()=>{
  const seed=12345,c=createCourse('signal-square','survival',seed);
  assert.equal(c.seed,seed);assert.equal(signalState(0,seed).remaining,9);
  let start=6;
  for(let cycle=0;cycle<20;cycle++) {
    const wait=Math.max(1,3-cycle*.25),state=signalState(start,seed);
    assert.equal(state.remaining,wait);assert.equal(state.open,false);
    const unsafe=c.platforms.find(p=>p.signalGroup!==state.group);
    assert.equal(platformTiming(unsafe,start+wait-.5,{},seed).warning,true);
    assert.equal(signalState(start+wait,seed).remaining,0);
    assert.equal(signalState(start+wait,seed).open,true);
    assert.equal(platformTiming(unsafe,start+wait,{},seed).active,false);
    assert.equal(supportAt(c,unsafe.x,unsafe.z,start+wait),null);
    assert.equal(signalState(start+wait+1.99,seed).open,true);
    assert.equal(signalState(start+wait+2,seed).open,false);
    assert.equal(platformTiming(unsafe,start+wait+2,{},seed).warning,false);
    assert.ok(c.platforms.every(p=>platformTiming(p,start+wait+2,{},seed).active));
    start+=wait+2.5;
  }
});

test('신호 순서는 같은 시드에서 같고 시드에 따라 달라지며 바로 같은 그룹을 반복하지 않는다',()=>{
  const order=seed=>{
    let start=6,groups=[];
    for(let cycle=0;cycle<80;cycle++) {
      const state=signalState(start,seed);
      assert.ok(state.group>=0 && state.group<4);
      if(cycle) assert.notEqual(state.group,groups.at(-1));
      groups.push(state.group);start+=Math.max(1,3-cycle*.25)+2.5;
    }
    return groups;
  };
  for(const seed of [0,1,12345,0xffffffff]) assert.deepEqual(order(seed),order(seed));
  assert.notDeepEqual(order(12345),order(54321));
  assert.deepEqual(signalState(42),signalState(42,0));
});

test('가짜 발판은 착지 예약 점프·점프 유지·낮은 공중 통과에도 즉시 무너지고 3초 뒤 복구한다',()=>{
  for(const start of [{y:0,vy:0,grounded:true,coyoteTime:.1},{y:.02,vy:-5,grounded:false},{y:.55,vy:0,grounded:false},{y:.55,vy:2,grounded:false}]) {
    const c=createCourse('tiptoe-bridge'),tile=c.platforms.find(p=>p.fake);c.obstacles=[];
    const p=Object.assign(createRacer(),{x:tile.x,z:tile.z,...start});
    stepPlayers([p],[{jump:true}],c,1,1/90);
    assert.equal(c.collapsed[tile.id],1);assert.equal(platformTiming(tile,1,c.collapsed).active,false);
    assert.equal(p.grounded,false);assert.equal(p.jumpCount,0);
    assert.equal(platformTiming(tile,3.99,c.collapsed).active,false);
    assert.equal(platformTiming(tile,4,c.collapsed).active,true);
    for(let i=1;i<=45;i++) stepPlayers([p],[{jump:true}],c,1+i/90,1/90);
    assert.ok(p.y<tile.y);assert.equal(p.jumpCount,0);
    const again=Object.assign(createRacer(),{x:tile.x,z:tile.z,y:tile.y});
    stepPlayers([again],[{jump:true}],c,4,1/90);
    assert.equal(c.collapsed[tile.id],4);assert.equal(again.jumpCount,0);
  }
  const c=createCourse('tiptoe-bridge'),fake=c.platforms.find(p=>p.fake);c.obstacles=[];
  const high=Object.assign(createRacer(),{x:fake.x,z:fake.z,y:1,vy:2,grounded:false});
  stepPlayers([high],[{}],c,1,1/90);assert.equal(c.collapsed[fake.id],undefined);
  const real=c.platforms.find(p=>!p.fake),p=Object.assign(createRacer(),{x:real.x,z:real.z,y:real.y});
  stepPlayers([p],[{jump:true}],c,1,1/90);assert.equal(p.jumpCount,1);assert.ok(p.vy>0);
  assert.deepEqual(c.collapsed,{});
});

test('가짜 발판 이외의 붕괴 발판은 기존 양수 지연과 경고를 유지한다',()=>{
  for(const map of MAPS) for(const rule of map.rules) for(const tile of createCourse(map.id,rule).platforms.filter(p=>p.type==='collapse'&&!p.fake)) {
    assert.ok(tile.delay>0);
    assert.equal(platformTiming(tile,1,{[tile.id]:1}).warning,true);
    assert.equal(platformTiming(tile,1+tile.delay/2,{[tile.id]:1}).active,true);
    assert.equal(platformTiming(tile,1+tile.delay+.01,{[tile.id]:1}).active,false);
  }
});

test('미로 벽은 경고 뒤 90도 회전하고 높은 벽은 점프로 통과하거나 반동으로 넘어갈 수 없다',()=>{
  const c=createCourse('rotating-maze'),wall=c.obstacles.find(o=>o.type==='maze-wall');
  assert.equal(obstaclePose(wall,0).rotation,obstaclePose(wall,4).rotation);
  assert.equal(obstaclePose(wall,3.5).warning,true);
  assert.ok(obstaclePose(wall,7).rotation>0);assert.equal(obstaclePose(wall,8).rotation,Math.PI/2);
  const p=Object.assign(createRacer(),{x:wall.x,z:wall.z,y:2,vy:0,grounded:false});
  stepPlayers([p],[{}],c,0,1/90);
  assert.ok(Math.abs(p.z-wall.z)>wall.d/2);assert.equal(p.hitCooldown,0);
});

function ski(start,lead=1.6) {
  const c=createCourse('snow-jumps'),p=Object.assign(createRacer(0,1,c.spawnY),{x:start,spawnX:start});
  const islands=c.platforms.filter(p=>p.type==='ice'&&!p.rise);
  let jumpedFrom=null;
  for(let frame=0;frame<5400&&!p.finished&&!p.fallCount;frame++) {
    const time=frame/90,floor=supportAt(c,p.x,p.z,time,p.y+.1);
    const index=islands.findIndex(t=>t.id===floor?.id),target=islands[Math.min(index+1,islands.length-1)];
    const x=target?Math.max(-1,Math.min(1,(target.x-p.x)*.1)):0;
    const jump=p.grounded && index>=0 && index<islands.length-1 && p.z>=floor.z+floor.d/2-lead && jumpedFrom!==floor.id;
    if(jump) jumpedFrom=floor.id;
    stepPlayers([p],[{x,z:0,jump}],c,time,1/90);
  }
  return {c,p};
}

test('눈꽃은 왼쪽·중앙·오른쪽에서 전진 입력 없이 다섯 점프 완주하고 낙하하면 출발점으로 돌아간다',()=>{
  for(const start of [-6,0,6]) {
    const {c,p}=ski(start);
    assert.equal(p.finished,true,JSON.stringify(p));assert.equal(p.fallCount,0);assert.equal(p.jumpCount,5);
    assert.equal(c.checkpoints.length,0);assert.ok(p.finishTime<60);
  }
  const c=createCourse('snow-jumps');
  const falling=Object.assign(createRacer(0,1,c.spawnY),{x:4,z:105,y:-6,vz:24});
  stepPlayers([falling],[{}],c,1,1/90);
  assert.equal(falling.fallCount,1);assert.equal(falling.z,falling.spawnZ);assert.ok(falling.y>=14);assert.equal(falling.vz,0);
});

test('눈꽃 첫 간격은 정지 도약으로 못 넘지만 내리막 속도면 넘는다',()=>{
  const c=createCourse('snow-jumps'),run=speed=>{
    const p=Object.assign(createRacer(0,1,c.spawnY),{x:0,z:48,y:5,vz:speed});
    stepPlayers([p],[{z:0,jump:true}],c,0,1/90);
    for(let i=1;i<90&&!p.fallCount;i++) stepPlayers([p],[{z:0}],c,i/90,1/90);
    return p;
  };
  const slow=run(0);assert.ok(slow.z<60 || slow.fallCount>0);
  const fast=run(18);assert.ok(fast.landCount>0 && fast.z>60);assert.equal(fast.fallCount,0);
});

test('눈꽃은 단순 비례 조향과 서로 다른 점프 시점으로 세 출발 위치에서 완주한다',()=>{
  for(const start of [-6,0,6]) for(const lead of [1.2,2]) {
    const {p}=ski(start,lead);
    assert.equal(p.finished,true,JSON.stringify({start,lead,p}));assert.equal(p.fallCount,0);assert.equal(p.jumpCount,5);
  }
});

test('초코 진흙탕은 진흙 위에서 멈추면 소용돌이에 빠지고, 비스듬히 버티며 달리면 빠져나간다',()=>{
  const run=(input,z)=>{
    const c=createCourse('choco-swamp');c.obstacles=c.obstacles.filter(o=>o.type==='vortex');
    const p=Object.assign(createRacer(),{x:0,z});
    for(let i=0;i<360;i++) stepPlayers([p],[input],c,5+i/90,1/90);
    return p;
  };
  assert.ok(run({},24).fallCount>=1,'가운데 진흙도 안전하지 않음');
  const escape=run({x:-.5,z:.85},20);
  assert.equal(escape.fallCount,0);assert.ok(escape.z>34,'다음 구간까지 나감');
});

test('소용돌이 만은 바깥 고리에서 가만히 있어도 끌려가 탈락한다',()=>{
  const c=createCourse('whirlpool-bay','survival');c.obstacles=c.obstacles.filter(o=>o.type==='vortex');
  const p=Object.assign(createRacer(),{x:0,z:44});
  for(let i=0;i<90*10&&!p.eliminated;i++) stepPlayers([p],[{}],c,20+i/90,1/90);
  assert.equal(p.eliminated,true);
});

test('회전 미로는 양쪽 측벽 우회를 막고 매 주기 안쪽 통로를 연다',()=>{
  const c=createCourse('rotating-maze');c.obstacles=c.obstacles.filter(o=>o.type!=='bumper');
  for(const x of [-20.5,20.5]) {
    const p=Object.assign(createRacer(),{x,z:24});
    for(let i=0;i<90*12;i++) stepPlayers([p],[{z:1}],c,i/90,1/90);
    assert.ok(p.z<31);assert.equal(p.fallCount,0);
  }
  for(const row of [32,52]) {
    const walls=c.obstacles.filter(o=>o.z===row);
    const open=time=>Array.from({length:65},(_,i)=>i*.5-16).some(x=>walls.every(o=>{
      const q=obstaclePose(o,time),dx=x-q.x,cos=Math.cos(q.rotation),sin=Math.sin(q.rotation);
      return Math.abs(dx*cos)>o.w/2+PHYSICS.bodyRadius || Math.abs(dx*sin)>o.d/2+PHYSICS.bodyRadius;
    }));
    for(const cycle of [0,6,12]) assert.ok(Array.from({length:61},(_,i)=>cycle+i*.1).some(open),'각 회전 주기마다 몸이 지나갈 틈');
    for(const wall of walls.filter(o=>o.type==='wall')) assert.ok(Math.abs(wall.x)-wall.w/2>17,'회전 반경과 고정 벽 분리');
  }
});

test('시소는 직선·가로 구간 모두 로컬 좌우 높이가 변하고 최대 각도를 지킨다',()=>{
  const c=createCourse('seesaw-trail');c.obstacles=[];
  for(const board of c.platforms.filter(t=>t.type==='seesaw')) {
    c.collapsed[board.id]=.25;
    const cos=Math.cos(board.rotation),sin=Math.sin(board.rotation);
    const height=(x,z)=>supportAt(c,board.x+x*cos+z*sin,board.z-x*sin+z*cos,1).y;
    assert.ok(height(2,0)>height(-2,0)+.9);
    assert.ok(Math.abs(height(0,2)-height(0,-2))<1e-8);
    const p=Object.assign(createRacer(),{supportId:board.id});
    for(let i=0;i<300;i++) {
      Object.assign(p,{x:board.x+3*cos,z:board.z-3*sin,y:board.y+3*Math.tan(c.collapsed[board.id]),vy:0,grounded:true});
      stepPlayers([p],[{}],c,2+i/90,1/90);
    }
    assert.equal(c.collapsed[board.id],-.35);
    assert.ok(Math.abs(p.y-supportAt(c,p.x,p.z,6).y)<.01,'탑승자 높이와 판정 일치');
  }
});

test('로켓 패드는 정면 비행 거리가 기존의 약 네 배이고 모든 착지가 코스에 남으며 펀치 링은 불변이다',()=>{
  const launch=(index,old=false)=>{
    const c=createCourse('rocket-road');c.obstacles=[];
    const pad=c.platforms.filter(t=>t.type==='boost')[index];
    if(old) Object.assign(pad,{power:19,lift:4.5});
    const p=Object.assign(createRacer(),{x:pad.x,z:pad.z,y:pad.y});
    for(let i=0;i<180&&!p.landCount&&!p.fallCount;i++) stepPlayers([p],[{}],c,(i+1)/90,1/90);
    assert.ok(p.landCount>0);assert.equal(p.fallCount,0);assert.ok(p.grounded);
    return {distance:Math.hypot(p.x-pad.x,p.z-pad.z),p,c,pad};
  };
  for(let i=0;i<5;i++) {
    const current=launch(i),old=launch(i,true),ratio=current.distance/old.distance;
    assert.ok(ratio>=3.5 && ratio<=4.5,JSON.stringify({i,ratio}));
    for(let frame=0;frame<27;frame++) stepPlayers([current.p],[{x:current.pad.dirX,z:current.pad.dirZ}],current.c,2+frame/90,1/90);
    assert.equal(current.p.fallCount,0);
  }
  assert.equal(PHYSICS.boostPower,19);assert.equal(PHYSICS.boostLift,4.5);
  for(const pad of createCourse('punch-arena').platforms.filter(t=>t.type==='boost')) {assert.equal(pad.power,19);assert.equal(pad.lift,undefined);}
});

test('구름에 추가한 두 트램펄린은 공중 입력 없이 각각 바로 다음 섬에 착지한다',()=>{
  const c=createCourse('cloud-hop'),pads=c.platforms.filter(t=>t.type==='trampoline');
  assert.equal(pads.length,3);
  for(const [i,pad] of pads.slice(1).entries()) {
    const next=c.platforms[i?4:2],p=Object.assign(createRacer(),{x:pad.x,z:pad.z,y:pad.y});
    for(let frame=0;frame<180&&!p.landCount&&!p.fallCount;frame++) stepPlayers([p],[{}],c,(frame+1)/90,1/90);
    assert.equal(p.fallCount,0);assert.equal(p.landCount,1);assert.equal(p.supportId,next.id);
  }
});

test('빙글빙글 원판은 두 배 빠르고 가장자리는 밀리지만 안쪽 입력과 중심은 안전하다',()=>{
  for(const rule of ['race','survival']) {
    const c=createCourse('spin-city',rule);c.obstacles=[];
    const boards=c.platforms.filter(t=>t.type==='rotating');
    assert.deepEqual(boards.map(t=>t.speed),rule==='race'?[-2.3,2]:[1.1]);
    for(const board of boards) {
      const run=(radius,inward)=>{
        const field={...c,platforms:[board]},p=Object.assign(createRacer(),{x:board.x+radius,z:board.z,y:board.y,supportId:board.id});
        let outside=false;
        for(let i=0;i<270&&!p.eliminated&&!p.fallCount;i++) {
          const dx=board.x-p.x,dz=board.z-p.z,d=Math.hypot(dx,dz),input=inward&&d>1?{x:dx/d,z:dz/d}:{};
          stepPlayers([p],[input],field,5+i/90,1/90);
          outside ||= Math.hypot(p.x-board.x,p.z-board.z)>board.w/2+.2;
        }
        return {outside,p};
      };
      assert.equal(run(board.w/2-.7,false).outside,true);
      const held=run(board.w/2-.7,true);assert.equal(held.outside,false);assert.equal(held.p.eliminated,false);assert.equal(held.p.fallCount,0);
      assert.equal(run(.1,false).outside,false);
      const calm={...board,fling:undefined},p=Object.assign(createRacer(),{x:calm.x+2,z:calm.z,y:calm.y,supportId:calm.id});
      for(let i=0;i<90;i++) stepPlayers([p],[{}],{...c,platforms:[calm]},5+i/90,1/90);
      assert.ok(Math.abs(Math.hypot(p.x-calm.x,p.z-calm.z)-2)<.01,'속성이 없는 원판은 원심력 없음');
    }
  }
});

test('빨라진 두 통나무는 서브스텝 사이에서도 밀어내고 타이밍 점프로 피한다',()=>{
  const c=createCourse('log-lake');assert.deepEqual(c.obstacles.map(o=>o.speed),[1.35,1.05]);
  for(const log of c.obstacles) {
    const field={...c,obstacles:[log]},time=(Math.PI*2-log.phase)/log.speed;
    const run=jump=>{
      const p=Object.assign(createRacer(),{x:0,z:6});
      let hits=0;
      for(let i=0;i<30;i++) {
        stepPlayers([p],[{jump:jump && i===0}],field,time-.25+(i+1)/60,1/60);
        hits+=p.hitCooldown>0;
      }
      return {p,hits};
    };
    const idle=run(false),jump=run(true);
    assert.ok(idle.hits>0);assert.ok(Math.hypot(idle.p.x,idle.p.z-6)>1);
    assert.equal(jump.hits,0);assert.equal(jump.p.eliminated,false);
    assert.ok(log.range*log.speed*PHYSICS.substep<Math.min(log.w,log.d)/2,'최대 장애물 이동이 두께 절반 미만');
  }
});

test('용암 정상은 경고 뒤 분화해 대기자를 탈락시키고 네 뗏목은 수위와 탑승자를 올린다',()=>{
  const c=createCourse('lava-rise');c.obstacles=[];
  const top=c.platforms.find(t=>t.type==='disappear');
  assert.equal(platformTiming(top,14.5).warning,true);assert.equal(platformTiming(top,15.5).active,false);
  const p=Object.assign(createRacer(),{x:2,z:27,y:4.5});
  for(let i=0;i<90*10&&!p.eliminated;i++) stepPlayers([p],[{}],c,45+i/90,1/90);
  assert.equal(p.eliminated,true);assert.ok(p.eliminatedAt>=51.3 && p.eliminatedAt<52.3,'후반 분화 때 바로 용암으로 추락');
  const rafts=c.platforms.filter(t=>t.type==='float');assert.equal(rafts.length,4);
  for(const raft of rafts) {
    const rider=Object.assign(createRacer(),{x:raft.x,z:raft.z,y:platformPose(raft,10,{},c).y,supportId:raft.id});
    for(let i=0;i<90*50;i++) stepPlayers([rider],[{}],c,10+(i+1)/90,1/90);
    assert.equal(rider.eliminated,false);assert.ok(rider.y>4.8);
    assert.ok(Math.abs(rider.y-floodLevel(c,60)-raft.clearance)<.001);
  }
  const full=createCourse('lava-rise');
  for(const bumper of full.obstacles.filter(o=>o.float)) assert.ok(obstaclePose(bumper,60,full).y>4.8);
  for(const fromTop of [true,false]) {
    const p=Object.assign(createRacer(),{x:fromTop?3.8:10.2,z:27,y:fromTop?4.5:4.85,vx:fromTop?10:-10});
    for(let i=0;i<90&&!p.landCount&&!p.eliminated;i++) stepPlayers([p],[{x:fromTop?1:-1,jump:i===0}],c,54+i/90,1/90);
    assert.equal(p.eliminated,false);assert.equal(p.landCount,1);
    assert.equal(c.platforms.find(t=>t.id===p.supportId).type,fromTop?'float':'disappear','수위가 최고여도 정상과 뗏목 왕복');
  }
});

test('붕괴 탑은 내 높이와 관전 대상 높이에 맞춰 위층만 흐리게 하고 붕괴 상태를 유지한다',()=>{
  const c=createCourse('triple-drop'),layers=[12,6,0],faded=y=>layers.filter(h=>layerFaded(c.id,h,y));
  assert.deepEqual(faded(12),[]);assert.deepEqual(faded(6),[12]);assert.deepEqual(faded(0),[12,6]);
  assert.deepEqual(faded(9.9),[12]);assert.deepEqual(faded(3.9),[12,6]);
  assert.deepEqual(faded(undefined),[]);assert.equal(layerFaded('leaf-square',12,0),false);
  const tile=c.platforms[0];c.collapsed[tile.id]=4;
  assert.equal(layerFaded(c.id,tile.y,6),true);assert.equal(platformTiming(tile,5,c.collapsed).active,false);
  assert.equal(layerFaded(c.id,tile.y,12),false);assert.equal(platformTiming(tile,6,c.collapsed).active,false);
});

test('소용돌이 만은 예전보다 빨리 탈락시키지만 바깥 조작으로 8초 버티고 초코는 불변이다',()=>{
  const run=(force,escape=false)=>{
    const c=createCourse('whirlpool-bay');c.obstacles=c.obstacles.filter(o=>o.type==='vortex');c.obstacles[0].force=force;
    const p=Object.assign(createRacer(),{x:0,z:44});let frame=0;
    for(;frame<720&&!p.eliminated;frame++) {
      const dx=p.x,dz=p.z-29.6,d=Math.hypot(dx,dz),input=escape && d<15?{x:dx/d,z:dz/d}:{};
      stepPlayers([p],[input],c,20+frame/90,1/90);
    }
    return {p,frame};
  };
  assert.equal(createCourse('whirlpool-bay').obstacles.find(o=>o.type==='vortex').force,85);
  assert.ok(run(85).frame<run(65).frame);assert.equal(run(85,true).p.eliminated,false);
  assert.deepEqual(createCourse('choco-swamp').obstacles.filter(o=>o.type==='vortex').map(o=>o.force),[58,58,56]);
});

test('슬라이딩은 정면 접촉만 한 번 강타하고 뒤·원거리·보호·완주·탈락은 제외한다',()=>{
  const c=createCourse('log-lake');c.obstacles=[];c.platforms=[{id:'p0',type:'normal',x:0,z:0,y:0,w:100,d:100}];
  const pair=(z=1.4)=>[Object.assign(createRacer(),{x:0,z:0}),Object.assign(createRacer(),{x:0,z})];
  const impact=(dive,time=5,z=1.4,extra={})=>{
    const ps=pair(z);Object.assign(ps[1],extra);stepPlayers(ps,[{z:1,dive},{}],c,time,1/90);return ps;
  };
  const hit=impact(true),normal=impact(false);
  assert.ok(hit[1].vz>normal[1].vz+12);assert.ok(hit[1].vy>=3);assert.equal(hit[0].diveHits.size,1);
  const attacker=hit[0],target=hit[1];Object.assign(attacker,{x:0,z:0});Object.assign(target,{x:0,z:1,y:attacker.y,vy:0,vz:0});
  stepPlayers(hit,[{},{}],c,5+1/90,1/90);assert.ok(target.vz<10,'같은 슬라이딩 재적중 없음');assert.equal(attacker.diveHits.size,1);
  for(const [z,time,extra] of [[-1,5,{}],[4,5,{}],[1.4,1,{}],[1.4,5,{ghostTime:.8}],[1.4,5,{finished:true}],[1.4,5,{eliminated:true}]]) assert.equal(impact(true,time,z,extra)[0].diveHits.size,0);
  const ghosts=pair();ghosts[0].ghostTime=.8;stepPlayers(ghosts,[{z:1,dive:true},{}],c,5,1/90);assert.equal(ghosts[0].diveHits.size,0);
  for(const [time,vx,vz] of [[0,0,18],[.3,18,0]]) {
    const ps=pair(1);Object.assign(ps[0],{diveTime:time,diveHits:new Set(),vx,vz,grounded:false,diveCooldown:.8});
    stepPlayers(ps,[{},{}],c,6,1/90);assert.equal(ps[0].diveHits.size,0,'활성 시간이 끝났거나 이동 방향 앞이 아니면 무적중');
  }
  Object.assign(attacker,{x:0,z:0,vy:0,vz:18,diveTime:0});Object.assign(target,{x:0,z:1.4,y:attacker.y,vy:0,vz:0});
  const cooldown=attacker.diveCooldown;
  stepPlayers(hit,[{z:1,dive:true},{}],c,6,1/90);assert.equal(attacker.diveTime,0);assert.ok(attacker.diveCooldown<cooldown);
  Object.assign(attacker,{x:0,z:0,y:0,vy:0,vz:0,diveCooldown:0,diveHeld:false});Object.assign(target,{x:0,z:1.4,y:0,vy:0,vz:0});
  stepPlayers(hit,[{z:1,dive:true},{}],c,7,1/90);assert.ok(target.vz>12);assert.equal(attacker.diveHits.size,1,'다음 슬라이딩은 적중 기록 초기화');
  c.obstacles=[{type:'wall',x:0,z:3,w:20,d:1,h:4,y:0}];
  const wallHit=pair();for(let i=0;i<60;i++) stepPlayers(wallHit,[{z:1,dive:i===0},{}],c,5+i/90,1/90);
  assert.ok(wallHit.every(p=>p.z<=1.961),'밀친 뒤에도 벽 충돌');
});
