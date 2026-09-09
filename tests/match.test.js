import test from 'node:test';
import assert from 'node:assert/strict';
import { roundResults, hasNextRound } from '../public/match.js';
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
