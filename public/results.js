import { isSuccessful } from './match.js';
// 미완주·탈락부터, 높은 순위는 마지막에 공개합니다.
export function resultOrder(results) {
  return [...results].sort((a, b) => {
    if (isSuccessful(a) !== isSuccessful(b)) return isSuccessful(a) ? -1 : 1;
    return (a.rank ?? Infinity) - (b.rank ?? Infinity) || 0;
  }).reverse();
}

export function revealDelay(index, total) {
  return 450 + index * (total > 12 ? 180 : 300) + Math.max(0, index - Math.max(0, total - 3) + 1) * 350;
}

export function revealedCount(total, elapsed) {
  let count = 0;
  while (count < total && elapsed >= revealDelay(count, total)) count++;
  return count;
}

// 참가 인원은 미완주·중도 퇴장자를 포함합니다. 모든 라운드에 같은 배점을 적용합니다.
export function roundPoints(result, participants) {
  if (result.status !== 'finished') return 0;
  const bonusRate = [0.3, 0.15, 0.1][result.rank - 1] || 0;
  return Math.max(1, participants - result.rank + 1) + Math.round(participants * bonusRate);
}

// 동점은 공동 순위입니다.
export function addRoundScores(previous, results) {
  const scores = new Map(previous.map((row) => [row.id, { ...row }]));
  for (const result of results) {
    const points = roundPoints(result, results.length);
    const row = scores.get(result.id) || { id: result.id, name: result.name, character: result.character, color: result.color, team: result.team, score: 0, completed: 0, wins: 0 };
    row.character = result.character; row.color = result.color;
    row.score += points;
    row.completed += Number(result.status === 'finished');
    row.wins += Number(result.status === 'finished' && result.rank === 1);
    scores.set(row.id, row);
  }
  const ordered = [...scores.values()].sort((a, b) => b.score - a.score);
  ordered.forEach((row, i) => { row.rank = i && ordered[i - 1].score === row.score ? ordered[i - 1].rank : i + 1; });
  return ordered;
}

export function seriesTeamStandings(scores) {
  const teams = new Map();
  for (const row of scores) {
    if (!Number.isInteger(row.team) || row.team < 0) continue;
    const team = teams.get(row.team) || { team: row.team, score: 0, mvps: [] };
    team.score += row.score;
    if (!team.mvps.length || row.score > team.mvps[0].score) team.mvps = [row];
    else if (row.score === team.mvps[0].score) team.mvps.push(row);
    teams.set(row.team, team);
  }
  const ordered = [...teams.values()].sort((a, b) => b.score - a.score || a.team - b.team);
  ordered.forEach((row, i) => { row.rank = i && ordered[i - 1].score === row.score ? ordered[i - 1].rank : i + 1; });
  return ordered;
}

export function eliminationTeamStandings(players, history, winnerId, round) {
  const teams = new Map(), members = new Map(history.map(p => [p.id, p]));
  for (const p of players) if (!members.has(p.id)) members.set(p.id, p);
  const alive = new Set(players.filter(p => !p.eliminated && !p.withdrawn).map(p => p.id));
  for (const p of members.values()) {
    if (!Number.isInteger(p.team) || p.team < 0) continue;
    const team = teams.get(p.team) || { team: p.team, alive: 0, bestRound: 0, winner: false };
    team.alive += Number(alive.has(p.id));
    team.bestRound = Math.max(team.bestRound, p.eliminationRound ?? round);
    team.winner ||= p.id === winnerId;
    teams.set(p.team, team);
  }
  return [...teams.values()].sort((a, b) => Number(b.winner) - Number(a.winner) || b.bestRound - a.bestRound || a.team - b.team);
}
