import { applyDeletions, findDeletions, mergeBrokenParagraphs, traceDeletions } from './cleanup';
import { convertString, getConverter } from './convert';
import { transformCss } from './css';
import { QUOTE_MAP, VERTICAL_PUNCT_MAP } from './punct';
import {
  emptyStats,
  type BookContext,
  type ConvertOptions,
  type Trace,
  type TransformEnv,
  type TransformStats,
} from './types';

/** 不转换、不清理的子树 */
const SKIP = new Set(['script', 'style', 'code', 'pre', 'kbd', 'samp', 'var', 'math', 'svg', 'textarea']);

/**
 * 行内元素：文字跨过它们仍然属于同一个块，要按块拼接后统一处理。
 * 不在这个表里的元素（p、div、li、td、img、ruby 的 rt/rp 等）一律当作块边界。
 */
const INLINE = new Set([
  'a', 'abbr', 'acronym', 'b', 'bdi', 'bdo', 'big', 'cite', 'data', 'del', 'dfn', 'em', 'font',
  'i', 'ins', 'mark', 'q', 'ruby', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup',
  'time', 'tt', 'u', 'wbr', 'label', 'nobr',
]);

const XML_TYPES = /^(application\/(xhtml\+)?xml|text\/xml)$/i;
/** XML 里没有定义的命名实体（&nbsp; 之类）。出现时 XML 解析在不同环境下表现不一致，直接走 HTML 解析 */
const HTML_ONLY_ENTITY = /&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)[A-Za-z][\w.-]*;/;

function lname(n: Node): string {
  return ((n as Element).localName ?? (n as Element).nodeName ?? '').toLowerCase();
}

function diffCount(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}

/* ---------------------------------------------------------------- 转换追踪（仅 report 用） */

type ConvRule = 'char' | 'vocab' | 'quotes' | 'punct';
const RANK: Record<ConvRule, number> = { vocab: 3, char: 2, punct: 1, quotes: 0 };

function traceConversion(s: string, out: string, opts: ConvertOptions, trace: Trace): void {
  if (out.length !== s.length) return;
  let s0: string | null = null;
  let s1: string | null = null;
  if (opts.convert) {
    s0 = getConverter(opts.variant, false)(s);
    s1 = getConverter(opts.variant, opts.vocabulary)(s);
    if (s0.length !== s.length || s1.length !== s.length) return;
  }
  const cat = (i: number): ConvRule => {
    if (s1 !== null && s0 !== null) {
      if (s1[i] !== s0[i]) return 'vocab';
      if (s0[i] !== s[i]) return 'char';
    }
    if (VERTICAL_PUNCT_MAP[s[i]!] !== undefined) return 'punct';
    if (QUOTE_MAP[s[i]!] !== undefined) return 'quotes';
    return 'char';
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === out[i]) {
      i++;
      continue;
    }
    let j = i;
    let rule = cat(i);
    while (j < s.length && s[j] !== out[j]) {
      const c = cat(j);
      if (RANK[c] > RANK[rule]) rule = c;
      j++;
    }
    trace({
      rule,
      prefix: s.slice(Math.max(0, i - 10), i),
      before: s.slice(i, j),
      after: out.slice(i, j),
      suffix: s.slice(j, j + 10),
    });
    i = j;
  }
}

/* ---------------------------------------------------------------- 文档遍历 */

interface State {
  opts: ConvertOptions;
  ctx: BookContext;
  stats: TransformStats;
  trace?: Trace;
  changed: boolean;
}

function processRun(nodes: Text[], st: State): void {
  const { opts, ctx, stats, trace } = st;
  const original = nodes.map((n) => n.nodeValue ?? '');
  let cur = original;
  const joined0 = original.join('');
  if (joined0 === '') return;

  // 1. 清理：R0 对所有书，R1 只限 PDF 转制。放在转换之前：
  //    PDF 转出来的书常把词语从中间断开（“回 覆”“軟 體”），先去掉空格，OpenCC 才认得整个词。
  if (opts.cleanup) {
    const dels = findDeletions(joined0, ctx.pdfReflow);
    if (dels.length > 0) {
      for (const d of dels) {
        if (d.rule === 'R0') stats.newlinesRemoved++;
        else stats.spacesRemoved += d.end - d.start;
      }
      if (trace) {
        // 追踪里的上下文用转换后的文字显示，方便人读
        traceDeletions(joined0, dels, (e) =>
          trace({ ...e, prefix: convertString(e.prefix, opts), suffix: convertString(e.suffix, opts) }),
        );
      }
      cur = applyDeletions(cur, dels);
    }
  }

  // 2. 转换：按块拼接后整体转换；长度不变时按原偏移拆回各节点，变了就退回逐节点转换
  if (opts.convert || opts.horizontal) {
    const joined1 = cur === original ? joined0 : cur.join('');
    const conv = convertString(joined1, opts);
    if (conv !== joined1) {
      if (conv.length === joined1.length) {
        const parts: string[] = [];
        let pos = 0;
        for (const v of cur) {
          parts.push(conv.slice(pos, pos + v.length));
          pos += v.length;
        }
        stats.convertedChars += diffCount(joined1, conv);
        if (trace) traceConversion(joined1, conv, opts, trace);
        cur = parts;
      } else {
        const next = cur.map((v) => convertString(v, opts));
        for (let i = 0; i < cur.length; i++) stats.convertedChars += diffCount(cur[i]!, next[i]!);
        cur = next;
      }
    }
  }

  if (cur !== original) {
    for (let i = 0; i < nodes.length; i++) {
      if (cur[i] !== original[i]) {
        nodes[i]!.nodeValue = cur[i]!;
        st.changed = true;
      }
    }
  }
}

function processAttributes(el: Element, st: State): void {
  const { opts, stats } = st;
  if (opts.convert || opts.horizontal) {
    for (const name of ['alt', 'title']) {
      const v = el.getAttribute(name);
      if (v) {
        const c = convertString(v, opts);
        if (c !== v) {
          el.setAttribute(name, c);
          stats.convertedChars += diffCount(v, c);
          st.changed = true;
        }
      }
    }
  }
  if (opts.horizontal) {
    const style = el.getAttribute('style');
    if (style) {
      const c = transformCss(style, opts);
      if (c !== style) {
        el.setAttribute('style', c);
        st.changed = true;
      }
    }
  }
}

function processStyleElement(el: Element, st: State): void {
  if (!st.opts.horizontal) return;
  for (let n = el.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) {
      const v = n.nodeValue ?? '';
      const c = transformCss(v, st.opts);
      if (c !== v) {
        n.nodeValue = c;
        st.changed = true;
      }
    }
  }
}

function processBlock(block: Element, st: State): void {
  processAttributes(block, st);
  let run: Text[] = [];
  const flush = (): void => {
    if (run.length > 0) {
      processRun(run, st);
      run = [];
    }
  };
  const walk = (parent: Node): void => {
    for (let n = parent.firstChild; n; n = n.nextSibling) {
      const t = n.nodeType;
      if (t === 3 || t === 4) {
        run.push(n as Text);
      } else if (t === 1) {
        const el = n as Element;
        const name = lname(el);
        if (SKIP.has(name)) {
          flush();
          if (name === 'style') processStyleElement(el, st);
        } else if (name === 'br') {
          flush();
        } else if (INLINE.has(name)) {
          processAttributes(el, st);
          walk(el);
        } else {
          flush();
          processBlock(el, st);
        }
      }
    }
  };
  walk(block);
  flush();
}

function runAll(
  doc: Document,
  opts: ConvertOptions,
  ctx: BookContext,
  trace?: Trace,
): { stats: TransformStats; changed: boolean } {
  const st: State = { opts, ctx, stats: emptyStats(), trace, changed: false };
  const root = doc.documentElement;
  if (!root) return { stats: st.stats, changed: false };
  // R2 先于转换和 R0/R1：此时每个段落还保留 PDF 的原始换行空格，可以判断“最后一行”；
  // 合并之后接缝两边的文字也能在同一个块里一起转换（词语不会被段落边界切开）。
  if (opts.cleanup && ctx.pdfReflow) {
    const r2Trace: Trace | undefined = trace
      ? (e) => trace({ ...e, prefix: convertString(e.prefix, opts), suffix: convertString(e.suffix, opts) })
      : undefined;
    const merged = mergeBrokenParagraphs(root, r2Trace);
    if (merged > 0) {
      st.stats.paragraphsMerged += merged;
      st.changed = true;
    }
  }
  processBlock(root, st);
  return { stats: st.stats, changed: st.changed };
}

/** 已经解析好的 Document 原地转换（transformMarkup 内部也调用它） */
export function transformDocument(
  doc: Document,
  opts: ConvertOptions,
  ctx: BookContext,
  trace?: Trace,
): TransformStats {
  return runAll(doc, opts, ctx, trace).stats;
}

/* ---------------------------------------------------------------- 整份 markup */

function hasParseError(doc: Document): boolean {
  const root = doc.documentElement;
  if (!root) return true;
  if (lname(root) === 'parsererror') return true;
  return doc.getElementsByTagName('parsererror').length > 0;
}

function doctypeString(doc: Document): string {
  const dt = doc.doctype;
  if (!dt) return '';
  let s = `<!DOCTYPE ${dt.name}`;
  if (dt.publicId) s += ` PUBLIC "${dt.publicId}"${dt.systemId ? ` "${dt.systemId}"` : ''}`;
  else if (dt.systemId) s += ` SYSTEM "${dt.systemId}"`;
  return s + '>\n';
}

/**
 * 章节文档（xhtml/html）整体转换，供阅读器的加载钩子调用。
 * 没有任何改动时原样返回输入字符串。
 */
export function transformMarkup(
  markup: string,
  mediaType: string,
  opts: ConvertOptions,
  ctx: BookContext,
  env: TransformEnv,
  trace?: Trace,
): { markup: string; stats: TransformStats } {
  if (!opts.convert && !opts.cleanup && !opts.horizontal) return { markup, stats: emptyStats() };

  const type = mediaType.trim().toLowerCase();
  const xmlType = XML_TYPES.test(type);
  const parser = new env.DOMParser();
  let doc: Document | null = null;
  if (xmlType && !HTML_ONLY_ENTITY.test(markup)) {
    try {
      doc = parser.parseFromString(markup, type as DOMParserSupportedType);
    } catch {
      doc = null;
    }
    if (doc && hasParseError(doc)) doc = null;
  }
  if (!doc) {
    try {
      doc = parser.parseFromString(markup, 'text/html');
    } catch {
      return { markup, stats: emptyStats() };
    }
    if (!doc.documentElement) return { markup, stats: emptyStats() };
  }

  const { stats, changed } = runAll(doc, opts, ctx, trace);
  if (!changed) return { markup, stats };

  let out: string;
  if (xmlType) {
    // XHTML：XML 解析成功，或者因为 HTML 实体被迫走了 HTML 解析，都用 XMLSerializer，让输出保持良构
    out = new env.XMLSerializer().serializeToString(doc);
    out = out.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
    const decl = /^\uFEFF?\s*(<\?xml[^>]*\?>)/.exec(markup);
    if (decl) out = decl[1] + '\n' + out;
  } else {
    out = doctypeString(doc) + doc.documentElement.outerHTML;
  }
  return { markup: out, stats };
}
