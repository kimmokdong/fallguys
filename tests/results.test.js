import test from 'node:test';
import assert from 'node:assert/strict';
import { resultOrder, revealDelay, revealedCount, addRoundScores, roundPoints } from '../public/results.js';

test('미완주부터 꼴찌→1위 순서로 공개하고 30명도 8초 안에 공개한다', () => {
  const rows = [{ id: 'second', status: 'finished', rank: 2 }, { id: 'dnf', status: 'dnf', rank: null }, { id: 'first', status: 'finished', rank: 1 }];
  assert.deepEqual(resultOrder(rows).map((r) => r.id), ['dnf', 'second', 'first']);
  assert.equal(rows[0].id, 'second', '서버 원본을 변경하지 않는다');
  assert.equal(revealedCount(30, 0), 0);
  for (let i = 0; i < 30; i++) {
    assert.equal(revealedCount(30, revealDelay(i, 30)), i + 1);
    assert.equal(revealedCount(30, revealDelay(i, 30) - 1), i);
  }
  assert.ok(revealDelay(29, 30) < 8000);
});

test('순위 점수 합산, 미완주0점, 역전·공동 순위·원본 보존', () => {
  const round = (ids) => ids.map((id, i) => ({ id, name: id, character: 'bean', color: 'blue', status: i === 2 ? 'dnf' : 'finished', rank: i === 2 ? null : i + 1 }));
  const first = addRoundScores([], round(['a', 'b', 'c']));
  assert.deepEqual(first.map((r) => [r.id, r.score]), [['a', 4], ['b', 2], ['c', 0]]);
  const second = addRoundScores(first, round(['b', 'c', 'a']));
  assert.deepEqual(second.map((r) => [r.id, r.score, r.rank]), [['b', 6, 1], ['a', 4, 2], ['c', 2, 3]]);
  assert.equal(first[0].score, 4);
  const tied = addRoundScores(first, round(['b', 'a', 'c']));
  assert.deepEqual(tied.map((r) => r.rank), [1, 1, 3]);
});

test('참가 인원 비례 보너스: 반올림, 4위 이하 기본점수, 미완주 포함, 매판 동일 배점', () => {
  for (const [count, expected] of [[10, [13, 11, 9, 7]], [20, [26, 22, 20, 17]], [26, [34, 29, 27, 23]], [30, [39, 34, 31, 27]]]) {
    assert.deepEqual([1, 2, 3, 4].map(rank => roundPoints({ status: 'finished', rank }, count)), expected);
    assert.equal(roundPoints({ status: 'finished', rank: count }, count), 1);
    assert.equal(roundPoints({ status: 'dnf', rank: null }, count), 0);
  }
  for (let count = 1; count <= 30; count++) {
    const points = Array.from({ length: count }, (_, i) => roundPoints({ status: 'finished', rank: i + 1 }, count));
    assert.ok(points.every((score, i) => Number.isInteger(score) && score > 0 && (!i || score < points[i - 1])));
  }
  const results = Array.from({ length: 26 }, (_, i) => ({ id: String(i), status: i ? 'dnf' : 'finished', rank: i ? null : 1 }));
  let scores = [];
  for (let round = 1; round <= 7; round++) {
    scores = addRoundScores(scores, results);
    assert.equal(scores[0].score, 34 * round, '3·5·7번째 판에도 추가 배율이 없다');
    assert.ok(scores.slice(1).every(row => row.score === 0));
  }
});
