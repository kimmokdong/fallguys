import test from 'node:test';
import assert from 'node:assert/strict';
import {MAPS,createCourse,createRacer,stepPlayers,supportAt,platformPose,platformTiming,obstaclePose,signalState} from '../public/world.js';
import {StateEncoder,StateDecoder} from '../public/network.js';

test('새 맵 열두 가지에서 30명의 입력·몸싸움·낙하를 처리해도 좌표와 시소 각도는 유한하다',()=>{
  for(const id of ['seesaw-trail','signal-square','rotating-maze','snow-jumps','rocket-road','choco-swamp','tiptoe-bridge','sky-tower','lava-rise','triple-drop','whirlpool-bay','punch-arena']) {
    const c=createCourse(id,MAPS.find(m=>m.id===id).rules[0]),players=Array.from({length:30},(_,i)=>createRacer(i,30,c.spawnY||0));
    for(let frame=0;frame<360;frame++) {
      stepPlayers(players,players.map((_,i)=>({x:Math.sin(i+frame*.03),z:1,jump:frame%35===i%35})),c,frame/30,1/30);
      assert.ok(players.every(p=>[p.x,p.y,p.z,p.vx,p.vy,p.vz].every(Number.isFinite)),id);
    }
    if(id==='seesaw-trail') assert.ok(Object.values(c.collapsed).every(angle=>Math.abs(angle)<=.3));
  }
});

test('시소는 무게가 몰린 끝이 내려가고 균형을 잡으면 수평이며 상태 패킷도 일치한다',()=>{
  const c=createCourse('seesaw-trail'),board=c.platforms.find(p=>p.type==='seesaw');
  const make=z=>Object.assign(createRacer(),{x:board.x,z:board.z+z,y:board.y,supportId:board.id,netId:0,id:'test'});
  const p=make(board.d*.3);
  for(let i=0;i<60;i++) stepPlayers([p],[{}],c,(i+1)/90,1/90);
  assert.ok(c.collapsed[board.id]<-.02); assert.ok(p.y<board.y); assert.equal(p.fallCount,0);
  const decoder=new StateDecoder(); decoder.setRoom({startsAt:1234,players:[{...p,participating:true}]});
  const state=decoder.decode(new StateEncoder().encode({epoch:1234,time:1,players:[p],collapsed:c.collapsed},p.id));
  assert.ok(Math.abs(platformPose(board,1,state.collapsed).rise-platformPose(board,1,c.collapsed).rise)<.00001);
  c.collapsed={};const balanced=[make(-3),make(3)];
  stepPlayers(balanced,[{},{}],c,1,1/90);assert.equal(c.collapsed[board.id],0);
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

test('미로 벽은 경고 뒤 90도 회전하고 높은 벽은 점프로 통과하거나 반동으로 넘어갈 수 없다',()=>{
  const c=createCourse('rotating-maze'),wall=c.obstacles.find(o=>o.type==='maze-wall');
  assert.equal(obstaclePose(wall,0).rotation,obstaclePose(wall,4).rotation);
  assert.equal(obstaclePose(wall,3.5).warning,true);
  assert.ok(obstaclePose(wall,7).rotation>0);assert.equal(obstaclePose(wall,8).rotation,Math.PI/2);
  const p=Object.assign(createRacer(),{x:wall.x,z:wall.z,y:2,vy:0,grounded:false});
  stepPlayers([p],[{}],c,0,1/90);
  assert.ok(Math.abs(p.z-wall.z)>wall.d/2);assert.equal(p.hitCooldown,0);
});

function ski() {
  const c=createCourse('snow-jumps'),p=createRacer(0,1,c.spawnY);
  const islands=c.platforms.filter(p=>p.type==='ice'&&!p.rise);
  let jumpedFrom=null;
  for(let frame=0;frame<5400&&!p.finished&&!p.fallCount;frame++) {
    const time=frame/90,floor=supportAt(c,p.x,p.z,time,p.y+.1);
    const index=islands.findIndex(t=>t.id===floor?.id),target=islands[Math.min(index+1,islands.length-1)];
    const x=target?Math.max(-1,Math.min(1,(target.x-p.x)*.25-p.vx*.35)):0;
    const jump=p.grounded && index>=0 && index<islands.length-1 && p.z>=floor.z+floor.d/2-1.6 && jumpedFrom!==floor.id;
    if(jump) jumpedFrom=floor.id;
    stepPlayers([p],[{x,z:1,jump}],c,time,1/90);
  }
  return {c,p};
}

test('눈꽃 점프대는 내리막에서 가속해 다섯 점프를 연속 완주하고 중간 낙하는 높은 출발점으로 돌아간다',()=>{
  const {c,p}=ski();
  assert.equal(p.finished,true,JSON.stringify(p));assert.equal(p.fallCount,0);assert.equal(p.jumpCount,5);
  assert.equal(c.checkpoints.length,0);assert.ok(p.finishTime<60);
  const falling=Object.assign(createRacer(0,1,c.spawnY),{x:4,z:105,y:-6,vz:24});
  stepPlayers([falling],[{}],c,1,1/90);
  assert.equal(falling.fallCount,1);assert.equal(falling.z,falling.spawnZ);assert.ok(falling.y>=14);assert.equal(falling.vz,0);
});

test('눈꽃 발판 간격은 정지 상태의 점프로 넘을 수 없지만 가속한 도약은 넘는다',()=>{
  const c=createCourse('snow-jumps'),run=speed=>{
    const p=Object.assign(createRacer(0,1,c.spawnY),{x:0,z:48,y:5,vz:speed});
    stepPlayers([p],[{z:1,jump:true}],c,0,1/90);
    for(let i=1;i<120&&!p.fallCount;i++) stepPlayers([p],[{z:1}],c,i/90,1/90);
    return p;
  };
  for(const speed of [0,10]) {
    const slow=run(speed);assert.ok(slow.z<69 || slow.fallCount>0);assert.equal(slow.landCount,0);
  }
  const fast=run(24);assert.ok(fast.landCount>0 && fast.z>69);assert.equal(fast.fallCount,0);
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
