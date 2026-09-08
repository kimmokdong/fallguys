import test from 'node:test';
import assert from 'node:assert/strict';
import { resultOrder, revealDelay, revealedCount, addRoundScores } from '../public/results.js';

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
  assert.deepEqual(first.map((r) => [r.id, r.score]), [['a', 3], ['b', 2], ['c', 0]]);
  const second = addRoundScores(first, round(['b', 'c', 'a']));
  assert.deepEqual(second.map((r) => [r.id, r.score, r.rank]), [['b', 5, 1], ['a', 3, 2], ['c', 2, 3]]);
  assert.equal(first[0].score, 3);
  const tied = addRoundScores(first, round(['b', 'a', 'c']));
  assert.deepEqual(tied.map((r) => r.rank), [1, 1, 3]);
});
