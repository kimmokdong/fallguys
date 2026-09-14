import test from 'node:test';
import assert from 'node:assert/strict';
import {StateEncoder,StateDecoder,packPlayer} from '../public/network.js';
import {createRacer} from '../public/world.js';
const players=()=>Array.from({length:30},(_,i)=>({...createRacer(i),id:'p'+i,netId:i,participating:true,x:i*4.12345-40,y:i*.1211,z:i*2.31,vx:4.256,vy:-3.582,vz:9.023,yaw:-3.012345,progress:i/31}));
const snapshot=(ps,time=1,collapsed={})=>({epoch:1234,time,players:ps,collapsed});
const reader=ps=>{const d=new StateDecoder();d.setRoom({startsAt:1234,players:ps});return d;};
test('30명 전체 상태는 1.2KB 이내, 좌표·속도·효과음·순위 정보는 정확히 복원한다',()=>{
 const ps=players();Object.assign(ps[0],{jumpCount:300,landCount:290,fallCount:21,finished:true,finishTime:123.4567,checkpoint:11,diveCooldown:1.16,bumpTime:.23,hitCooldown:.79});
 const before=structuredClone(ps),e=new StateEncoder(),d=reader(ps),wire=e.encode(snapshot(ps,12.345),'p0',{now:0});
 assert.ok(wire.length<1200);const result=d.decode(wire);assert.equal(result.players.length,30);
 ps.forEach((p,i)=>{const a=result.players[i];for(const k of ['x','y','z','vx','vy','vz'])assert.ok(Math.abs(a[k]-p[k])<.006,k);assert.ok(Math.abs(a.yaw-p.yaw)<.0001);assert.ok(Math.abs(a.progress-p.progress)<1/65535);});
 assert.equal(result.players[0].jumpCount,300);assert.equal(result.players[0].fallCount,21);assert.equal(result.players[0].finishTime,123.457);assert.equal(result.players[0].checkpoint,11);assert.equal(result.players[0].diveCooldown,1.16);assert.deepEqual(ps,before);
});
test('변화 없는 선수는 보존, 먼 선수는 저빈도, 완주·복귀와 발판 변화는 즉시 전달한다',()=>{
 const ps=players();ps[0].x=0;ps[1].x=200;const e=new StateEncoder(),d=reader(ps);d.decode(e.encode(snapshot(ps),'p0',{now:0}));
 const changed=structuredClone(ps);changed[0].x=1;changed[1].x=201;
 const update=d.decode(e.encode(snapshot(changed,1.1,{p12:.5}),'p0',{now:100}));assert.equal(update.players.length,30);assert.equal(update.players[0].x,1);assert.equal(update.players[1].x,200);assert.equal(update.collapsed.p12,.5);
 changed[1].finished=true;changed[1].finishTime=1.12;const done=d.decode(e.encode(snapshot(changed,1.12,{p12:.5}),'p0',{now:120}));assert.equal(done.players[1].x,201);assert.equal(done.players[1].finished,true);
 changed[2].fallCount++;changed[2].x=100;const reset=d.decode(e.encode(snapshot(changed,1.2),'p0',{now:200}));assert.equal(reset.players[2].fallCount,1);assert.equal(reset.collapsed.p12,undefined);
 assert.equal(e.encode(snapshot(changed,1.21),'p0',{now:210}),null);
});
test('전체 재동기화는 누락된 변경분·관전·탭 복귀를 복구하고 이전 라운드는 무시한다',()=>{
 const ps=players(),e=new StateEncoder(),d=reader(ps);d.decode(e.encode(snapshot(ps),'p0',{now:0}));
 const changed=structuredClone(ps);changed[0].x=50;e.encode(snapshot(changed,2,{p10:1.5}),'p0',{now:100}); // 수신 누락을 가정
 const recovered=d.decode(e.encode(snapshot(changed,3,{p10:1.5}),'p0',{now:2100}));assert.equal(recovered.players[0].x,50);assert.equal(recovered.collapsed.p10,1.5);
 assert.equal(e.encode(snapshot(changed,3.1),'p0',{now:2200,hidden:true}),null);
 changed[1].x=99;assert.equal(d.decode(e.encode(snapshot(changed,3.1),'p1',{now:2200,full:true})).players[1].x,99);
 const old=e.encode(snapshot(ps,4),'p0',{now:3000,full:true});d.setRoom({startsAt:4321,players:ps});assert.equal(d.decode(old),null);assert.equal(d.players.size,0);
});
test('강퇴·퇴장과 번호 재사용 때 이전 참가자가 남지 않고 잘린 패킷은 거부한다',()=>{
 const ps=players(),e=new StateEncoder(),d=reader(ps),wire=e.encode(snapshot(ps),'p0',{now:0});d.decode(wire);
 assert.throws(()=>d.decode(wire.subarray(0,wire.length-1)));assert.equal(d.players.size,30);
 const next=ps.slice(1);d.setRoom({startsAt:1234,players:next});assert.equal(d.players.has(0),false);
 d.setRoom({startsAt:1234,players:[{...ps[1],id:'new',netId:1}]});assert.equal(d.players.size,0);
 assert.equal(packPlayer({...ps[0],x:5000}).byteLength,38);
});
