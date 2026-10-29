// 标注定位的纯字符串部分（ARCHITECTURE 3.6）。不碰 DOM，Node 里能测。
//
// 为什么不直接比较字符串：同一段话在“显示简体”和“显示原文”两种模式下文字不同（字形、词汇、引号、
// PDF 转制书的空格与断句都变了），可是用户选的是“那一句话”。做法是把两边都折叠到同一个“键空间”再比：
//   - 逐字转成简体字形（不做词汇层，因为词汇会改字数）、引号统一、竖排标点还原；
//   - 空白一律丢掉（排版清理会删空格、合并段落，源码折行也会留下空白）；
//   - 同时记下“键里的第 i 个字”对应原文的哪一段，找到之后再换回原文的偏移量。
// 这样：简体里存的高亮，在繁体原文里也能找到；繁体里存的，在简体里也能找到；跨过词汇替换（軟體→软件）的，
// 由下面的“两端锚点”近似匹配兜底。
import { DEFAULT_OPTIONS, convertText, type ConvertOptions } from '@fjd/engine';

/** 单个字（码点）的折叠函数；带缓存，一章几万字也很快 */
export type Fold = (codePoint: string) => string;

export function makeFold(variant: ConvertOptions['variant']): Fold {
  const opts: ConvertOptions = { ...DEFAULT_OPTIONS, convert: true, vocabulary: false, quotes: true, cleanup: false, horizontal: true, variant };
  const cache = new Map<string, string>();
  return (ch) => {
    let v = cache.get(ch);
    if (v === undefined) {
      v = convertText(ch, opts);
      cache.set(ch, v);
    }
    return v;
  };
}

const SPACE = /[\s​-‍﻿]/;

/** 折叠后的整章文字。key 里第 i 个字对应原文 [start[i], end[i]) */
export interface KeyIndex {
  key: string;
  start: number[];
  end: number[];
}

export function buildKeyIndex(text: string, fold: Fold): KeyIndex {
  let key = '';
  const start: number[] = [];
  const end: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const n = ch.length;
    if (!SPACE.test(ch)) {
      const f = fold(ch);
      for (let k = 0; k < f.length; k++) {
        key += f[k];
        start.push(i);
        end.push(i + n);
      }
    }
    i += n;
  }
  return { key, start, end };
}

/** 只要折叠后的字符串（查找串用） */
export function foldString(s: string, fold: Fold): string {
  let out = '';
  for (const ch of s) if (!SPACE.test(ch)) out += fold(ch);
  return out;
}

export interface AnchorQuery {
  text: string;
  prefix: string;
  suffix: string;
}

export interface TextSpan {
  /** 原文（章节全文）里的偏移，[start, end) */
  start: number;
  end: number;
  /** exact：整段文字逐字对上；near：靠两端锚点近似对上（词汇替换改过字数等） */
  how: 'exact' | 'near';
}

/** 从后往前数，两个字符串末尾有多少个字相同 */
function commonTail(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++;
  return n;
}

function commonHead(a: string, b: string): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}

function occurrences(hay: string, needle: string, from = 0, to = hay.length): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle, from); i !== -1 && i < to; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** 候选位置的上下文得分：前面有几个字和 prefix 末尾相同 + 后面有几个字和 suffix 开头相同 */
function contextScore(key: string, ks: number, ke: number, pre: string, suf: string): number {
  return commonTail(key.slice(Math.max(0, ks - pre.length), ks), pre) + commonHead(key.slice(ke, ke + suf.length), suf);
}

/** 两段字大致一样：开头相同的字数 + 结尾相同的字数 ≥ 较长者的一半 */
function similar(a: string, b: string): boolean {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return true;
  return commonHead(a, b) + commonTail(a, b) >= longest * 0.5;
}

/**
 * 在整章里找一条标注。先找整段文字（出现多次时用 prefix、suffix 挑最像的）；
 * 找不到就用两端锚点：文字的头尾各 6 个字，或者前后文各 6 个字，中间长度相差在 ±3 以内。
 * 都不行就返回 null，调用方把它放进“无法定位”。
 */
export function locateInIndex(idx: KeyIndex, q: AnchorQuery, fold: Fold): TextSpan | null {
  const { key } = idx;
  const needle = foldString(q.text, fold);
  if (!needle) return null;
  const pre = foldString(q.prefix, fold);
  const suf = foldString(q.suffix, fold);
  const toSpan = (ks: number, ke: number, how: TextSpan['how']): TextSpan | null =>
    ke > ks && ke <= key.length ? { start: idx.start[ks]!, end: idx.end[ke - 1]!, how } : null;

  const exact = occurrences(key, needle);
  if (exact.length > 0) {
    let best = exact[0]!;
    if (exact.length > 1) {
      let bestScore = -1;
      for (const p of exact) {
        const s = contextScore(key, p, p + needle.length, pre, suf);
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
      }
    }
    return toSpan(best, best + needle.length, 'exact');
  }

  const L = needle.length;
  const W = 6;
  let best: { ks: number; ke: number; score: number } | null = null;
  const consider = (ks: number, ke: number): void => {
    if (ke <= ks || !similar(key.slice(ks, ke), needle)) return;
    const score = contextScore(key, ks, ke, pre, suf);
    if (!best || score > best.score) best = { ks, ke, score };
  };

  // 锚点一：文字自己的头和尾（文字够长时）
  if (L >= 10) {
    const head = needle.slice(0, W);
    const tail = needle.slice(-W);
    for (const p of occurrences(key, head)) {
      for (const q of occurrences(key, tail, p + Math.max(0, Math.floor(L * 0.7) - W), p + Math.ceil(L * 1.3) + 1)) consider(p, q + tail.length);
    }
  }
  // 锚点二：前文和后文（文字短、里头有被词汇替换改掉的字时）
  const preTail = pre.slice(-W);
  const sufHead = suf.slice(0, W);
  if (preTail.length >= 3 && sufHead.length >= 3) {
    for (const p of occurrences(key, preTail)) {
      const s = p + preTail.length;
      for (const q of occurrences(key, sufHead, s + Math.max(1, L - 3), s + L + 4)) consider(s, q);
    }
  }
  const b = best as { ks: number; ke: number } | null;
  return b ? toSpan(b.ks, b.ke, 'near') : null;
}

/** 把空白压成一个空格 */
export const collapseSpace = (s: string): string => s.replace(/\s+/g, ' ');

/** 取标注的上下文（各 32 字，空白压缩后再取），ARCHITECTURE 3.4 */
export function contextOf(text: string, start: number, end: number, n = 32): { prefix: string; suffix: string } {
  const before = collapseSpace(text.slice(Math.max(0, start - n * 4), start));
  const after = collapseSpace(text.slice(end, end + n * 4));
  return { prefix: before.slice(-n), suffix: after.slice(0, n) };
}

/** 去掉选区两头的空白，返回收紧后的 [start, end)；全是空白时返回 null */
export function trimSpan(text: string, start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  while (s < e && SPACE.test(text[s]!)) s++;
  while (e > s && SPACE.test(text[e - 1]!)) e--;
  return e > s ? { start: s, end: e } : null;
}
