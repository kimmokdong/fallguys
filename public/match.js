// 생존 동시 탈락은 같은 순위, 제한 시간까지 남은 참가자는 공동 생존입니다.
export function roundResults(players, { rule = 'race', mode = 'single', final = false, quota = players.length, time = 0 } = {}) {
  const rows = players.map(p => ({ id:p.id, name:p.name, character:p.character, color:p.color, connected:Boolean(p.socket) && !p.withdrawn, time:null, rank:null, status:'dnf', qualified:false, ...(rule==='survival'
    ? { status: !p.withdrawn && !p.racer.eliminated ? 'survived' : 'eliminated', time: p.racer.eliminatedAt ?? time }
    : p.racer.finished ? { status:'finished', time:p.racer.finishTime ?? time } : {}) }));
  if (rule === 'race') {
    const finished=rows.filter(r=>r.status==='finished').sort((a,b)=>a.time-b.time);
    finished.forEach((r,i)=>{ r.rank=i && Math.abs(finished[i-1].time-r.time)<.001 ? finished[i-1].rank : i+1; r.qualified=r.rank<=(final?1:quota); });
    return [...finished,...rows.filter(r=>r.status!=='finished')];
  }
  rows.sort((a,b)=>Number(b.status==='survived')-Number(a.status==='survived') || b.time-a.time);
  rows.forEach((r,i)=>{
    const previous=rows[i-1];
    r.rank=i && r.status===previous.status && (r.status==='survived' || Math.abs(r.time-previous.time)<.001) ? previous.rank : i+1;
    r.qualified=r.status==='survived';
  });
  return rows;
}

export const hasNextRound = room => room.settings.matchMode==='series' ? room.round<room.settings.rounds : room.settings.matchMode==='elimination' && !room.matchOver;
export const isSuccessful = row => ['finished','survived','winner'].includes(row.status);
export const placeLabel = row => row.status==='dnf' ? '미완주' : row.status==='eliminated' && row.rank==null ? '탈락' : `${row.rank}위`;

// 선수 명단 순서는 보존하고 출발 슬롯만 배정합니다. z가 큰 줄이 앞줄입니다.
export function startingSlots(players, { mode, rule, round, scores = [], results = [] }, random = Math.random) {
  const shuffle = values => {
    for (let i = values.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  // 먼저 섞은 뒤 안정 정렬하므로 동점자는 입장 순서와 무관하게 추첨됩니다.
  const ordered = shuffle([...players]);
  if (round > 1 && rule === 'race') {
    if (mode === 'series') {
      const points = new Map(scores.map(row => [row.id, row.score]));
      ordered.sort((a, b) => (points.get(a.id) ?? 0) - (points.get(b.id) ?? 0));
    } else if (mode === 'elimination') {
      const ranks = new Map(results.map(row => [row.id, row.rank]));
      ordered.sort((a, b) => (ranks.get(b.id) ?? 0) - (ranks.get(a.id) ?? 0));
    }
  }
  const slots = [];
  for (let row = Math.ceil(players.length / 6) - 1; row >= 0; row--) {
    const count = Math.min(6, players.length - row * 6);
    slots.push(...shuffle(Array.from({ length: count }, (_, column) => row * 6 + column)));
  }
  return new Map(ordered.map((player, i) => [player.id, slots[i]]));
}
