import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { MAPS, PHYSICS, createCourse, createRacer, platformTiming, supportAt, stepPlayers } from '../public/world.js';
import { GIMMICKS } from '../public/catalog.js';
import { GameScene } from '../public/scene.js';
import { setup, client, roomWhere, ofType, prepareRoom } from './helpers.js';

test('젤리 스모 링은 생존 결승이며 30명 출발 바닥·도감·팁과 영구 중앙 원판을 갖춘다',()=>{
  const map=MAPS.find(m=>m.id==='sumo-ring'),c=createCourse(map.id);
  assert.deepEqual(map.rules,['survival']);assert.equal(map.final,true);
  assert.equal(MAPS.filter(m=>m.emoji===map.emoji).length,1);
  assert.match(c.tip,/슬라이딩/);assert.ok(GIMMICKS.sumo);assert.equal(c.finish,null);
  assert.equal(c.obstacles.length,0);assert.equal(c.platforms.length,37);
  assert.equal(Math.max(...c.platforms.map(p=>p.w)),38);
  for(let i=0;i<30;i++) {
    const p=createRacer(i,30);assert.ok(supportAt(c,p.x,p.z,0));
    stepPlayers([p],[{}],c,PHYSICS.survivalGrace,1/90);assert.equal(p.grounded,true);
  }
  const center=c.platforms.find(p=>p.innerRadius===0);
  assert.equal(center.w,12);
  for(const time of [0,3,18,27,36,60,3600]) {
    assert.equal(platformTiming(center,time).active,true);assert.equal(platformTiming(center,time).warning,false);
    assert.ok(supportAt(c,0,6,time));
  }
});

test('고리는 바깥→안쪽 18·27·36초에 영구 붕괴하고 각각 1.5초 전부터 경고한다',()=>{
  const c=createCourse('sumo-ring');
  for(const [inner,drop] of [[14,18],[10,27],[6,36]]) {
    const ring=c.platforms.filter(p=>p.innerRadius===inner);assert.equal(ring.length,12);
    assert.ok(drop-1.5>PHYSICS.survivalGrace);
    for(const p of ring) {
      assert.equal(platformTiming(p,drop-1.501).warning,false);
      assert.equal(platformTiming(p,drop-1.5).warning,true);
      assert.equal(platformTiming(p,drop-.001).active,true);
      for(const time of [drop,drop+1,60,3600]) assert.equal(platformTiming(p,time).active,false);
      assert.equal(platformTiming(p,drop).warning,false);
    }
    assert.equal(c.platforms.filter(p=>platformTiming(p,drop).active).length,drop===18?25:drop===27?13:1);
  }
  for(let angle=0;angle<Math.PI*2;angle+=.07) for(const [time,radius] of [[0,19],[18,14],[27,10],[36,6]]) {
    const point=r=>[r*Math.cos(angle),6+r*Math.sin(angle)];
    for(let r=0;r<radius;r+=.3) assert.ok(supportAt(c,...point(r),time),JSON.stringify({angle,time,r}));
    assert.equal(supportAt(c,...point(radius+.3),time),null);
  }
});

test('클라이언트에 제공한 모듈과 서버의 고리 시간 판정은 시드·접촉 기록과 무관하게 같다',async t=>{
  const app=await setup(t);
  const sources=await Promise.all(['/world.js','/courses.js'].map(async path=>{
    const response=await fetch(app.url+path);assert.equal(response.status,200);return response.text();
  }));
  const moduleURL=source=>'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
  const browser=await import(moduleURL(sources[0].replace("'./courses.js'",JSON.stringify(moduleURL(sources[1])))));
  const server=createCourse('sumo-ring','survival',123),remote=browser.createCourse('sumo-ring','survival',456);
  assert.deepEqual(remote.platforms,server.platforms);
  for(const p of server.platforms) for(const time of [0,3,16.499,16.5,17.999,18,25.5,27,34.5,36,60]) {
    Object.freeze(p);
    const collapsed=Object.freeze({[p.id]:time});
    assert.deepEqual(browser.platformTiming(p,time,collapsed,456),platformTiming(p,time,{},123));
  }
});

test('실제 3D 호의 윗면과 서버 바닥 판정이 네 수축 단계에서 일치한다',()=>{
  const c=createCourse('sumo-ring'),scene=Object.create(GameScene.prototype);
  Object.assign(scene,{course:c,content:new THREE.Group(),platforms:[],geometries:{box:new THREE.BoxGeometry()},materials:new Map(),label:()=>new THREE.Object3D()});
  scene.buildCourse();scene.content.updateMatrixWorld(true);
  const ray=new THREE.Raycaster(),down=new THREE.Vector3(0,-1,0);
  for(const time of [0,18,27,36]) {
    const meshes=scene.platforms.filter(({data})=>platformTiming(data,time).active).map(({group})=>group.userData.jelly);
    for(let angle=.13;angle<Math.PI*2;angle+=.37) for(const r of [0,5.8,6.3,9.8,10.3,13.8,14.3,18.8,19.3]) {
      const x=r*Math.cos(angle),z=6+r*Math.sin(angle);
      ray.set(new THREE.Vector3(x,2,z),down);
      assert.equal(ray.intersectObjects(meshes).length>0,Boolean(supportAt(c,x,z,time)),JSON.stringify({time,r,angle}));
    }
  }
  for(const geometry of Object.values(scene.geometries)) geometry.dispose();
  for(const material of scene.materials.values()) material.dispose();
});

test('스모 링의 슬라이딩 밀어내기는 중앙 밖 상대를 실제로 탈락시킨다',()=>{
  const c=createCourse('sumo-ring'),ps=[Object.assign(createRacer(),{x:0,z:9.8}),Object.assign(createRacer(),{x:0,z:11.2})];
  stepPlayers(ps,[{z:1,dive:true},{}],c,40,1/90);
  assert.ok(ps[1].vz>12);assert.ok(ps[1].vy>=3);
  for(let i=1;i<180&&!ps[1].eliminated;i++) stepPlayers(ps,[{},{}],c,40+i/90,1/90);
  assert.equal(ps[1].eliminated,true);
});

test('스모 링은 탈락전 결승과 단판 생존에서 마지막 생존자로 종료한다',async t=>{
  for(const mode of ['elimination','single']) await t.test(mode,async t=>{
    const app=await setup(t),host=await client(app.url);
    host.send({type:'create',name:'중앙'});const w=await host.wait(ofType('welcome'));
    const guest=await client(app.url);guest.send({type:'join',code:w.code,name:'바깥'});const g=await guest.wait(ofType('welcome'));
    host.send({type:'settings',matchMode:mode,roundRule:'survival',mapId:'sumo-ring'});
    await host.wait(roomWhere(r=>r.settings.mapId==='sumo-ring'));await prepareRoom([guest],host,2);
    host.send({type:'start'});await host.wait(roomWhere(r=>r.phase==='playing'));
    const room=app.rooms.get(w.code);
    assert.equal(room.rule,'survival');assert.equal(room.isFinal,mode==='elimination');
    room.startsAt=Date.now()-37_000;room.endsAt=room.startsAt+60_000;
    Object.assign(room.players.get(w.id).racer,{x:0,z:6});Object.assign(room.players.get(g.id).racer,{x:0,z:14});
    const result=(await host.wait(roomWhere(r=>r.phase==='results'))).room;
    assert.equal(result.results.find(r=>r.id===w.id).status,'survived');
    assert.equal(result.results.find(r=>r.id===g.id).status,'eliminated');
    if(mode==='elimination') {assert.equal(result.winnerId,w.id);assert.equal(result.matchOver,true);}
  });
});

test('결승 맵을 모두 썼어도 같은 규칙의 직전 결승 맵은 재선택하지 않는다',async t=>{
  for(const [rule,mapId,random] of [['survival','sumo-ring',.999],['race','spin-city',0]]) await t.test(rule,async t=>{
    t.mock.method(Math,'random',()=>random);
    const app=await setup(t),host=await client(app.url);
    host.send({type:'create',name:'결승'});const w=await host.wait(ofType('welcome'));
    const guest=await client(app.url);guest.send({type:'join',code:w.code,name:'재결승'});await guest.wait(ofType('welcome'));
    host.send({type:'settings',mapId});await host.wait(roomWhere(r=>r.settings.mapId===mapId));await prepareRoom([guest],host,2);
    host.send({type:'start'});await host.wait(roomWhere(r=>r.phase==='playing'));
    const room=app.rooms.get(w.code);assert.equal(room.isFinal,true);assert.equal(room.rule,rule);
    if(rule==='race') room.roundPlayers.forEach(p=>Object.assign(p.racer,{finished:true,finishTime:1}));
    room.endsAt=Date.now()-1;await host.wait(roomWhere(r=>r.phase==='results'));
    room.playedMaps=[...MAPS.filter(m=>m.final&&m.rules.includes(rule)&&m.id!==mapId).map(m=>m.id),mapId];
    room.tieBreak=rule==='race';host.send({type:'next'});
    const next=(await host.wait(roomWhere(r=>r.phase==='playing'&&r.round===2))).room;
    assert.equal(next.rule,rule);assert.notEqual(next.mapId,mapId);assert.ok(MAPS.find(m=>m.id===next.mapId).final);
  });
});
