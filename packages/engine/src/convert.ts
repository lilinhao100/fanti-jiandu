import { Converter } from 'opencc-js/t2cn';
import { mapQuotes, mapVerticalPunct } from './punct';
import type { ConvertOptions, Variant } from './types';

type Fn = (s: string) => string;

const cache = new Map<string, Fn>();

/**
 * 取转换器，按 (variant, vocabulary) 缓存。
 *  - tw + 词汇：twp → cn；tw 不带词汇：tw → cn
 *  - hk：hk → cn；t：t → cn（hk、t 没有词汇层）
 */
export function getConverter(variant: Variant, vocabulary: boolean): Fn {
  const from = variant === 'tw' ? (vocabulary ? 'twp' : 'tw') : variant;
  let fn = cache.get(from);
  if (!fn) {
    fn = Converter({ from, to: 'cn' }) as Fn;
    if (from === 'twp') fn = withVocabularyExceptions(fn, getConverter('tw', false));
    cache.set(from, fn);
  }
  return fn;
}

/**
 * 词汇层例外（偏离设计，见报告）。OpenCC 的 twp 词典偏重计算机术语，用在一般文章上会误伤：
 *   行程（旅行安排）→ 进程　　程序（法律程序）→ 进程　　文件 → 文档
 *   核心（核心团队）→ 内核　　執行（执行力）→ 运行
 *   資料 → 数据（“資料庫/資料夾”仍按词汇转）　社群 → 社区　物件 → 对象（“物件導向”仍按词汇转）
 * 这些词只做字形转换，不做词汇替换。条目是正则片段，可带否定前瞻。
 */
export const VOCABULARY_EXCEPTIONS: readonly string[] = [
  '行程', '程序', '文件', '核心', '執行',
  '資料(?![庫夾])', '社群', '物件(?!導向)',
];
const EXCEPTION_RE = new RegExp(VOCABULARY_EXCEPTIONS.join('|'), 'g');

function withVocabularyExceptions(vocab: Fn, charOnly: Fn): Fn {
  return (s) => {
    let out = '';
    let last = 0;
    for (const m of s.matchAll(EXCEPTION_RE)) {
      out += vocab(s.slice(last, m.index)) + charOnly(m[0]);
      last = m.index + m[0].length;
    }
    return last === 0 ? vocab(s) : out + vocab(s.slice(last));
  };
}

/** 仅字形层：不带任何词汇，用于检测和追踪 */
export function getCharConverter(): Fn {
  return getConverter('t', false);
}

/** 字符串里是否可能有需要处理的字（粗筛，避免对纯 ASCII 调用 opencc） */
const MAYBE_CJK = new RegExp('[\\u2E80-\\u9FFF\\uA000-\\uFAFF\\uFE10-\\uFE4F\\uFF00-\\uFFEF]|[\\uD840-\\uD87F][\\uDC00-\\uDFFF]');

/**
 * 一段文字的完整转换流水线：opencc → 引号 → 竖排标点。
 * 每一步都不改变长度之外的东西；opencc 一步在个别生僻字（辅助平面字变成基本平面字）上可能改变长度，
 * 调用方必须检查长度。
 */
export function convertString(s: string, opts: ConvertOptions): string {
  if (s === '' || !MAYBE_CJK.test(s)) return s;
  let out = s;
  if (opts.convert) {
    out = getConverter(opts.variant, opts.vocabulary)(out);
    if (opts.quotes) out = mapQuotes(out);
  }
  if (opts.horizontal) {
    out = mapVerticalPunct(out);
    // 竖排引号被还原成「」『』之后，如果引号转换开着，要继续处理
    if (opts.convert && opts.quotes) out = mapQuotes(out);
  }
  return out;
}

/** 纯文本转换（书名、作者、目录、搜索词） */
export function convertText(s: string, opts: ConvertOptions): string {
  return convertString(s, opts);
}
