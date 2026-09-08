// 외부 음원 없이 짧은 효과음을 합성한다. 사용자 입력 뒤에만 오디오를 시작한다.
export class GameAudio {
  constructor(enabled = true) { this.enabled = enabled; this.lastHit = 0; }
  async unlock() {
    if (!this.enabled) return;
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    try {
      this.context ||= new Context();
      if (this.context.state === 'suspended') await this.context.resume();
    } catch { /* 소리를 지원하지 않아도 게임은 계속한다. */ }
  }
  play(kind) {
    const ctx = this.context;
    if (!this.enabled || !ctx || ctx.state !== 'running' || document.hidden) return;
    if (kind === 'hit' && performance.now() - this.lastHit < 220) return;
    if (kind === 'hit') this.lastHit = performance.now();
    const notes = {
      jump: [[240, 460, .12, 'triangle']], land: [[140, 65, .1, 'sine']],
      hit: [[160, 50, .14, 'triangle']], dive: [[340, 100, .17, 'sine']],
      checkpoint: [[440, 550, .1, 'sine'], [660, 740, .16, 'sine']],
      finish: [[392, 392, .13, 'triangle'], [494, 494, .13, 'triangle'], [587, 784, .3, 'triangle']],
      count: [[440, 440, .1, 'sine']], go: [[660, 880, .23, 'triangle']],
    }[kind];
    if (!notes) return;
    let start = ctx.currentTime;
    for (const [from, to, duration, type] of notes) {
      const oscillator = ctx.createOscillator(), gain = ctx.createGain();
      oscillator.type = type; oscillator.frequency.setValueAtTime(from, start);
      oscillator.frequency.exponentialRampToValueAtTime(to, start + duration);
      gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(.07, start + .008);
      gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
      oscillator.connect(gain); gain.connect(ctx.destination);
      oscillator.start(start); oscillator.stop(start + duration + .02);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      start += duration;
    }
  }
}
