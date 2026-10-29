import { describe, expect, it } from 'vitest';
import { cardTint, luminance } from './tint';

const contrastWithWhite = (c: [number, number, number]): number => 1.05 / (luminance(c) + 0.05);

describe('卡片底色', () => {
  it('亮色封面压暗到白字对比度 ≥ 4.5', () => {
    for (const c of [[255, 255, 255], [235, 213, 196], [200, 60, 60], [250, 220, 90]] as [number, number, number][]) {
      expect(contrastWithWhite(cardTint(c))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('本来就暗的颜色基本不动（只往灰靠一点）', () => {
    const t = cardTint([30, 40, 60]);
    expect(Math.abs(t[0] - 30)).toBeLessThan(8);
    expect(luminance(t)).toBeLessThanOrEqual(0.12);
  });
  it('亮度：黑 0，白 1', () => {
    expect(luminance([0, 0, 0])).toBe(0);
    expect(luminance([255, 255, 255])).toBeCloseTo(1, 5);
  });
});
