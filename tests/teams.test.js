import test from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS } from '../public/catalog.js';
import { assignTeams, smallestTeam, roundResults } from '../public/match.js';
import { addRoundScores, seriesTeamStandings, eliminationTeamStandings } from '../public/results.js';
import { setup, client, roomWhere, ofType, prepareRoom, barrier } from './helpers.js';

const players = n => Array.from({ length: n }, (_, i) => ({ id: String(i), name: '젤리'+i }));
const seeded = seed => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
function balanced(players, count) {
  const sizes = Array(count).fill(0);
  for (const p of players) { assert.ok(Number.isInteger(p.team) && p.team >= 0 && p.team < count); sizes[p.team]++; }
  assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1);
}

test('1~30명·2~6팀 균등 추첨, 빈 팀 무시, 순서 보존, 개인전 초기화', () => {
  assert.equal(new Set(TEAMS.map(t=>t.hex)).size, 6);
  assert.deepEqual(TEAMS.map(t=>t.name), ['빨강 팀','파랑 팀','초록 팀','노랑 팀','보라 팀','주황 팀']);
  for (let n=1; n<=30; n++) for (let count=2; count<=6; count++) {
    const p=players(n), ids=p.map(p=>p.id);
    assignTeams(p,count,seeded(7)); balanced(p,count);
    assert.deepEqual(p.map(p=>p.id),ids);
    assert.equal(new Set(p.map(p=>p.team)).size,Math.min(n,count));
    assignTeams(p,0); assert.ok(p.every(p=>p.team===null));
  }
  const a=players(30),b=players(30);
  assignTeams(a,6,seeded(1)); assignTeams(b,6,seeded(2));
  assert.notDeepEqual(a.map(p=>p.team),b.map(p=>p.team));
});

test('나중에 입장하면 최소 인원 팀으로 배정하고 기존 팀은 유지한다', () => {
  for (let count=2; count<=6; count++) {
    const p=[];
    for (let n=0; n<30; n++) {
      const before=p.map(p=>p.team), sizes=Array(count).fill(0);
      p.forEach(p=>sizes[p.team]++);
      const team=smallestTeam(p,count);
      assert.equal(sizes[team],Math.min(...sizes));
      p.push({id:String(n),team}); balanced(p,count);
      assert.deepEqual(p.slice(0,-1).map(p=>p.team),before);
    }
    const left=p.filter(p=>p.team!==0);
    assert.equal(smallestTeam(left,count),0);
  }
});

test('누적 팀 합계·우승·공동 우승·MVP, 퇴장 기록과 원본 보존', () => {
  const p=players(4).map((p,i)=>({...p,team:i%2,socket:{},racer:{finished:true,finishTime:i+1}}));
  const scores=addRoundScores([],roundResults(p));
  assert.deepEqual(scores.map(p=>p.team),[0,1,0,1]);
  const retained=addRoundScores(scores,roundResults(p.slice(1)));
  assert.equal(retained.find(p=>p.id==='0').score,scores[0].score);
  const before=structuredClone(retained), teams=seriesTeamStandings(retained);
  assert.deepEqual(retained,before);
  for (const t of teams) assert.equal(t.score,retained.filter(p=>p.team===t.team).reduce((sum,p)=>sum+p.score,0));
  assert.equal(teams.filter(t=>t.rank===1).length,1);
  const tied=seriesTeamStandings([{id:'a',name:'가',team:0,score:5},{id:'b',name:'나',team:0,score:5},{id:'c',name:'다',team:1,score:10}]);
  assert.deepEqual(tied.map(t=>[t.score,t.rank]),[[10,1],[10,1]]);
  assert.deepEqual(tied[0].mvps.map(p=>p.id),['a','b']);
  assert.equal(seriesTeamStandings(scores).length,2,'빈 팀은 순위에 포함하지 않는다');
  assert.deepEqual(seriesTeamStandings([{team:null,score:100}]),[]);
  assert.deepEqual(seriesTeamStandings([{team:0,score:0},{team:1,score:0}]).map(t=>t.rank),[1,1]);
});

test('탈락팀전은 최종 개인 우승자의 팀, 생존 인원과 퇴장 팀 최고 진출 기록', () => {
  const p=[{id:'a',team:0,eliminated:false},{id:'b',team:1,eliminated:true}];
  const history=[{id:'b',team:1,eliminationRound:2},{id:'c',team:2,eliminationRound:1}];
  const teams=eliminationTeamStandings(p,history,'a',3);
  assert.deepEqual(teams.map(t=>[t.team,t.alive,t.bestRound,t.winner]),[[0,1,3,true],[1,0,2,false],[2,0,1,false]]);
  assert.ok(eliminationTeamStandings(p,history,null,3).every(t=>!t.winner));
  assert.equal(eliminationTeamStandings([], [{id:'a',team:0,status:'winner'}], 'a',3)[0].winner,true,'우승 후 퇴장해도 팀 유지');
});

test('서버 팀 설정 검증·단판 강제 해제·호스트 권한·늦은 입장·섞기·경기 중 고정', async t => {
  const app=await setup(t,{limits:{actionBurst:100}}),host=await client(app.url);
  host.send({type:'create',name:'방장'}); const w=await host.wait(ofType('welcome'));
  const room=app.rooms.get(w.code);
  assert.equal(room.settings.teams,0);
  for (const teams of [1,7,-1,2.5,'2',null,true,{},[]]) {
    host.send({type:'settings',teams,characterMode:'random'});
    assert.equal((await host.wait(ofType('error'))).message,'팀 수가 올바르지 않습니다.');
    assert.equal(room.settings.teams,0); assert.equal(room.settings.characterMode,'choice');
  }
  const guests=[];
  for(let i=0;i<6;i++) {
    const p=await client(app.url); p.send({type:'join',code:w.code,name:'친구'+i});
    Object.assign(p,await p.wait(ofType('welcome'))); guests.push(p);
  }
  for(const teams of [2,3,4,5,6]) {
    host.send({type:'settings',teams});
    const snapshot=(await host.wait(roomWhere(r=>r.settings.teams===teams))).room;
    balanced(snapshot.players,teams);
  }
  const before=[...room.players.values()].map(p=>[p.id,p.team]);
  const late=await client(app.url); late.send({type:'join',code:w.code,name:'늦은 친구'});
  Object.assign(late,await late.wait(ofType('welcome'))); guests.push(late);
  assert.equal(room.players.get(late.id).team,smallestTeam(before.map(([id,team])=>({id,team})),6));
  assert.deepEqual([...room.players.values()].slice(0,-1).map(p=>[p.id,p.team]),before);
  guests[0].send({type:'shuffleTeams'}); assert.match((await guests[0].wait(ofType('error'))).message,/방장/);
  for(const p of room.players.values()) p.team=0;
  host.send({type:'shuffleTeams'}); await barrier(host); balanced([...room.players.values()],6);
  host.send({type:'settings',matchMode:'single',teams:6});
  await host.wait(roomWhere(r=>r.settings.matchMode==='single'));
  assert.equal(room.settings.teams,0); assert.ok([...room.players.values()].every(p=>p.team===null));
  host.send({type:'settings',matchMode:'series',teams:3,mapId:'jelly-garden'});
  await host.wait(roomWhere(r=>r.settings.teams===3)); await prepareRoom(guests,host,8);
  const assigned=new Map([...room.players.values()].map(p=>[p.id,p.team]));
  host.send({type:'start'}); await host.wait(roomWhere(r=>r.phase==='playing'));
  host.send({type:'shuffleTeams'}); assert.match((await host.wait(ofType('error'))).message,/대기실/);
  const leaver=guests.pop(); leaver.send({type:'leave'}); await leaver.wait(ofType('left'));
  for(const p of room.players.values()) assert.equal(p.team,assigned.get(p.id));
  room.roundPlayers.forEach((p,i)=>{if(!p.withdrawn) Object.assign(p.racer,{finished:true,finishTime:i+1});});
  const end=(await host.wait(roomWhere(r=>r.phase==='results'))).room;
  assert.ok(end.results.every(p=>p.team===assigned.get(p.id)));
  assert.equal(end.scores.find(p=>p.id===leaver.id).team,assigned.get(leaver.id));
  assert.deepEqual(end.teamStandings,seriesTeamStandings(end.scores));
  host.send({type:'next'}); await host.wait(roomWhere(r=>r.phase==='playing'&&r.round===2));
  for(const p of room.players.values()) assert.equal(p.team,assigned.get(p.id));
});

test('팀 섞기는 요청 횟수 한도를 우회하지 않는다', async t => {
  const app=await setup(t,{limits:{actionBurst:1,actionsPerSecond:0}}),host=await client(app.url);
  host.send({type:'create',name:'방장'}); const w=await host.wait(ofType('welcome'));
  const room=app.rooms.get(w.code);
  host.send({type:'settings',teams:2}); await barrier(host);
  const team=room.players.get(w.id).team;
  host.send({type:'shuffleTeams'});
  assert.match((await host.wait(ofType('error'))).message,/요청이 너무 잦아요/);
  assert.equal(room.players.get(w.id).team,team);
});

test('서버 탈락팀전은 개인 우승자와 팀 기록을 함께 전송한다', async t => {
  const app=await setup(t),host=await client(app.url);
  host.send({type:'create',name:'방장'}); const w=await host.wait(ofType('welcome'));
  const guest=await client(app.url); guest.send({type:'join',code:w.code,name:'친구'});
  await guest.wait(ofType('welcome'));
  host.send({type:'settings',teams:6,mapId:'jelly-garden'});
  await host.wait(roomWhere(r=>r.settings.teams===6)); await prepareRoom([guest],host,2);
  host.send({type:'start'}); await host.wait(roomWhere(r=>r.phase==='playing'));
  const room=app.rooms.get(w.code),champion=room.players.get(w.id);
  Object.assign(champion.racer,{finished:true,finishTime:1});
  const final=(await host.wait(roomWhere(r=>r.phase==='results'))).room;
  assert.equal(final.winnerId,w.id); assert.equal(final.matchOver,true);
  assert.equal(final.teamStandings.length,2);
  assert.deepEqual(final.teamStandings.filter(t=>t.winner).map(t=>t.team),[champion.team]);
  assert.ok(final.standings.every(p=>Number.isInteger(p.team)));
});

test('HTML이 팀 설정·섞기·결과 영역과 클라이언트 모듈을 제공한다', async t => {
  const app=await setup(t),response=await fetch(app.url),html=await response.text();
  assert.equal(response.status,200);
  const select=html.match(/<select id="teams-select"[^>]*>(.*?)<\/select>/s)?.[1];
  assert.ok(select);
  assert.deepEqual([...select.matchAll(/value="(\d+)"/g)].map(m=>Number(m[1])),[0,2,3,4,5,6]);
  for(const id of ['teams-settings','shuffle-teams','self-team','team-standings']) assert.ok(html.includes('id="'+id+'"'));
  assert.match(html,/<script type="module" src="\/app.js">/);
  for(const path of ['/app.js','/catalog.js','/match.js','/results.js','/scene.js']) assert.equal((await fetch(app.url+path)).status,200);
});

test('3판 누적팀전: 득점 후 퇴장해도 팀 점수·MVP 유지, 최종 공동 우승', async t => {
  const app=await setup(t),host=await client(app.url);
  host.send({type:'create',name:'방장'}); const w=await host.wait(ofType('welcome'));
  const guest=await client(app.url); guest.send({type:'join',code:w.code,name:'친구'});
  const g=await guest.wait(ofType('welcome'));
  host.send({type:'settings',matchMode:'series',teams:2,mapId:'jelly-garden'});
  await host.wait(roomWhere(r=>r.settings.teams===2)); await prepareRoom([guest],host,2);
  const room=app.rooms.get(w.code),guestTeam=room.players.get(g.id).team;
  host.send({type:'start'}); await host.wait(roomWhere(r=>r.phase==='playing'));
  Object.assign(room.players.get(g.id).racer,{finished:true,finishTime:1});
  Object.assign(room.players.get(w.id).racer,{finished:true,finishTime:2});
  await host.wait(roomWhere(r=>r.phase==='results'));
  guest.send({type:'leave'}); await guest.wait(ofType('left'));
  for(const round of [2,3]) {
    host.send({type:'next'}); await host.wait(roomWhere(r=>r.phase==='playing'&&r.round===round));
    Object.assign(room.players.get(w.id).racer,{finished:true,finishTime:1});
    const result=(await host.wait(roomWhere(r=>r.phase==='results'&&r.round===round))).room;
    assert.equal(result.teamStandings.find(t=>t.team===guestTeam).score,3);
    if(round===3) {
      assert.deepEqual(result.teamStandings.map(t=>[t.score,t.rank]),[[3,1],[3,1]]);
      assert.equal(result.teamStandings.find(t=>t.team===guestTeam).mvps[0].id,g.id);
      assert.equal(result.scores.length,2);
    }
  }
});

test('탈락팀전 라운드 사이 퇴장도 팀 최고 진출 기록에 남는다', async t => {
  const app=await setup(t),host=await client(app.url);
  host.send({type:'create',name:'방장'}); const w=await host.wait(ofType('welcome'));
  const guests=[];
  for(let i=0;i<5;i++) {
    const p=await client(app.url); p.send({type:'join',code:w.code,name:'친구'+i});
    Object.assign(p,await p.wait(ofType('welcome'))); guests.push(p);
  }
  host.send({type:'settings',teams:6,mapId:'jelly-garden'});
  await host.wait(roomWhere(r=>r.settings.teams===6)); await prepareRoom(guests,host,6);
  host.send({type:'start'}); await host.wait(roomWhere(r=>r.phase==='playing'));
  const room=app.rooms.get(w.code),leaver=guests[0],team=room.players.get(leaver.id).team;
  room.roundPlayers.slice(0,5).forEach((p,i)=>Object.assign(p.racer,{finished:true,finishTime:i+1}));
  await host.wait(roomWhere(r=>r.phase==='results'));
  leaver.send({type:'leave'}); await leaver.wait(ofType('left'));
  host.send({type:'next'}); await host.wait(roomWhere(r=>r.phase==='playing'&&r.round===2));
  const champion=room.roundPlayers[0];
  if(room.rule==='race') Object.assign(champion.racer,{finished:true,finishTime:1});
  else room.roundPlayers.slice(1).forEach(p=>Object.assign(p.racer,{eliminated:true,eliminatedAt:1}));
  const final=(await host.wait(roomWhere(r=>r.phase==='results'&&r.round===2))).room;
  assert.equal(final.winnerId,champion.id);
  assert.deepEqual(final.teamStandings.find(t=>t.team===team),{team,alive:0,bestRound:1,winner:false});
});
