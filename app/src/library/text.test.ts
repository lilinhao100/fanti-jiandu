import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../model';
import { COVER_COLORS, canToggleDisplay, cardSubtitle, continueReading, coverColor, formatDate, recentlyAdded, displayAuthor, displayTitle, matchesQuery, sortBooks, statusLabel } from './text';

const conv = DEFAULT_SETTINGS.conversion;

describe('书库文字', () => {
  it('没打开过的繁体书：书名、作者也显示简体', () => {
    const b = { title: '燈塔日記', author: '林長風' };
    expect(displayTitle(b, conv)).toBe('灯塔日记');
    expect(displayAuthor(b, conv)).toBe('林长风');
    expect(canToggleDisplay(b)).toBe(true);
  });

  it('台湾词汇：軟體 → 软件', () => {
    expect(displayTitle({ title: '軟體工程', author: '' }, conv)).toBe('软件工程');
  });

  it('切到原文后显示原文', () => {
    const b = { title: '燈塔日記', author: '林長風', display: 'original' as const };
    expect(displayTitle(b, conv)).toBe('燈塔日記');
  });

  it('简体书名保持不变', () => {
    const b = { title: '星图', author: '林晓云' };
    expect(displayTitle(b, conv)).toBe('星图');
    expect(canToggleDisplay(b)).toBe(false);
  });

  it('书名后缀“(Traditional Chinese Edition)”之类显示时去掉，原始元数据不动', () => {
    const b = { title: '燈塔日記: 晨霧、潮汐與遠方的來信 (Traditional_chinese Edition)', author: 'Lin, Changfeng' };
    expect(displayTitle(b, conv)).toBe('灯塔日记: 晨雾、潮汐与远方的来信');
    expect(displayTitle({ title: '日常練習（繁體中文版）', author: '' }, conv)).toBe('日常练习');
    expect(b.title).toContain('Traditional_chinese Edition');
  });

  it('英文书名不动', () => {
    expect(displayTitle({ title: 'Plain Notes', author: 'Pat Lee' }, conv)).toBe('Plain Notes');
  });
});

describe('排序与封面', () => {
  const books = [
    { title: 'B', author: 'x', addedAt: 1, lastOpenedAt: 30 },
    { title: 'A', author: 'z', addedAt: 3 },
    { title: 'C', author: 'y', addedAt: 2, lastOpenedAt: 10 },
  ];
  it('最近阅读 = 打开时间，没打开过的按添加时间', () => {
    expect(sortBooks(books, 'recent').map((b) => b.title)).toEqual(['B', 'C', 'A']);
  });
  it('其他排序', () => {
    expect(sortBooks(books, 'title').map((b) => b.title)).toEqual(['A', 'B', 'C']);
    expect(sortBooks(books, 'author').map((b) => b.author)).toEqual(['x', 'y', 'z']);
    expect(sortBooks(books, 'added').map((b) => b.title)).toEqual(['A', 'C', 'B']);
  });
  it('不改原数组', () => {
    const copy = [...books];
    sortBooks(books, 'title');
    expect(books).toEqual(copy);
  });
  it('生成封面颜色：同名同色，且在 6 种里', () => {
    expect(coverColor('燈塔日記')).toBe(coverColor('燈塔日記'));
    expect(COVER_COLORS).toContain(coverColor('任意书名'));
    expect(COVER_COLORS).toHaveLength(6);
  });
});

describe('状态文字', () => {
  it('新增 / 百分比 / 已读完', () => {
    expect(statusLabel({})).toEqual({ kind: 'new', text: '新增' });
    expect(statusLabel({ lastOpenedAt: 1 })).toEqual({ kind: 'percent', text: '0%' });
    expect(statusLabel({ lastOpenedAt: 1, progress: { cfi: 'x', fraction: 0.184, updatedAt: 1 } })).toEqual({ kind: 'percent', text: '18%' });
    expect(statusLabel({ lastOpenedAt: 1, progress: { cfi: 'x', fraction: 0.004, updatedAt: 1 } }).text).toBe('1%');
    expect(statusLabel({ lastOpenedAt: 1, progress: { cfi: 'x', fraction: 1, updatedAt: 1 } })).toEqual({ kind: 'done', text: '已读完' });
  });
});

describe('书库内搜索', () => {
  const b = { title: '軟體與網路的故事 (Traditional Chinese Edition)', author: '王小明' };
  it('繁体、简体都能搜到书名', () => {
    expect(matchesQuery(b, '軟體', conv)).toBe(true);
    expect(matchesQuery(b, '软件', conv)).toBe(true);
    expect(matchesQuery(b, '软体', conv)).toBe(true); // 逐字转简体
    expect(matchesQuery(b, '网路', conv)).toBe(true);
    expect(matchesQuery(b, '網路', conv)).toBe(true);
  });
  it('作者、英文不分大小写、多个词都要对上', () => {
    expect(matchesQuery(b, '王小明', conv)).toBe(true);
    expect(matchesQuery({ title: 'Plain Notes', author: 'Pat Lee' }, 'lee plain', conv)).toBe(true);
    expect(matchesQuery(b, '软件 王小明', conv)).toBe(true);
    expect(matchesQuery(b, '软件 李四', conv)).toBe(false);
  });
  it('搜不到的和空搜索', () => {
    expect(matchesQuery(b, '星图', conv)).toBe(false);
    expect(matchesQuery(b, '   ', conv)).toBe(true);
  });
  it('繁体作者名也能用简体搜', () => {
    expect(matchesQuery({ title: 'x', author: '林長風' }, '林长风', conv)).toBe(true);
    expect(matchesQuery({ title: 'x', author: '林长风' }, '林長風', conv)).toBe(true);
  });
});

describe('主页分区', () => {
  const mk = (id: string, addedAt: number, lastOpenedAt?: number, fraction?: number) => ({
    id,
    addedAt,
    lastOpenedAt,
    progress: fraction === undefined ? undefined : { cfi: 'x', fraction, updatedAt: 1 },
  });
  it('继续阅读：打开过且没读完，最近打开的在前', () => {
    const books = [mk('a', 1), mk('b', 2, 50, 0.2), mk('c', 3, 90, 0.5), mk('d', 4, 70, 1), mk('e', 5, 10)];
    expect(continueReading(books).map((b) => b.id)).toEqual(['c', 'b', 'e']);
    expect(continueReading(books, 1).map((b) => b.id)).toEqual(['c']);
  });
  it('最近添加：新的在前，限制数量', () => {
    const books = [mk('a', 1), mk('b', 3), mk('c', 2)];
    expect(recentlyAdded(books).map((b) => b.id)).toEqual(['b', 'c', 'a']);
    expect(recentlyAdded(books, 2).map((b) => b.id)).toEqual(['b', 'c']);
  });
  it('日期和副标题', () => {
    expect(formatDate(new Date(2026, 9, 29).getTime())).toBe('2026年10月29日');
    expect(cardSubtitle({ lastOpenedAt: 1, progress: { cfi: 'x', fraction: 0.18, updatedAt: 1 } })).toBe('图书 · 18%');
  });
});
