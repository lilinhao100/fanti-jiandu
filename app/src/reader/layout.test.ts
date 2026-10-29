import { describe, expect, it } from 'vitest';
import { BOTTOM_MARGIN, computeLayout, ONE_PAGE_MAX_TEXT, TOP_MARGIN, TWO_COL_MIN_WIDTH, TWO_PAGE_MAX_COLUMN } from './layout';

/** 把分页器的几何（paginator.js:690-752 与 CSS 网格）用同样的公式重算一遍，验证属性确实得到想要的版心 */
function simulate(width: number, height: number, margin = 1, columns: 'auto' | 'one' | 'two' = 'auto') {
  const l = computeLayout(width, height, margin, columns);
  const wide = width - l.inset.left - l.inset.right;
  const g = parseFloat(l.attrs.gap) / 100;
  const maxInline = parseFloat(l.attrs['max-inline-size']);
  const count = Number(l.attrs['max-column-count']);
  const hg = (g * wide) / 2;
  const maxWidth = maxInline * count;
  // 网格：[1fr≥hg][hg][minmax(0, maxWidth-gap)][hg][1fr≥hg]。非弹性轨道先吃满空间，剩下的才给两侧
  const col3 = Math.min(maxWidth - g * wide, wide - 4 * hg);
  const side = (wide - 2 * hg - col3 - 2 * hg) / 2 + hg;
  const container = hg + col3 + hg;
  const divisor = Math.min(count, Math.ceil(container / maxInline));
  const gap = (g / (1 - g)) * container;
  const column = container / divisor - gap;
  const outer = l.inset.left + side + gap / 2;
  return { l, divisor, gap, column, outer, container };
}

describe('computeLayout', () => {
  it('双页：1144 宽时外边距 6.4%、中缝 6.9%、每栏约 460（参考截图 73 / 79 / 460）', () => {
    const { l, divisor, gap, column, outer } = simulate(1144, 860);
    expect(l.two).toBe(true);
    expect(divisor).toBe(2);
    expect(outer).toBeCloseTo(73.2, 0);
    expect(gap).toBeCloseTo(78.9, 0);
    expect(column).toBeCloseTo(459.5, 0);
    expect(l.attrs['max-column-count']).toBe('2');
  });

  it('双页：页边空白倍数改变外边距，中缝不变', () => {
    const a = simulate(1144, 860, 0.5);
    const b = simulate(1144, 860, 1.8);
    expect(a.outer).toBeCloseTo(0.064 * 1144 * 0.5, 0);
    expect(b.outer).toBeCloseTo(0.064 * 1144 * 1.8, 0);
    expect(a.gap).toBeCloseTo(78.9, 0);
    expect(b.gap).toBeCloseTo(78.9, 0);
    expect(a.divisor).toBe(2);
    expect(b.divisor).toBe(2);
  });

  it('双页：超宽窗口里每栏不超过上限，版心居中', () => {
    const { column, outer, gap } = simulate(2560, 1300);
    expect(column).toBeCloseTo(TWO_PAGE_MAX_COLUMN, 0);
    expect(outer * 2 + column * 2 + gap).toBeCloseTo(2560, 0);
  });

  it('阈值：999 单页，1000 双页', () => {
    expect(computeLayout(999, 860).two).toBe(false);
    expect(computeLayout(1000, 860).two).toBe(true);
  });

  it('竖屏窗口（高 > 宽）即使宽 ≥ 1000 也是单页', () => {
    expect(computeLayout(1000, 1400).two).toBe(false);
  });

  it('单页：800 宽时版心 680，水平居中', () => {
    const { l, divisor, column, outer } = simulate(800, 860);
    expect(l.two).toBe(false);
    expect(divisor).toBe(1);
    expect(column).toBeCloseTo(ONE_PAGE_MAX_TEXT, 0);
    expect(outer).toBeCloseTo(60, 0);
    expect(l.inset.left).toBe(0);
  });

  it('单页：窄窗口（760）版心让位给 6.4% 外边距；页边空白 1.8× 时更窄', () => {
    expect(simulate(760, 520).column).toBeCloseTo(760 * (1 - 0.128), 0);
    expect(simulate(760, 520, 1.8).column).toBeCloseTo(760 * (1 - 0.128 * 1.8), 0);
    // 页边空白 0.5×：想要 24.3px，但单页的列间隙是 36（给页边便签图标留位置，M2c），分页器要求外边距 ≥ 列间隙的一半再加一半
    expect(simulate(760, 520, 0.5).outer).toBeGreaterThanOrEqual(760 * 0.064 * 0.5 - 0.5);
    expect(simulate(760, 520, 0.5).outer).toBeLessThan(40);
  });

  it('上下边距：上 72、下 52（分页器 margin 取 52，view 下移 20）', () => {
    const l = computeLayout(1144, 860);
    expect(l.attrs.margin).toBe('52px');
    expect(l.inset.top + parseFloat(l.attrs.margin)).toBe(TOP_MARGIN);
    expect(parseFloat(l.attrs.margin)).toBe(BOTTOM_MARGIN);
  });

  describe('栏数（M5）', () => {
    it('auto：规则不变（999 单页，1000 双页）', () => {
      expect(computeLayout(999, 860, 1, 'auto').two).toBe(false);
      expect(computeLayout(1000, 860, 1, 'auto').two).toBe(true);
      expect(computeLayout(1144, 860)).toEqual(computeLayout(1144, 860, 1, 'auto'));
    });

    it('one：无论多宽都是单栏，版心居中，上限 680', () => {
      for (const w of [700, 1144, 1920, 2560]) {
        const { l, divisor, column, outer } = simulate(w, 860, 1, 'one');
        expect(l.two).toBe(false);
        expect(l.attrs['max-column-count']).toBe('1');
        expect(divisor).toBe(1);
        expect(column).toBeLessThanOrEqual(ONE_PAGE_MAX_TEXT + 0.5);
        expect(outer * 2 + column).toBeCloseTo(w, 0);
      }
      // 页边距 0.5× 时放宽上限为 680/0.5
      expect(simulate(2560, 1300, 0.5, 'one').column).toBeCloseTo(ONE_PAGE_MAX_TEXT / 0.5, 0);
    });

    it('two：宽 ≥ 640 且横屏就走双栏分支，外边距和中缝比例与 auto 相同', () => {
      expect(TWO_COL_MIN_WIDTH).toBe(640);
      expect(computeLayout(639, 500, 1, 'two').two).toBe(false);
      expect(computeLayout(640, 500, 1, 'two').two).toBe(true);
      const a = simulate(900, 700, 1, 'two');
      expect(a.l.two).toBe(true);
      expect(a.divisor).toBe(2);
      expect(a.outer).toBeCloseTo(0.064 * 900, 0);
      expect(a.gap).toBeCloseTo(0.069 * 900, 0);
      // 与 auto 在 1144 宽时完全一致
      expect(computeLayout(1144, 860, 1, 'two')).toEqual(computeLayout(1144, 860, 1, 'auto'));
      // 页边距倍数照常生效
      expect(simulate(900, 700, 1.5, 'two').outer).toBeCloseTo(0.064 * 900 * 1.5, 0);
    });

    it('two：竖屏容器（高 - 20 > 宽）回退单栏，因为分页器在竖屏里强制单栏', () => {
      expect(computeLayout(800, 1000, 1, 'two').two).toBe(false);
      expect(computeLayout(800, 820, 1, 'two').two).toBe(true); // 800 宽、高 820：820 - 20 = 800，不算竖屏
      expect(computeLayout(800, 821, 1, 'two').two).toBe(false);
    });

    it('two：窄于 640 回退单栏，几何与 auto 的单栏一致', () => {
      expect(computeLayout(600, 500, 1, 'two')).toEqual(computeLayout(600, 500, 1, 'auto'));
    });
  });
});
