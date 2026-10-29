// 目录：给界面用的转换后目录（拷贝一份，因为 foliate 会就地给 book.toc 的条目加 id）。
import { convertText, type ConvertOptions } from '@fjd/engine';
import type { TocEntry } from '../store/reader';
import type { TocItem } from './foliateTypes';

/**
 * ARCHITECTURE 2.4 的“C”：汉字或全角标点。
 * 引擎只导出了 convertText，没有导出排版清理，所以目录标签里的 PDF 空格要在这里按同一条 R1 规则处理。
 */
const C = String.raw`[　-〿＀-￯一-鿿㐀-䶿豈-﫿\u{20000}-\u{2FFFF}“”‘’…—·]`;
const R1 = new RegExp(String.raw`(?<=${C})[  ]{1,3}(?=${C})`, 'gu');

/** R1：只删汉字与汉字之间的 ASCII 空格和 NBSP；全角空格、中英之间的空格保留 */
export function stripHanSpaces(s: string): string {
  return s.replace(R1, '');
}

export interface TocConvertOptions {
  text: ConvertOptions;
  /** 书是 PDF 转制且清理开关开着，才处理空格 */
  stripSpaces: boolean;
}

export function convertToc(items: TocItem[] | undefined, o: TocConvertOptions): TocEntry[] {
  if (!items) return [];
  return items.map((it) => {
    let label = convertText((it.label ?? '').trim(), o.text);
    if (o.stripSpaces) label = stripHanSpaces(label);
    return {
      label: label || '（无标题）',
      href: it.href,
      subitems: it.subitems?.length ? convertToc(it.subitems, o) : undefined,
    };
  });
}
