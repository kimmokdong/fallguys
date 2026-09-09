import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { GameMusic, MUSIC_TRACKS } from '../public/music.js';
import { GameAudio } from '../public/audio.js';
import { createGameServer } from '../server.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function audioContext() {
  return {
    state: 'running', currentTime: 0, destination: {}, sources: [],
    createGain() { return { gain: { value: 1, setTargetAtTime(value) { this.value = value; } }, connect() {} }; },
    async decodeAudioData() { return { duration: 120 }; },
    async resume() { this.state = 'running'; },
    createBufferSource() {
      const source = { connect() {}, disconnect() {}, start(time, offset) { this.offset = offset; }, stop() { this.stopped = true; } };
      this.sources.push(source); return source;
    },
  };
}

test('현재 곡만 요청하고, 일시정지는 다운로드 없이 이어 듣며 네 곡 뒤에 다시 섞는다', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, options });
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const context = audioContext(), music = new GameMusic(context, {});
  assert.equal(requests.length, 0, '홈에서는 음원을 미리 받지 않는다');
  music.setPlaying(true); await flush();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.cache, 'default');
  context.currentTime = 18;
  music.setPlaying(false);
  assert.equal(context.sources[0].stopped, true);
  music.setPlaying(true); await flush();
  assert.equal(requests.length, 1, '같은 곡을 재개할 때 재요청하지 않는다');
  assert.equal(context.sources[1].offset, 18);
  for (let i = 0; i < 4; i++) { music.source.onended(); await flush(); }
  assert.equal(requests.length, 5, '곡이 끝날 때만 다음 곡을 받는다');
  assert.equal(new Set(requests.slice(0, 4).map(r => r.url)).size, 4);
  assert.notEqual(requests[3].url, requests[4].url, '재셔플 경계에서도 같은 곡을 연속 재생하지 않는다');
  music.setPlaying(false);
});

test('카운트다운에는 한 곡만 준비하고 출발 신호가 와야 소리를 재생한다', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    requests++; return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const context = audioContext(), music = new GameMusic(context, {});
  music.setPlaying(false, true); await flush();
  assert.equal(requests, 1);
  assert.ok(music.buffer);
  assert.equal(context.sources.length, 0);
  music.setPlaying(true); await flush();
  assert.equal(context.sources.length, 1);
  assert.equal(requests, 1);
  music.setPlaying(false);
});

test('결과·음소거 전환 중 내려받던 곡은 취소하고 늦은 디코딩이 음악을 켜지 않는다', async t => {
  const requests = [], pending = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push(options);
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(1) };
  });
  const context = audioContext();
  context.decodeAudioData = () => new Promise(resolve => pending.push(resolve));
  const music = new GameMusic(context, {});
  music.setPlaying(true); await flush();
  music.setPlaying(false);
  assert.ok(requests[0].signal.aborted);
  music.setPlaying(true); await flush();
  pending[0]({ duration: 120 }); await flush();
  assert.equal(context.sources.length, 0, '취소된 요청은 뒤늦게 재생되지 않는다');
  pending[1]({ duration: 120 }); await flush();
  assert.equal(context.sources.length, 1, '현재 요청만 한 번 재생한다');
  music.setPlaying(false);
});

test('음원 오류는 다음 곡으로 넘기되 전곡 실패 시 무한 다운로드하지 않는다', async t => {
  let count = 0;
  t.mock.method(console, 'warn', () => {});
  t.mock.method(globalThis, 'fetch', async () => { count++; return { ok: false, status: 404 }; });
  const music = new GameMusic(audioContext(), {});
  music.setPlaying(true); await flush();
  assert.equal(count, 4);
  music.setPlaying(true); await flush();
  assert.equal(count, 4);
  music.setPlaying(false);
});

test('게임 소리 설정과 탭 표시 상태가 배경음악에도 적용된다', async t => {
  const priorWindow = globalThis.window, priorDocument = globalThis.document;
  globalThis.window = { AudioContext: function () { return audioContext(); } };
  globalThis.document = { hidden: false };
  t.after(() => { globalThis.window = priorWindow; globalThis.document = priorDocument; });
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(1) }));
  const sound = new GameAudio(true, .75);
  await sound.unlock();
  assert.equal(sound.music.source, undefined, '오디오를 열기만 해서는 배경음악을 재생하지 않는다');
  sound.setMusicPlaying(true); await flush();
  assert.ok(sound.music.source);
  sound.enabled = false; sound.setVolume(sound.volume);
  assert.equal(sound.music.source, null);
  sound.enabled = true; await sound.unlock(); await flush();
  assert.ok(sound.music.source);
  document.hidden = true; sound.syncMusic();
  assert.equal(sound.music.source, null);
  document.hidden = false; await sound.unlock(); await flush();
  assert.ok(sound.music.source);
  sound.setVolume(0);
  assert.equal(sound.music.source, null);
  sound.setVolume(.5); await flush();
  assert.ok(sound.music.source);
  sound.setMusicPlaying(false);
  assert.equal(sound.music.source, null);
});

test('압축 음원 해시·MIME·장기 캐시와 304 재검증, 원본 비공개를 확인한다', async t => {
  const game = createGameServer();
  game.server.listen(0, '127.0.0.1'); await once(game.server, 'listening');
  t.after(() => game.close());
  const origin = `http://127.0.0.1:${game.server.address().port}`;
  let total = 0;
  for (const path of MUSIC_TRACKS) {
    const bytes = await readFile(new URL('../public' + path, import.meta.url));
    total += bytes.length;
    assert.ok(path.includes(createHash('sha256').update(bytes).digest('hex').slice(0, 12)));
    const response = await fetch(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'audio/mpeg');
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    assert.equal((await response.arrayBuffer()).byteLength, bytes.length);
    const cached = await fetch(origin + path, { headers: { 'If-None-Match': response.headers.get('etag') } });
    assert.equal(cached.status, 304);
    assert.equal((await cached.arrayBuffer()).byteLength, 0);
    const head = await fetch(origin + path, { method: 'HEAD' });
    assert.equal(Number(head.headers.get('content-length')), bytes.length);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  }
  assert.ok(total < 8_500_000);
  assert.equal((await fetch(origin + '/app.js', { method: 'HEAD' })).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(origin + '/Arcade%20Bounce.mp3')).status, 404);
});
