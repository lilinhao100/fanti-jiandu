import { describe, expect, it } from 'vitest';
import { COL_GAP, COVER_MAX, COVER_MIN, columnsFor } from './grid';

const colWidth = (width: number): number => {
  const n = columnsFor(width);
  return (width - (n - 1) * COL_GAP) / n;
};

describe('封面网格列数', () => {
  it('默认窗口 1144 宽：内容区 804，4 列，每列约 181（采样是 185）', () => {
    expect(columnsFor(1144 - 295 - 45)).toBe(4);
    expect(colWidth(804)).toBeCloseTo(181.5, 1);
  });
  it('最小窗口 760 宽：内容区 420，2 列', () => {
    expect(columnsFor(760 - 295 - 45)).toBe(2);
  });
  it('常见宽度下列宽都在 150–200 之间（宽度恰好卡在两个列数之间时，允许差 3px）', () => {
    for (let w = 500; w <= 2400; w += 7) {
      const cw = colWidth(w);
      expect(cw).toBeGreaterThanOrEqual(COVER_MIN - 3);
      expect(cw).toBeLessThanOrEqual(COVER_MAX + 3);
    }
  });
  it('极窄：至少 1 列', () => {
    expect(columnsFor(0)).toBe(1);
    expect(columnsFor(120)).toBe(1);
  });
});
