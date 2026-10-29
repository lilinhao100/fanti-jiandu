/**
 * 标点映射。所有映射都是一对一、单个 UTF-16 码元对单个码元（长度不变），
 * 这样按块拼接转换后，才能按原来的偏移量拆回各个文本节点。
 */

/** 直角引号 → 弯引号（quotes 开关） */
export const QUOTE_MAP: Readonly<Record<string, string>> = {
  '「': '“',
  '」': '”',
  '『': '‘',
  '』': '’',
};

/**
 * 竖排专用标点（U+FE10–FE19、U+FE30–FE4F 中有对应物的）→ 普通标点（horizontal 开关）。
 * 竖排引号 ﹁﹂﹃﹄ 先还原成「」『』，再由 quotes 开关决定是否继续变成“”‘’；
 * 默认选项下最终结果与设计里写的 ﹁﹂→“” 相同。
 */
export const VERTICAL_PUNCT_MAP: Readonly<Record<string, string>> = {
  // U+FE10–FE19 竖排用逗号句号等
  '\uFE10': '，',
  '\uFE11': '、',
  '\uFE12': '。',
  '\uFE13': '：',
  '\uFE14': '；',
  '\uFE15': '！',
  '\uFE16': '？',
  '\uFE17': '〖',
  '\uFE18': '〗',
  '\uFE19': '…',
  // U+FE30–FE4F CJK 兼容形式（竖排）
  '\uFE30': '：', // ︰
  '\uFE31': '—', // ︱
  '\uFE32': '–', // ︲
  '\uFE33': '_', // ︳
  '\uFE34': '_', // ︴
  '\uFE35': '（', // ︵
  '\uFE36': '）', // ︶
  '\uFE37': '｛', // ︷
  '\uFE38': '｝', // ︸
  '\uFE39': '〔', // ︹
  '\uFE3A': '〕', // ︺
  '\uFE3B': '【', // ︻
  '\uFE3C': '】', // ︼
  '\uFE3D': '《', // ︽
  '\uFE3E': '》', // ︾
  '\uFE3F': '〈', // ︿
  '\uFE40': '〉', // ﹀
  '\uFE41': '「', // ﹁
  '\uFE42': '」', // ﹂
  '\uFE43': '『', // ﹃
  '\uFE44': '』', // ﹄
  '\uFE47': '［', // ﹇
  '\uFE48': '］', // ﹈
};

const QUOTE_RE = /[\u300C\u300D\u300E\u300F]/g;
const VERTICAL_RE = /[\uFE10-\uFE19\uFE30-\uFE48]/g;

export function mapQuotes(s: string): string {
  return s.replace(QUOTE_RE, (c) => QUOTE_MAP[c] ?? c);
}

export function mapVerticalPunct(s: string): string {
  return s.replace(VERTICAL_RE, (c) => VERTICAL_PUNCT_MAP[c] ?? c);
}
