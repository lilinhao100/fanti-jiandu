// 各格式元数据的形状不一样（docs/notes/foliate-hooks.md 第 8 节），统一取成字符串。

/** language map：string，或 { [lang]: string }（epub.js:263 的 makeLanguageMap） */
export function pickLanguageMap(x: unknown): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  if (Array.isArray(x)) return pickLanguageMap(x[0]);
  if (typeof x === 'object') {
    const keys = Object.keys(x as Record<string, unknown>);
    return keys.length ? pickLanguageMap((x as Record<string, unknown>)[keys[0]!]) : '';
  }
  return String(x);
}

export function pickTitle(title: unknown): string {
  return pickLanguageMap(title).trim();
}

/** author：字符串、{ name, sortAs }，或它们的数组 */
export function pickAuthors(author: unknown): string[] {
  if (author == null) return [];
  const list = Array.isArray(author) ? author : [author];
  const out: string[] = [];
  for (const a of list) {
    const name = typeof a === 'string' ? a : pickLanguageMap((a as { name?: unknown } | null)?.name);
    const t = name.trim();
    if (t) out.push(t);
  }
  return out;
}

export function pickLanguage(language: unknown): string {
  if (Array.isArray(language)) return pickLanguage(language[0]);
  return typeof language === 'string' ? language.trim() : '';
}

/**
 * 电子书商店转出来的书名常带“版本说明”后缀，显示时去掉（原始元数据不改）：
 * (Traditional Chinese Edition)、(Traditional_chinese Edition)、（繁體中文版）、(繁體版)……
 * 不区分大小写和全角半角；只去掉结尾的括号段，书名中间的括号不动。
 */
const EDITION_TAG =
  /\s*[(\[【]\s*(?:(?:(?:traditional|simplified)[\s_-]*)?(?:chinese[\s_-]*)?edition|(?:繁[體体]|簡[體体]|简[體体]|正[體体])(?:中文)?版)\s*[)\]】]\s*$/i;

export function cleanTitle(title: string): string {
  // 先按 NFKC 规整成半角再匹配（全角括号、全角字母），再按位置映射回原字符串去掉后缀
  let norm = '';
  const origIndex: number[] = [];
  let i = 0;
  for (const ch of title) {
    const n = ch.normalize('NFKC');
    for (let k = 0; k < n.length; k++) origIndex.push(i);
    norm += n;
    i += ch.length;
  }
  const m = EDITION_TAG.exec(norm);
  if (!m) return title;
  const cut = origIndex[m.index] ?? title.length;
  const out = title.slice(0, cut).trim();
  return out || title;
}
