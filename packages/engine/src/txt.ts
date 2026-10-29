/* txt：字节 → 文本 → 章节 */

/** 两种文字共有的高频字（繁体、简体各列一份），用来在 GB18030 与 Big5 之间判别 */
const COMMON = new Set(
  [
    ...'的一是不了人我在有他这這为為之大来來以个個中上们們到说說国國和地也子时時道出而要于於就下得可你年生自会會那后後能对對着著事其里裡所去行过過家十用发發天如然作方成者多日都三小军軍二无無同么麼经經法当當起与與好看学學进進种種将將还還分此心前面又定见見只主没沒公从從',
    ...'手老明想问問间間话話长長相两兩点點现現知很动動开開意最本新然正理已所被她让讓给給什样樣情该該把些别別战戰高因门門外实實真吃回关關重内內但车車民女话它身口西力水先机機路美东東部气氣体體应應头頭儿兒',
  ],
);

const HAN = /[㐀-䶿一-鿿豈-﫿]/g;

function countNul(bytes: Uint8Array, parity: number): number {
  let n = 0;
  for (let i = parity; i < bytes.length; i += 2) if (bytes[i] === 0) n++;
  return n;
}

function decode(label: string, bytes: Uint8Array, fatal: boolean): string | null {
  try {
    return new TextDecoder(label, { fatal, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** 解码质量：常用字占汉字的比例，减去替换字符的惩罚 */
function score(text: string): number {
  const han = text.match(HAN);
  const bad = (text.match(/�/g) ?? []).length;
  if (!han) return -bad;
  let common = 0;
  for (const c of han) if (COMMON.has(c)) common++;
  return common / han.length - (bad * 3) / (han.length + bad);
}

/**
 * txt：字节 → 文本。
 * 顺序：BOM → 无 BOM 的 UTF-16（大量 NUL）→ 严格 UTF-8 校验 → GB18030 与 Big5 按错误率和用字统计判别。
 */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  const n = bytes.length;
  if (n >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode('utf-8', bytes.subarray(3), false)!, encoding: 'utf-8' };
  }
  if (n >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decode('utf-16le', bytes.subarray(2), false)!, encoding: 'utf-16le' };
  }
  if (n >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decode('utf-16be', bytes.subarray(2), false)!, encoding: 'utf-16be' };
  }

  // 无 BOM 的 UTF-16：ASCII 为主的文本里，一个字节位置上几乎全是 NUL
  if (n >= 4) {
    const pairs = Math.floor(n / 2);
    const even = countNul(bytes, 0) / pairs;
    const odd = countNul(bytes, 1) / pairs;
    if (odd > 0.3 && even < 0.05) return { text: decode('utf-16le', bytes, false)!, encoding: 'utf-16le' };
    if (even > 0.3 && odd < 0.05) return { text: decode('utf-16be', bytes, false)!, encoding: 'utf-16be' };
  }

  const utf8 = decode('utf-8', bytes, true);
  if (utf8 !== null) return { text: utf8, encoding: 'utf-8' };

  const gb = decode('gb18030', bytes, false) ?? '';
  const big5 = decode('big5', bytes, false) ?? '';
  const sg = score(gb);
  const sb = score(big5);
  // 平局偏向 GB18030（它对任意字节序列的容错更好，大陆来源的 txt 更常见）
  return sb > sg ? { text: big5, encoding: 'big5' } : { text: gb, encoding: 'gb18030' };
}

/* ---------------------------------------------------------------- 分章 */

const NUM = '[〇零一二三四五六七八九十百千万萬兩两0-9０-９]+';
const RE_DI = new RegExp(`^第\\s*${NUM}\\s*[章回節节卷集部篇幕折]`);
const RE_CHAPTER = /^(?:chapter|CHAPTER|Chapter)\s+(?:\d+|[IVXLCivxlc]+|[A-Za-z]+)\b/;
const RE_SPECIAL = /^(?:序章|序言|序幕|序曲|序|楔子|引子|前言|自序|代序|后记|後記|尾声|尾聲|终章|終章|番外|跋|附录|附錄|内容简介|內容簡介)(?=$|[\s：:、.．\-—·（(])/;
const SENTENCE_PUNCT = /[。！？!?；;]/;
const MAX_TITLE = 40;
const CHUNK = 20000;

function isTitleLine(line: string): boolean {
  const t = line.trim();
  if (t === '' || t.length > MAX_TITLE) return false;
  if (SENTENCE_PUNCT.test(t)) return false;
  if (RE_DI.test(t)) return true;
  if (RE_CHAPTER.test(t)) return true;
  if (RE_SPECIAL.test(t)) return true;
  return false;
}

/**
 * txt：文本 → 章节。
 * 识别“第X章/回/节/卷”、“Chapter N”、“序/楔子/后记”等标题行；找不到时每约 2 万字切一章。
 * 段落：按行切，去掉首尾空白（含全角空格），丢掉空行。
 */
export function splitChapters(text: string): { title: string; paragraphs: string[] }[] {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r\n|\r|\n/)
    .map((l) => l.replace(/^[\s\u3000]+|[\s\u3000]+$/g, ''));

  const chapters: { title: string; paragraphs: string[] }[] = [];
  let cur: { title: string; paragraphs: string[] } | null = null;
  let preface: string[] = [];
  let sawTitle = false;

  for (const line of lines) {
    if (line === '') continue;
    if (isTitleLine(line)) {
      sawTitle = true;
      if (cur) chapters.push(cur);
      cur = { title: line.replace(/\s+/g, ' '), paragraphs: [] };
    } else if (cur) {
      cur.paragraphs.push(line);
    } else {
      preface.push(line);
    }
  }
  if (cur) chapters.push(cur);

  if (!sawTitle) return chunkByLength(preface);

  // 第一个标题之前的文字（书名、作者、简介）单独成一章
  const out: { title: string; paragraphs: string[] }[] = [];
  if (preface.length > 0) out.push({ title: '前言', paragraphs: preface });
  // 只有标题没有正文的（目录页里一排“第X章”）丢掉
  for (const c of chapters) if (c.paragraphs.length > 0) out.push(c);
  if (out.length === 0) return chapters;
  return out;
}

function chunkByLength(paragraphs: string[]): { title: string; paragraphs: string[] }[] {
  const out: { title: string; paragraphs: string[] }[] = [];
  let buf: string[] = [];
  let len = 0;
  const push = (): void => {
    if (buf.length === 0) return;
    out.push({ title: `第${out.length + 1}部分`, paragraphs: buf });
    buf = [];
    len = 0;
  };
  for (const p of paragraphs) {
    buf.push(p);
    len += p.length;
    if (len >= CHUNK) push();
  }
  push();
  return out;
}
