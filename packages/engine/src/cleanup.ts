import type { Trace } from './types';

/**
 * 排版清理规则（宁可漏修，不可误伤）。
 * 记号 C = 汉字或全角标点：U+3000–303F、U+FF00–FFEF、U+4E00–9FFF、U+3400–4DBF、U+F900–FAFF、
 * U+20000–2FFFF，以及“”‘’…—·
 */
const C = '[\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2FFFF}\u201C\u201D\u2018\u2019\u2026\u2014\u00B7]';

// R0：C 与 C 之间、含换行的空白（xhtml 源码折行在浏览器里会渲染成空格）
const R0_ALT = '([ \t]*[\r\n]+[ \t]*)';
// R1：C 与 C 之间的 1 到 3 个 ASCII 空格或 NBSP。全角空格 U+3000 不在其中，保留
const R1_ALT = '([ \u00A0]{1,3})';

const RE_R0 = new RegExp(`(${C})${R0_ALT}(?=${C})`, 'gu');
const RE_R01 = new RegExp(`(${C})(?:${R0_ALT}|${R1_ALT})(?=${C})`, 'gu');

export interface Deletion {
  start: number;
  end: number;
  rule: 'R0' | 'R1';
}

/** 在已拼接好的一段文字里找出 R0（以及 r1 为真时的 R1）要删掉的区间 */
export function findDeletions(s: string, r1: boolean): Deletion[] {
  const out: Deletion[] = [];
  const re = r1 ? RE_R01 : RE_R0;
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    const lead = m[1] ?? '';
    const start = m.index + lead.length;
    const ws = m[2] ?? m[3] ?? '';
    out.push({ start, end: start + ws.length, rule: m[2] !== undefined ? 'R0' : 'R1' });
  }
  return out;
}

/** 按删除区间，把拼接后的文字拆回各个节点（节点内容之和等于被拼接的字符串） */
export function applyDeletions(values: string[], dels: Deletion[]): string[] {
  if (dels.length === 0) return values;
  const total = values.reduce((n, v) => n + v.length, 0);
  const drop = new Uint8Array(total);
  for (const d of dels) drop.fill(1, d.start, d.end);
  const out: string[] = [];
  let pos = 0;
  for (const v of values) {
    let r = '';
    for (let i = 0; i < v.length; i++) if (!drop[pos + i]) r += v[i];
    out.push(r);
    pos += v.length;
  }
  return out;
}

export function traceDeletions(s: string, dels: Deletion[], trace: Trace): void {
  for (const d of dels) {
    trace({
      rule: d.rule,
      prefix: s.slice(Math.max(0, d.start - 10), d.start),
      before: s.slice(d.start, d.end),
      after: '',
      suffix: s.slice(d.end, d.end + 10),
    });
  }
}

/* ---------------------------------------------------------------- R2 合并断开的段落 */

const XHTML_NS = 'http://www.w3.org/1999/xhtml';
const NO_MERGE_ANCESTORS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th', 'figure', 'blockquote', 'pre', 'code']);
const SKIP_SUBTREE = new Set(['script', 'style', 'svg', 'math']);

const LAST_IS_HAN = /\p{Script=Han}$/u;
const FIRST_IS_HAN = /^\p{Script=Han}/u;
const FIRST_IS_LATIN_THEN_HAN = /^[A-Za-z0-9]+\p{Script=Han}/u;
const CHAPTER_HEAD = /^第[\s0-9０-９〇零一二三四五六七八九十百千两兩]+[章节節回卷篇部集幕]/;
const LIST_HEAD = /^[一二三四五六七八九十]+[、．.）)]/;
const TRIM = /^[\s\u3000]+|[\s\u3000]+$/g;

function lname(n: Node): string {
  return ((n as Element).localName ?? (n as Element).nodeName ?? '').toLowerCase();
}

function isElement(n: Node | null): n is Element {
  return !!n && n.nodeType === 1;
}

function isTextNode(n: Node): boolean {
  return n.nodeType === 3 || n.nodeType === 4;
}

/** 取下一个兄弟元素；中间只允许空白文本和注释，否则返回 null */
function nextElementStrict(a: Element): Element | null {
  for (let n = a.nextSibling; n; n = n.nextSibling) {
    if (n.nodeType === 8) continue; // 注释
    if (isElement(n)) return n;
    if (isTextNode(n) && /^\s*$/.test(n.nodeValue ?? '')) continue;
    return null;
  }
  return null;
}

/** 元素内最后（first=false）或最前（first=true）的有内容的叶子；不是文本节点就返回 null */
function edgeLeaf(el: Element, first: boolean): Text | null {
  let node: Node | null = el;
  while (node) {
    if (isTextNode(node)) return node as Text;
    let child: Node | null = first ? node.firstChild : node.lastChild;
    // 跳过空白文本和注释
    while (
      child &&
      (child.nodeType === 8 || (isTextNode(child) && /^\s*$/.test(child.nodeValue ?? '')) || isEmptyAnchor(child))
    ) {
      child = first ? child.nextSibling : child.previousSibling;
    }
    if (!child) return null; // 空元素（br、img 之类）或者全是空白
    node = child;
  }
  return null;
}

/** 空的 <a id>、<span id>：只是锚点，没有内容，找文本边界时跳过 */
function isEmptyAnchor(n: Node): boolean {
  if (!isElement(n) || n.firstChild) return false;
  const name = lname(n);
  return name === 'a' || name === 'span';
}

function attrsKey(el: Element): string {
  const parts: string[] = [];
  const attrs = el.attributes;
  for (let i = 0; i < attrs.length; i++) {
    const at = attrs[i]!;
    if (at.name === 'id') continue;
    parts.push(`${at.name}=${at.value}`);
  }
  return parts.sort().join('\u0000');
}

/** 元素文字里，有多大比例落在带 href 的 <a> 里面（目录条目、网址列表整行都是链接） */
function linkedRatio(el: Element): number {
  let total = 0;
  let linked = 0;
  const walk = (n: Node, inLink: boolean): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (isTextNode(c)) {
        const len = (c.nodeValue ?? '').replace(/[\s\u3000]+/g, '').length;
        total += len;
        if (inLink) linked += len;
      } else if (isElement(c)) {
        walk(c, inLink || (lname(c) === 'a' && c.hasAttribute('href')));
      }
    }
  };
  walk(el, false);
  return total === 0 ? 0 : linked / total;
}

/** A 的最后一“行”（最后一段空白之后的文字）短于这个字数，说明段落是自然结束的，不是在页底被截断 */
const MIN_LAST_LINE = 12;

function canMerge(a: Element, b: Element, textA: string): boolean {
  if (lname(a) !== 'p' || lname(b) !== 'p') return false;
  // 1. class（以及其他除 id 外的属性）相同
  if (attrsKey(a) !== attrsKey(b)) return false;
  // 2. A 去掉首尾空白后长度 ≥ 20，最后一个字符是汉字
  const ta = textA.replace(TRIM, '');
  // （长度只数非空白字符：PDF 转出来的行内空格不能凑数）
  if ([...ta.replace(/\s/g, '')].length < 20 || !LAST_IS_HAN.test(ta)) return false;
  // 3. B 的第一个字符是汉字，或拉丁字母/数字后紧跟汉字；不能是“第…章/节”或“一、”之类
  const rawB = b.textContent ?? '';
  if (/^\u3000/.test(rawB) || /^ {2,}/.test(rawB)) return false; // 首行缩进：这是新段落的标记
  const tb = rawB.replace(TRIM, '');
  if (!(FIRST_IS_HAN.test(tb) || FIRST_IS_LATIN_THEN_HAN.test(tb))) return false;
  if (CHAPTER_HEAD.test(tb) || LIST_HEAD.test(tb)) return false;
  // 保守的附加条件（设计里没有，只会让合并更少）：
  // - A 的最后一行太短：段落是自然结束的（图注、表格行、小标题粘在段尾），不是页底截断
  const lines = ta.split(/[\s\u3000]+/);
  if (lines.length > 1 && [...lines[lines.length - 1]!].length < MIN_LAST_LINE) return false;
  // - 整行都是链接（目录条目）
  if (linkedRatio(a) >= 0.8 || linkedRatio(b) >= 0.8) return false;
  // A 必须以文本结尾，B 必须以文本开头（不能以图片、换行、锚点之类开头结尾）
  const la = edgeLeaf(a, false);
  const fb = edgeLeaf(b, true);
  if (!la || !fb) return false;
  return true;
}

function mergeInto(a: Element, b: Element): void {
  const la = edgeLeaf(a, false)!;
  const fb = edgeLeaf(b, true)!;
  la.nodeValue = (la.nodeValue ?? '').replace(/[\s\u3000]+$/, '');
  fb.nodeValue = (fb.nodeValue ?? '').replace(/^[\s\u3000]+/, '');
  const bid = b.getAttribute('id');
  if (bid) {
    const doc = a.ownerDocument!;
    const span = doc.createElementNS(a.namespaceURI ?? XHTML_NS, 'span');
    span.setAttribute('id', bid);
    a.appendChild(span);
  }
  while (b.firstChild) a.appendChild(b.firstChild);
  b.parentNode!.removeChild(b);
}

/**
 * R2：合并在原 PDF 分页处被截断的相邻兄弟 <p>。返回合并次数。
 * 条件见 canMerge；B 原有的 id 变成接缝处的空 <span id>，保证锚点仍然可用。可链式合并。
 */
export function mergeBrokenParagraphs(root: Element, trace?: Trace): number {
  let merged = 0;

  const visit = (container: Element, blocked: boolean): void => {
    if (!blocked) {
      let a: Node | null = container.firstChild;
      while (a) {
        if (isElement(a) && lname(a) === 'p') {
          for (;;) {
            const b = nextElementStrict(a);
            if (!b) break;
            const textA = a.textContent ?? '';
            if (!canMerge(a, b, textA)) break;
            if (trace) {
              const ta = textA.replace(TRIM, '');
              const tb = (b.textContent ?? '').replace(TRIM, '');
              trace({
                rule: 'R2',
                prefix: [...ta].slice(-16).join(''),
                before: '¶',
                after: '',
                suffix: [...tb].slice(0, 16).join(''),
              });
            }
            mergeInto(a, b);
            merged++;
          }
        }
        a = a.nextSibling;
      }
    }
    for (let c: Node | null = container.firstChild; c; c = c.nextSibling) {
      if (!isElement(c)) continue;
      const n = lname(c);
      if (SKIP_SUBTREE.has(n) || n === 'p') continue;
      visit(c, blocked || NO_MERGE_ANCESTORS.has(n));
    }
  };

  visit(root, NO_MERGE_ANCESTORS.has(lname(root)));
  return merged;
}

