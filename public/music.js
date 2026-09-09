// 파일 내용의 해시가 바뀔 때만 새 음원을 받습니다. 원본은 프로젝트 루트에 보관합니다.
export const MUSIC_TRACKS = [
  '/music/arcade-bounce.175189590033.mp3',
  '/music/party-game-blast.a9ea3503eee7.mp3',
  '/music/party-game-blast-2.6a733d8bdd10.mp3',
  '/music/party-game-groove.f5a0ad9cf627.mp3',
];

export class GameMusic {
  constructor(context, output) {
    this.context = context;
    this.gain = context.createGain();
    this.gain.gain.value = .32;
    this.gain.connect(output);
    this.queue = [];
    this.failed = new Set();
    this.offset = 0;
    this.wanted = false;
  }

  setPlaying(wanted, preparing = false) {
    if ((wanted || preparing) && !this.wanted && !this.preparing) this.failed.clear();
    this.wanted = wanted;
    this.preparing = preparing;
    if (!wanted && this.source) {
      this.offset = (this.offset + this.context.currentTime - this.startedAt) % this.buffer.duration;
      this.source.onended = null;
      this.source.stop();
      this.source.disconnect();
      this.source = null;
    }
    if (wanted || preparing) { void this.resume(); return; }
    this.loading?.abort();
    this.loading = null;
  }

  nextTrack() {
    if (!this.queue.length) {
      this.queue = MUSIC_TRACKS.filter(url => !this.failed.has(url));
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
      }
      // 네 곡을 모두 들은 뒤 다시 섞을 때도 같은 곡이 연속되지 않게 합니다.
      if (this.queue.length > 1 && this.queue[0] === this.lastTrack) {
        [this.queue[0], this.queue[1]] = [this.queue[1], this.queue[0]];
      }
    }
    return this.queue.shift();
  }

  async resume() {
    if ((!this.wanted && !this.preparing) || this.source || this.loading || this.context.state !== 'running') return;
    this.track ||= this.nextTrack();
    if (!this.track) return;
    const request = new AbortController();
    this.loading = request;
    try {
      if (!this.buffer) {
        // 재생할 한 곡만 요청합니다. 이전에 받은 파일은 HTTP 브라우저 캐시를 사용합니다.
        const response = await fetch(this.track, { signal: request.signal, cache: 'default' });
        if (!response.ok) throw new Error(`음원 응답 ${response.status}`);
        const buffer = await this.context.decodeAudioData(await response.arrayBuffer());
        if (request.signal.aborted) return;
        // 크롬북 메모리를 아끼기 위해 압축을 푼 오디오는 현재 곡 하나만 보관합니다.
        this.buffer = buffer;
      }
      if (request.signal.aborted || !this.wanted || this.context.state !== 'running') return;
      const source = this.context.createBufferSource();
      source.buffer = this.buffer;
      source.connect(this.gain);
      source.onended = () => {
        if (this.source !== source) return;
        source.disconnect();
        this.source = null;
        this.lastTrack = this.track;
        this.track = null;
        this.buffer = null;
        this.offset = 0;
        void this.resume();
      };
      source.start(0, this.offset);
      this.source = source;
      this.startedAt = this.context.currentTime;
    } catch (error) {
      if (request.signal.aborted) return;
      console.warn('배경음악을 불러오지 못했습니다.', this.track, error);
      this.failed.add(this.track);
      this.track = null;
      this.buffer = null;
      this.offset = 0;
      // 한 곡의 오류는 다음 곡으로 넘기고, 전곡 오류 때는 재시도를 멈춥니다.
      if (this.loading === request) this.loading = null;
      void this.resume();
    } finally {
      if (this.loading === request) this.loading = null;
    }
  }
}
