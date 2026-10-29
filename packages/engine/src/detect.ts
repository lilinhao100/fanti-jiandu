import { Converter as T2CN } from 'opencc-js/t2cn';
import { Converter as CN2T } from 'opencc-js/cn2t';
import type { ScriptInfo, Variant } from './types';

type Fn = (s: string) => string;

/* ---------------------------------------------------------------- 字表 */

/** 同时出现在繁、简两种文字里的常见字，被字表误判时用它们排除 */
const AMBIGUOUS = new Set([...'台里后干著松']);

interface HanTables {
  /** 只属于繁体：t→cn 会改动、cn→t 不会改动 */
  hant: Set<string>;
  /** 只属于简体：cn→t 会改动、t→cn 不会改动 */
  hans: Set<string>;
}

let tables: HanTables | null = null;

function mapEachChar(conv: Fn, chars: string[]): string[] {
  // 用换行隔开，避免 opencc 按词组把相邻的字连起来转换；每个字单独转换
  const out = conv(chars.join('\n')).split('\n');
  if (out.length !== chars.length) {
    return chars.map((c) => conv(c));
  }
  return out;
}

function buildTables(): HanTables {
  const chars: string[] = [];
  for (const [a, b] of [
    [0x3400, 0x4dbf],
    [0x4e00, 0x9fff],
    [0xf900, 0xfaff],
  ] as const) {
    for (let cp = a; cp <= b; cp++) chars.push(String.fromCharCode(cp));
  }
  const t2cn = mapEachChar(T2CN({ from: 't', to: 'cn' }) as Fn, chars);
  const cn2t = mapEachChar(CN2T({ from: 'cn', to: 't' }) as Fn, chars);
  const hant = new Set<string>();
  const hans = new Set<string>();
  chars.forEach((c, i) => {
    if (AMBIGUOUS.has(c)) return;
    const tChanged = t2cn[i] !== c;
    const sChanged = cn2t[i] !== c;
    if (tChanged && !sChanged) hant.add(c);
    else if (sChanged && !tChanged) hans.add(c);
  });
  return { hant, hans };
}

export function getHanTables(): HanTables {
  return (tables ??= buildTables());
}

/* ---------------------------------------------------------------- detectScript */

const HAN = /[㐀-䶿一-鿿豈-﫿]|[\uD840-\uD87F][\uDC00-\uDFFF]/;

function variantFromHint(langHint?: string): Variant {
  const h = (langHint ?? '').trim().toLowerCase().replace(/_/g, '-');
  if (h === 'zh-hk' || h === 'zh-mo' || h === 'zh-hant-hk' || h === 'zh-hant-mo') return 'hk';
  return 'tw'; // zh-TW、zh-Hant、空以及其他：默认台湾
}

/**
 * 判断一段文字是繁体、简体、混合还是没有汉字。
 * 统计样本里“只属于繁体”和“只属于简体”的字，繁体比例 ≥ 0.6 判 hant，≤ 0.2 判 hans，中间 mixed。
 */
export function detectScript(sample: string, langHint?: string): ScriptInfo {
  const variant = variantFromHint(langHint);
  let han = 0;
  let t = 0;
  let s = 0;
  const { hant, hans } = getHanTables();
  for (const ch of sample) {
    if (!HAN.test(ch)) continue;
    han++;
    if (hant.has(ch)) t++;
    else if (hans.has(ch)) s++;
  }
  if (han === 0) return { script: 'none', confidence: 0, variant };

  const n = t + s;
  if (n === 0) {
    // 有汉字，但全是两种文字共用的字，无法判断：按语言标记猜，置信度很低
    const h = (langHint ?? '').toLowerCase();
    const script = /hant|-tw|-hk|-mo/.test(h) ? 'hant' : 'hans';
    return { script, confidence: 0.1, variant };
  }
  const ratio = t / n;
  const enough = Math.min(1, n / 10); // 证据太少时压低置信度
  if (ratio >= 0.6) return { script: 'hant', confidence: round(ratio * enough), variant };
  if (ratio <= 0.2) return { script: 'hans', confidence: round((1 - ratio) * enough), variant };
  return { script: 'mixed', confidence: round((1 - Math.abs(ratio - 0.4) * 2) * enough), variant };
}

function round(x: number): number {
  return Math.round(Math.max(0, Math.min(1, x)) * 1000) / 1000;
}

/* ---------------------------------------------------------------- detectPdfReflow */

const C = '[\u3000-\u303F\uFF00-\uFFEF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u2018\u2019\u201C\u201D\u2026\u2014\u00B7]';
const C_SPACE_C = new RegExp(`${C}[ \\u00A0]+(?=${C})`, 'g');
const HAS_HAN = /[㐀-䶿一-鿿]/;
const BLOCK_RE = /<(p|li|td|dd|dt|h[1-6]|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
const PDF_TOOL_RE = /pdf\s*reflow|pdftohtml|abbyy/i;

function headOf(x: string): string {
  const m = /<head\b[\s\S]*?<\/head\s*>/i.exec(x);
  return m ? m[0] : x.slice(0, 4000);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;|&#160;|&#xa0;/gi, '\u00A0')
    .replace(/&#(\d+);/g, (_m, d: string) => safeCodePoint(parseInt(d, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => safeCodePoint(parseInt(h, 16)));
}

function safeCodePoint(cp: number): string {
  try {
    return String.fromCodePoint(cp);
  } catch {
    return '';
  }
}

/**
 * 判断是不是 PDF 转制的书。传入前若干章的原始 xhtml 文本。
 * 满足任一条：① head 里有 PDF Reflow / pdftohtml / ABBYY 的生成器标记；
 * ② 含汉字的段落里，出现“汉字 空格 汉字”的段落占比 ≥ 15%，且总共 ≥ 30 处。
 */
export function detectPdfReflow(sectionsXhtml: string[]): boolean {
  let paragraphs = 0;
  let hit = 0;
  let occurrences = 0;
  for (const x of sectionsXhtml) {
    const head = headOf(x);
    for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = m[0];
      if (/name\s*=\s*["']generator["']/i.test(tag) && PDF_TOOL_RE.test(tag)) return true;
    }
    if (/pdftohtml|abbyy/i.test(head)) return true;

    for (const m of x.matchAll(BLOCK_RE)) {
      const text = decodeEntities((m[2] ?? '').replace(/<[^>]*>/g, ''));
      if (!HAS_HAN.test(text)) continue;
      paragraphs++;
      const found = text.match(C_SPACE_C);
      if (found) {
        hit++;
        occurrences += found.length;
      }
    }
  }
  return paragraphs > 0 && hit / paragraphs >= 0.15 && occurrences >= 30;
}
