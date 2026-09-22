import test from "node:test";
import assert from "node:assert/strict";
import { MAPS,createCourse,createRacer,stepPlayers,platformPose,platformActive,supportAt,conveyorVelocity } from '../public/world.js';
export function driveCourse(id, keepFans=false) {
  const c=createCourse(id); c.obstacles=keepFans?c.obstacles.filter(o=>o.type==='fan'):[];
  const p=Object.assign(createRacer(),{x:0,z:6});
  const points=id==='door-festival'?[{x:0,z:24},{x:-18,z:32},{x:-18,z:51},{x:0,z:58},c.finish]:c.path.slice(1);
  let goal=0,frame=0;
  const floor=(x,z,time)=>c.platforms.some(t=>{const q=platformPose(t,time),dx=x-q.x,dz=z-q.z,cos=Math.cos(q.rotation||0),sin=Math.sin(q.rotation||0);return Math.abs(dx*cos-dz*sin)<q.w/2 && Math.abs(dx*sin+dz*cos)<q.d/2 && Math.abs(q.y-p.y)<3 && platformActive(q,time,c.collapsed)});
  for(;frame<18000&&!p.finished;frame++) {
    const target=points[goal]; const dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz),nx=dx/(d||1),nz=dz/(d||1),time=frame/90;
    if(d<(id==='neon-factory'?3.2:.9) && Math.abs(p.y-(target.y||0))<.7 && goal<points.length-1) {goal++;continue;}
    let x=nx,z=nz,jump=false;
    if(d<5) {x=dx*.4-p.vx*.18;z=dz*.4-p.vz*.18;}
    // 강한 벨트 위에서는 자동 주행도 바닥 이동을 거슬러 조향해야 합니다.
    const surface=p.grounded?supportAt(c,p.x,p.z,time,p.y+.1):null;
    if(surface?.type==='conveyor') {const drift=conveyorVelocity(surface);x-=drift.x/10;z-=drift.z/10;}
    if(p.grounded&&!floor(p.x+nx*1.1,p.z+nz*1.1,time)) {
      if(floor(p.x+nx*6,p.z+nz*6,time+.6)||floor(p.x+nx*7.5,p.z+nz*7.5,time+.75)) {jump=true;x=nx;z=nz;}
      else {x=0;z=0;}
    }
    stepPlayers([p],[{x,z,jump}],c,time,1/90);
  }
  return {id,finished:p.finished,time:(frame/90).toFixed(1),falls:p.fallCount,goal,checkpoint:p.checkpoint,position:[p.x,p.y,p.z].map(n=>n.toFixed(1))};
}

test("12개 레이스의 전체 동선을 실제 물리로 완주할 수 있다",()=>{for(const m of MAPS.filter(m=>m.rules.includes("race"))){const r=driveCourse(m.id);assert.equal(r.finished,true,JSON.stringify(r));assert.ok(r.falls<=2,JSON.stringify(r));}});

test('강한 선풍기를 켜도 바람 골짜기와 카오스 크라운의 코스를 조작으로 완주한다',()=>{
  for(const id of ['wind-valley','chaos-crown']) {
    const r=driveCourse(id,true);assert.equal(r.finished,true,JSON.stringify(r));assert.equal(r.falls,0,JSON.stringify(r));
  }
});
