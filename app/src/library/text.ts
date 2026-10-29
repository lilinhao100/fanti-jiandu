// 书库里书名、作者的显示：用 convertText 转成简体（规格：显示的书名和作者用 convertText 转换）。
import { convertText, DEFAULT_OPTIONS, detectScript, type ConvertOptions } from '@fjd/engine';
import type { BookRecord, Settings } from '../model';
import { cleanTitle } from '../reader/meta';
import { displayMode, effectiveOptions, isTraditional } from '../reader/options';

type Brief = Pick<BookRecord, 'title' | 'author' | 'script' | 'display'>;

/**
 * 书还没打开过（script 未知）时，用书名加作者当样本临时判断，
 * 否则刚导入的繁体书在书库里会显示成繁体。打开后以整本书的检测结果为准。
 */
export function libraryOptions(book: Brief, conversion: Settings['conversion']): ConvertOptions {
  const script = book.script ?? detectScript(`${book.title}${book.author}`);
  return effectiveOptions({ script, display: displayMode(book) }, conversion);
}

/** 显示用的书名：去掉“(Traditional Chinese Edition)”这类后缀，再按设置转换。原始元数据不改。 */
export function displayTitle(book: Brief, conversion: Settings['conversion']): string {
  return convertText(cleanTitle(book.title), libraryOptions(book, conversion));
}

export function displayAuthor(book: Brief, conversion: Settings['conversion']): string {
  return convertText(book.author, libraryOptions(book, conversion));
}

export function canToggleDisplay(book: Brief): boolean {
  return isTraditional(book.script ?? detectScript(`${book.title}${book.author}`));
}

/** 书库排序 */
export function sortBooks<T extends Pick<BookRecord, 'title' | 'author' | 'addedAt' | 'lastOpenedAt'>>(
  books: T[],
  sort: Settings['library']['sort'],
): T[] {
  const out = [...books];
  const collator = new Intl.Collator('zh-Hans-CN');
  switch (sort) {
    case 'title':
      return out.sort((a, b) => collator.compare(a.title, b.title));
    case 'author':
      return out.sort((a, b) => collator.compare(a.author, b.author));
    case 'added':
      return out.sort((a, b) => b.addedAt - a.addedAt);
    default:
      return out.sort((a, b) => (b.lastOpenedAt ?? b.addedAt) - (a.lastOpenedAt ?? a.addedAt));
  }
}

/** 没有封面的书：由书名哈希从 6 种柔和色里选一种（DESIGN 第 1 节）。色值在 tokens.css 的 --c-cover-1..6 */
export const COVER_COLORS = [1, 2, 3, 4, 5, 6].map((n) => `var(--c-cover-${n})`) as readonly string[];

/** 1..6：同一个书名永远是同一种颜色 */
export function coverIndex(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return (h % COVER_COLORS.length) + 1;
}

export function coverColor(title: string): string {
  return COVER_COLORS[coverIndex(title) - 1]!;
}

// ---------------------------------------------------------------- 书库内搜索

const CHAR_ONLY: ConvertOptions = { ...DEFAULT_OPTIONS, convert: true, vocabulary: false, quotes: false, cleanup: false, horizontal: false, variant: 't' };
const WITH_VOCAB: ConvertOptions = { ...DEFAULT_OPTIONS, convert: true, vocabulary: true, quotes: false, cleanup: false, horizontal: false, variant: 'tw' };

/**
 * 书名、作者里是否含有所有搜索词（空格分隔，不分大小写）。
 * 繁体、简体都能搜到：书名、作者取“原文、显示文字、逐字转简体”三种形式，搜索词取“原文、逐字转简体、带词汇转简体”三种形式，任意一对对上就算。
 */
export function matchesQuery(book: Brief, query: string, conversion: Settings['conversion']): boolean {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const hay = [book.title, cleanTitle(book.title), displayTitle(book, conversion), book.author, displayAuthor(book, conversion)]
    .flatMap((x) => [x, convertText(x, CHAR_ONLY)])
    .join('\n')
    .toLowerCase();
  return tokens.every((t) => {
    const forms = new Set([t, convertText(t, CHAR_ONLY), convertText(t, WITH_VOCAB)]);
    for (const f of forms) if (hay.includes(f)) return true;
    return false;
  });
}

/** 阅读进度的卡片状态文字 */
export function statusLabel(book: Pick<BookRecord, 'lastOpenedAt' | 'progress'>): { kind: 'new' | 'percent' | 'done'; text: string } {
  const f = book.progress?.fraction;
  if (typeof f === 'number' && f >= 0.995) return { kind: 'done', text: '已读完' };
  if (typeof f === 'number' && f > 0) return { kind: 'percent', text: `${Math.max(1, Math.round(f * 100))}%` };
  if (!book.lastOpenedAt) return { kind: 'new', text: '新增' };
  return { kind: 'percent', text: '0%' };
}

/** 主页“继续阅读”：读过、还没读完的书，最近打开的在前 */
export function continueReading<T extends Pick<BookRecord, 'lastOpenedAt' | 'progress'>>(books: T[], limit = 10): T[] {
  return books
    .filter((b) => {
      if (!b.lastOpenedAt) return false;
      const f = b.progress?.fraction;
      return !(typeof f === 'number' && f >= 0.995);
    })
    .sort((a, b) => (b.lastOpenedAt ?? 0) - (a.lastOpenedAt ?? 0))
    .slice(0, limit);
}

/** 主页“最近添加”：按添加时间，新的在前 */
export function recentlyAdded<T extends Pick<BookRecord, 'addedAt'>>(books: T[], limit = 12): T[] {
  return [...books].sort((a, b) => b.addedAt - a.addedAt).slice(0, limit);
}

/** 列表视图里的添加日期：2026年10月29日 */
export function formatDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 卡片上的小字：“图书 · 18%” */
export function cardSubtitle(book: Pick<BookRecord, 'lastOpenedAt' | 'progress'>): string {
  return `图书 · ${statusLabel(book).text}`;
}
