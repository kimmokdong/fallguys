// 미완주를 먼저, 완주자는 낮은 순위부터 공개합니다. 원본 순위는 변경하지 않습니다.
export function resultOrder(results) {
  return [...results].sort((a, b) => {
    if ((a.status === 'finished') !== (b.status === 'finished')) return a.status === 'finished' ? -1 : 1;
    return a.status === 'finished' ? a.rank - b.rank : 0;
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

// 완주 점수는 참가 인원부터 1점까지, 미완주는 0점. 동점은 공동 순위입니다.
export function addRoundScores(previous, results) {
  const scores = new Map(previous.map((row) => [row.id, { ...row }]));
  for (const result of results) {
    const points = result.status === 'finished' ? Math.max(1, results.length - result.rank + 1) : 0;
    const row = scores.get(result.id) || { id: result.id, name: result.name, character: result.character, color: result.color, score: 0, completed: 0, wins: 0 };
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
