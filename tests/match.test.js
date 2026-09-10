import test from 'node:test';
import assert from 'node:assert/strict';
import { roundResults, hasNextRound, startingSlots } from '../public/match.js';
import { availableMaps } from '../public/world.js';
const players=n=>Array.from({length:n},(_,i)=>({id:String(i),name:'젤리'+i,racer:{finished:false,eliminated:false},socket:{}}));

test('레이스 절반 통과, 같은 순간의 경계 순위는 함께 통과, DNF 제외',()=>{
  const p=players(7);
  for(let i=0;i<6;i++) Object.assign(p[i].racer,{finished:true,finishTime:i===4?3:i});
  const rows=roundResults(p,{rule:'race',quota:4});
  assert.equal(rows.filter(r=>r.qualified).length,5);
  assert.deepEqual(rows.slice(0,6).map(r=>r.rank),[1,2,3,4,4,6]);
  assert.equal(rows[6].qualified,false);
});
test('생존은 실제 버틴 시간으로 순위를 정하고 시간까지 살아남으면 모두 통과',()=>{
  const p=players(8);
  [4,5,6,7].forEach((i)=>Object.assign(p[i].racer,{eliminated:true,eliminatedAt:i===7?6:i}));
  const rows=roundResults(p,{rule:'survival',time:60,quota:4});
  assert.deepEqual(rows.map(r=>r.rank),[1,1,1,1,5,5,7,8]);
  assert.equal(rows.filter(r=>r.qualified).length,4);
  assert.equal(roundResults(players(8),{rule:'survival',quota:4,time:60}).filter(r=>r.qualified).length,8);
});
test('경기 형식에 맞는 맵만 선택하고 결승 종료 후에는 다음 판을 열지 않는다',()=>{
  assert.equal(availableMaps('single','race').length,12);
  assert.equal(availableMaps('single','survival').length,6);
  assert.ok(availableMaps('series','survival').every(m=>m.rules.includes('race')));
  assert.equal(hasNextRound({settings:{matchMode:'elimination'},matchOver:true}),false);
  assert.equal(hasNextRound({settings:{matchMode:'elimination'},matchOver:false}),true);
});

const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
test('첫 판·단판·생존은 점수와 무관한 추첨이며 1~30명 슬롯이 중복되지 않는다',()=>{
  for(let n=1;n<=30;n++) {
    const p=players(n), ids=p.map(x=>x.id), scores=p.map((x,i)=>({id:x.id,score:i}));
    const base=startingSlots(p,{mode:'single',rule:'race',round:1},seeded(7));
    for(const options of [{mode:'series',rule:'race',round:1},{mode:'single',rule:'race',round:4},{mode:'series',rule:'survival',round:3},{mode:'elimination',rule:'survival',round:2}]) {
      assert.deepEqual(startingSlots(p,{...options,scores},seeded(7)),base);
    }
    assert.deepEqual([...base.values()].sort((a,b)=>a-b),Array.from({length:n},(_,i)=>i));
    assert.deepEqual(p.map(x=>x.id),ids);
  }
  assert.notDeepEqual(startingSlots(players(30),{round:1},seeded(7)),startingSlots(players(30),{round:1},seeded(9)));
});
test('누적 하위 점수가 앞줄이며 26명 부분 줄과 같은 줄 좌우 추첨을 지킨다',()=>{
  for(const n of [7,12,26,30]) {
    const p=players(n), scores=p.map((x,i)=>({id:x.id,score:i*10}));
    const slots=startingSlots(p,{mode:'series',rule:'race',round:2,scores},seeded(10));
    const rows=p.map(x=>Math.floor(slots.get(x.id)/6));
    assert.ok(rows.every((row,i)=>!i||row<=rows[i-1]));
    assert.equal(slots.size,n);
  }
  const p=players(30),scores=p.map((x,i)=>({id:x.id,score:i}));
  const a=startingSlots(p,{mode:'series',rule:'race',round:3,scores},seeded(1));
  const b=startingSlots(p,{mode:'series',rule:'race',round:3,scores},seeded(2));
  assert.notDeepEqual(a,b);
  p.forEach(x=>assert.equal(Math.floor(a.get(x.id)/6),Math.floor(b.get(x.id)/6)));
});
test('탈락전은 통과한 명단만 직전 하위 순위 우선, 공동 생존·동점은 추첨한다',()=>{
  const p=players(12), results=p.map((x,i)=>({id:x.id,rank:i+1}));
  const eligible=p.slice(0,7);
  const slots=startingSlots(eligible,{mode:'elimination',rule:'race',round:3,results},seeded(8));
  assert.equal(slots.get('6'),6); assert.equal(slots.has('7'),false);
  const tied=p.map(x=>({id:x.id,rank:1,score:20}));
  const random=startingSlots(p,{mode:'single',rule:'race',round:1},seeded(5));
  assert.deepEqual(startingSlots(p,{mode:'elimination',rule:'race',round:3,results:tied},seeded(5)),random);
  assert.deepEqual(startingSlots(p,{mode:'series',rule:'race',round:3,scores:tied},seeded(5)),random);
});
