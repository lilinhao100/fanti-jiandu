// 书签：判断“当前页有没有书签”、取页面开头的片段。
import * as CFI from 'foliate-js/epubcfi.js';
import type { Bookmark } from '../model';

/**
 * 书签记的是加书签时那一页的范围 CFI，取它的起点当“书签位置”。
 * 页面的范围 CFI（foliate 的 relocate 里的 cfi）是 [起点, 终点)：书签位置落在里面，这一页就算有书签。
 * 这样改字号、改窗口大小、换版心之后，书签仍然落在包含那段文字的页上。
 */
export function isOnPage(bookmarkCfi: string, pageCfi: string): boolean {
  try {
    const at = CFI.collapse(bookmarkCfi);
    const start = CFI.collapse(pageCfi);
    const end = CFI.collapse(pageCfi, true);
    return CFI.compare(at, start) >= 0 && (CFI.compare(at, end) < 0 || CFI.compare(start, end) === 0);
  } catch {
    return bookmarkCfi === pageCfi;
  }
}

export function pageBookmarks(list: Bookmark[], pageCfi: string): Bookmark[] {
  return list.filter((b) => isOnPage(b.cfi, pageCfi));
}

/** 页面开头的一段文字：压缩空白，最多 60 字 */
export function snippetOf(range: Range | undefined | null, max = 60): string {
  if (!range) return '';
  let text = '';
  try {
    text = range.toString();
  } catch {
    return '';
  }
  return [...text.replace(/\s+/g, ' ').trim()].slice(0, max).join('');
}
