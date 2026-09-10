// 화면 크기가 아니라 실제 프레임 간격으로 품질을 고릅니다. 판정·서버 속도에는 관여하지 않습니다.
export const GRAPHICS_LEVELS = [
  { pixelRatio: .75, maxPixels: 1280 * 720, shadowSize: 0, detailDistance: 26 },
  { pixelRatio: 1, maxPixels: 1600 * 900, shadowSize: 1024, detailDistance: 38 },
  { pixelRatio: 1.5, maxPixels: 1920 * 1080, shadowSize: 1024, detailDistance: 52 },
];

export function renderPixelRatio(width, height, deviceRatio, level) {
  const quality = GRAPHICS_LEVELS[level];
  return Math.min(deviceRatio || 1, quality.pixelRatio, Math.sqrt(quality.maxPixels / Math.max(1, width * height)));
}

export class AutoGraphics {
  constructor() { this.level = 1; this.reset(); }
  reset() { this.elapsed = 0; this.frames = 0; this.slow = 0; this.fast = 0; this.warmup = 1500; }
  sample(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return false;
    // 탭 복귀·맵 로딩처럼 측정이 중단된 시간은 기기 성능으로 오인하지 않습니다.
    if (ms > 1000) { this.reset(); return false; }
    if (this.warmup > 0) { this.warmup -= ms; return false; }
    this.elapsed += ms; this.frames++;
    if (this.elapsed < 2500) return false;
    const average = this.elapsed / this.frames;
    this.elapsed = 0; this.frames = 0;
    this.slow = average > 23 ? this.slow + 1 : 0;
    this.fast = average < 17.8 ? this.fast + 1 : 0;
    const next = this.slow >= 2 ? Math.max(0, this.level - 1) : this.fast >= 6 ? Math.min(2, this.level + 1) : this.level;
    if (next === this.level) return false;
    this.level = next; this.reset();
    return true;
  }
}
