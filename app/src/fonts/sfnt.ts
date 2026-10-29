// 字体文件解析：纯 JS，没有任何依赖，也不用原生模块。只读“名字”和“有没有某个字”需要的几张表：
//   name（家族名、简体中文本地化名）、cmap（有没有“简”U+7B80、有没有 A）、OS/2 与 head（字重、斜体）。
// 支持 TTF / OTF（sfnt）、TTC / OTC（字体集合）、WOFF（zlib）、WOFF2（brotli，只读 name 等没有被变换的表）。
// 读取走“随机读”接口：系统字体目录里一个 TTC 有 20 多 MB，只需要读开头的表目录和 name/cmap 两张表。
// Electron 主进程（扫描系统字体、导入字体）和 web 版（导入字体）共用这份代码。

/** 随机读：node 用文件句柄，浏览器用 Blob.slice */
export interface ByteSource {
  size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}

/** WOFF 用 zlib，WOFF2 用 brotli。运行环境提供就能读，不提供就读不了这两种格式的表（只能退回文件名） */
export interface Decompressors {
  inflate?(data: Uint8Array): Promise<Uint8Array>;
  brotli?(data: Uint8Array): Promise<Uint8Array>;
}

export interface ParsedFace {
  /** 在字体集合里的序号；单个字体为 0 */
  index: number;
  /** 英文家族名（排版家族名 ID 16，没有就用 ID 1） */
  family: string;
  /** 简体中文本地化的家族名，没有为 null */
  zhName: string | null;
  weight: number;
  italic: boolean;
  /** 有“简”字 U+7B80 */
  hasCJK: boolean;
  /** 有拉丁字母 A 或 a（没有的多半是图标、符号字体） */
  hasLatin: boolean;
}

const u16 = (v: DataView, o: number): number => v.getUint16(o, false);
const u32 = (v: DataView, o: number): number => v.getUint32(o, false);
const tagAt = (b: Uint8Array, o: number): string => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const view = (b: Uint8Array): DataView => new DataView(b.buffer, b.byteOffset, b.byteLength);

/** 单个字体里某张表的取法 */
type TableGetter = (tag: string) => Promise<Uint8Array | null>;

const SFNT_TAGS = new Set(['\x00\x01\x00\x00', 'OTTO', 'true', 'typ1']);

/** 表目录很大的字体（上千张表）也不会超过这个值；超过的当作坏文件 */
const MAX_TABLES = 512;
/** 单张表的读取上限，防止坏文件让我们去读几百 MB */
const MAX_TABLE = 64 * 1024 * 1024;

// ---------------------------------------------------------------- name 表

interface NameRecord {
  platform: number;
  lang: number;
  id: number;
  value: string;
}

function decodeUtf16be(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i + 1 < b.length; i += 2) s += String.fromCharCode((b[i]! << 8) | b[i + 1]!);
  return s;
}

function decodeMacRoman(b: Uint8Array): string {
  // 名字里只会出现 ASCII；其余字节当作 Latin-1 近似，不影响判断
  let s = '';
  for (const c of b) s += String.fromCharCode(c);
  return s;
}

export function parseNameTable(t: Uint8Array): NameRecord[] {
  if (t.length < 6) return [];
  const v = view(t);
  const count = u16(v, 2);
  const strOff = u16(v, 4);
  const out: NameRecord[] = [];
  for (let i = 0; i < count; i++) {
    const r = 6 + i * 12;
    if (r + 12 > t.length) break;
    const platform = u16(v, r);
    const encoding = u16(v, r + 2);
    const lang = u16(v, r + 4);
    const id = u16(v, r + 6);
    const len = u16(v, r + 8);
    const off = strOff + u16(v, r + 10);
    if (off + len > t.length) continue;
    const raw = t.subarray(off, off + len);
    let value: string;
    if (platform === 3 || platform === 0) value = decodeUtf16be(raw);
    else if (platform === 1 && encoding === 0) value = decodeMacRoman(raw);
    else if (platform === 1 && encoding === 25) {
      // Mac 的简体中文名（GB2312；macOS 自带的字体可能只有 Mac 平台的中文名）。gb18030 是它的超集
      try {
        value = new TextDecoder('gb18030').decode(raw);
      } catch {
        continue;
      }
    } else continue; // 其他 Mac 编码：有 Windows 平台的名字就够了，不处理
    value = value.replace(/\0/g, '').trim();
    if (value) out.push({ platform, lang, id, value });
  }
  return out;
}

/** Windows 语言 ID：0x0804 简体中文（中国）、0x1004 简体中文（新加坡）；Mac 语言 ID 33 是简体中文 */
const isSimplifiedZh = (r: NameRecord): boolean => (r.platform === 3 && (r.lang === 0x0804 || r.lang === 0x1004)) || (r.platform === 1 && r.lang === 33);
const isEnglish = (r: NameRecord): boolean =>
  (r.platform === 3 && (r.lang & 0xff) === 0x09) || (r.platform === 1 && r.lang === 0);

/** 家族名：排版家族名（16）优先，所以 Regular、Bold、Light 等归到同一个家族 */
export function pickFamilyNames(records: NameRecord[]): { family: string; zhName: string | null } {
  const ids = records.some((r) => r.id === 16) ? [16, 1] : [1];
  for (const id of ids) {
    const rs = records.filter((r) => r.id === id);
    if (rs.length === 0) continue;
    const en = rs.find((r) => r.platform === 3 && r.lang === 0x0409) ?? rs.find(isEnglish);
    const zh = rs.find((r) => r.platform === 3 && isSimplifiedZh(r)) ?? rs.find(isSimplifiedZh);
    const family = (en ?? rs.find((r) => r.platform === 3) ?? rs[0]!).value;
    return { family, zhName: zh && zh.value !== family ? zh.value : null };
  }
  return { family: '', zhName: null };
}

// ---------------------------------------------------------------- cmap 表

/** 这张 cmap 里有没有这些码位（每个码位一个布尔） */
export function cmapHas(t: Uint8Array, codePoints: number[]): boolean[] {
  const found = codePoints.map(() => false);
  if (t.length < 4) return found;
  const v = view(t);
  const n = u16(v, 2);
  for (let i = 0; i < n; i++) {
    const rec = 4 + i * 8;
    if (rec + 8 > t.length) break;
    const platform = u16(v, rec);
    const encoding = u16(v, rec + 2);
    // Unicode 子表：Windows (3,1) (3,10)，Unicode 平台 (0,*)。符号字体 (3,0) 不算
    if (!(platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10)))) continue;
    const off = u32(v, rec + 4);
    if (off + 4 > t.length) continue;
    codePoints.forEach((cp, k) => {
      if (!found[k] && subtableHas(v, t.length, off, cp)) found[k] = true;
    });
  }
  return found;
}

function subtableHas(v: DataView, len: number, off: number, cp: number): boolean {
  const format = u16(v, off);
  if (format === 4) {
    if (cp > 0xffff || off + 14 > len) return false;
    const segX2 = u16(v, off + 6);
    const endO = off + 14;
    const startO = endO + segX2 + 2;
    const deltaO = startO + segX2;
    const rangeO = deltaO + segX2;
    if (rangeO + segX2 > len) return false;
    const seg = segX2 / 2;
    let lo = 0;
    let hi = seg - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const end = u16(v, endO + mid * 2);
      if (cp > end) lo = mid + 1;
      else if (cp < u16(v, startO + mid * 2)) hi = mid - 1;
      else {
        const rangeOffset = u16(v, rangeO + mid * 2);
        if (rangeOffset === 0) return ((cp + u16(v, deltaO + mid * 2)) & 0xffff) !== 0;
        const gO = rangeO + mid * 2 + rangeOffset + (cp - u16(v, startO + mid * 2)) * 2;
        if (gO + 2 > len) return false;
        return u16(v, gO) !== 0;
      }
    }
    return false;
  }
  if (format === 12 || format === 13) {
    if (off + 16 > len) return false;
    const groups = u32(v, off + 12);
    let lo = 0;
    let hi = groups - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const g = off + 16 + mid * 12;
      if (g + 12 > len) return false;
      if (cp > u32(v, g + 4)) lo = mid + 1;
      else if (cp < u32(v, g)) hi = mid - 1;
      else return true;
    }
    return false;
  }
  if (format === 6) {
    const first = u16(v, off + 6);
    const count = u16(v, off + 8);
    return cp >= first && cp < first + count && u16(v, off + 10 + (cp - first) * 2) !== 0;
  }
  if (format === 0) return cp < 256 && v.getUint8(off + 6 + cp) !== 0;
  return false;
}

// ---------------------------------------------------------------- 从各种容器里取表

async function readSfntTables(src: ByteSource, base: number): Promise<TableGetter | null> {
  if (base + 12 > src.size) return null;
  const head = await src.read(base, 12);
  if (!SFNT_TAGS.has(tagAt(head, 0))) return null;
  const n = u16(view(head), 4);
  if (n === 0 || n > MAX_TABLES) return null;
  const dir = await src.read(base + 12, n * 16);
  if (dir.length < n * 16) return null;
  const dv = view(dir);
  const tables = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < n; i++) tables.set(tagAt(dir, i * 16), { offset: u32(dv, i * 16 + 8), length: u32(dv, i * 16 + 12) });
  return async (tag) => {
    const t = tables.get(tag);
    if (!t || t.length > MAX_TABLE || t.offset + t.length > src.size) return null;
    return src.read(t.offset, t.length);
  };
}

async function readWoffTables(src: ByteSource, dec: Decompressors): Promise<TableGetter | null> {
  const head = await src.read(0, 44);
  if (head.length < 44) return null;
  const n = u16(view(head), 12);
  if (n === 0 || n > MAX_TABLES) return null;
  const dir = await src.read(44, n * 20);
  const dv = view(dir);
  const tables = new Map<string, { offset: number; comp: number; orig: number }>();
  for (let i = 0; i < n; i++) {
    tables.set(tagAt(dir, i * 20), { offset: u32(dv, i * 20 + 4), comp: u32(dv, i * 20 + 8), orig: u32(dv, i * 20 + 12) });
  }
  return async (tag) => {
    const t = tables.get(tag);
    if (!t || t.orig > MAX_TABLE || t.offset + t.comp > src.size) return null;
    const raw = await src.read(t.offset, t.comp);
    if (t.comp === t.orig) return raw;
    if (!dec.inflate) return null;
    return dec.inflate(raw);
  };
}

/** WOFF2 规范里已知表的编号（0–62），63 表示后面跟 4 字节自定义标签 */
const WOFF2_TAGS = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep', 'CFF ', 'VORG',
  'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern', 'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar', 'bdat', 'bloc', 'bsln', 'cvar', 'fdsc',
  'feat', 'fmtx', 'fvar', 'gvar', 'hsty', 'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

async function readWoff2Tables(src: ByteSource, dec: Decompressors): Promise<TableGetter | null> {
  if (!dec.brotli) return null;
  const head = await src.read(0, 48);
  if (head.length < 48) return null;
  const hv = view(head);
  if (tagAt(head, 4) === 'ttcf') return null; // WOFF2 字体集合：不支持
  const n = u16(hv, 12);
  const compressedSize = u32(hv, 20);
  if (n === 0 || n > MAX_TABLES) return null;
  // 表目录是变长的：每张表最多 1+4+5+5 字节
  const dir = await src.read(48, Math.min(src.size - 48, n * 15 + 16));
  let p = 0;
  const base128 = (): number => {
    let acc = 0;
    for (let i = 0; i < 5; i++) {
      const b = dir[p++];
      if (b === undefined) throw new Error('WOFF2 表目录被截断');
      acc = acc * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) return acc;
    }
    throw new Error('WOFF2 UIntBase128 格式错误');
  };
  const tables = new Map<string, { offset: number; length: number }>();
  let cursor = 0;
  for (let i = 0; i < n; i++) {
    const flags = dir[p++];
    if (flags === undefined) return null;
    const idx = flags & 0x3f;
    let tag: string;
    if (idx === 63) {
      tag = tagAt(dir, p);
      p += 4;
    } else tag = WOFF2_TAGS[idx]!;
    const transformVersion = flags >> 6;
    const orig = base128();
    // glyf、loca：版本 0 表示被变换过（有 transformLength），版本 3 表示没变换；其他表：版本 0 表示没变换
    const transformed = tag === 'glyf' || tag === 'loca' ? transformVersion === 0 : transformVersion !== 0;
    const length = transformed ? base128() : orig;
    tables.set(tag, { offset: cursor, length: transformed ? 0 : length });
    cursor += length;
  }
  let stream: Uint8Array | null = null;
  return async (tag) => {
    const t = tables.get(tag);
    if (!t || t.length === 0 || t.length > MAX_TABLE) return null;
    if (!stream) {
      const comp = await src.read(48 + p, compressedSize);
      stream = await dec.brotli!(comp);
    }
    return stream.subarray(t.offset, t.offset + t.length);
  };
}

// ---------------------------------------------------------------- 入口

async function describeFace(index: number, get: TableGetter): Promise<ParsedFace | null> {
  const nameT = await get('name');
  if (!nameT) return null;
  const { family, zhName } = pickFamilyNames(parseNameTable(nameT));
  if (!family) return null;
  let hasCJK = false;
  let hasLatin = false;
  const cmapT = await get('cmap');
  if (cmapT) {
    const [han, upperA, lowerA] = cmapHas(cmapT, [0x7b80, 0x41, 0x61]);
    hasCJK = han!;
    hasLatin = upperA! || lowerA!;
  }
  let weight = 400;
  let italic = false;
  const os2 = await get('OS/2');
  if (os2 && os2.length >= 64) {
    const v = view(os2);
    weight = u16(v, 4) || 400;
    italic = (u16(v, 62) & 1) !== 0;
  } else {
    const headT = await get('head');
    if (headT && headT.length >= 46) italic = (u16(view(headT), 44) & 2) !== 0;
  }
  return { index, family, zhName, weight, italic, hasCJK, hasLatin };
}

/** 读出文件里每个字体（TTC 可能有好几个）的名字和覆盖情况。不是字体、损坏的返回空数组 */
export async function readFaces(src: ByteSource, dec: Decompressors = {}): Promise<ParsedFace[]> {
  if (src.size < 12) return [];
  const magic = tagAt(await src.read(0, 4), 0);
  try {
    if (magic === 'ttcf') {
      const head = await src.read(0, 12);
      const count = u32(view(head), 8);
      if (count === 0 || count > 64) return [];
      const offs = await src.read(12, count * 4);
      const ov = view(offs);
      const faces: ParsedFace[] = [];
      for (let i = 0; i < count; i++) {
        const get = await readSfntTables(src, u32(ov, i * 4));
        const f = get ? await describeFace(i, get) : null;
        if (f) faces.push(f);
      }
      return faces;
    }
    let get: TableGetter | null = null;
    if (magic === 'wOFF') get = await readWoffTables(src, dec);
    else if (magic === 'wOF2') get = await readWoff2Tables(src, dec);
    else get = await readSfntTables(src, 0);
    const f = get ? await describeFace(0, get) : null;
    return f ? [f] : [];
  } catch {
    return [];
  }
}

/** 内存里的字节数组当作随机读来源（浏览器里 File 要先 arrayBuffer 也可以用这个；测试也用它） */
export function bytesSource(bytes: Uint8Array): ByteSource {
  return {
    size: bytes.length,
    read: async (offset, length) => bytes.subarray(Math.max(0, offset), Math.min(bytes.length, offset + length)),
  };
}

/** 浏览器 Blob / File 当作随机读来源 */
export function blobSource(blob: Blob): ByteSource {
  return {
    size: blob.size,
    read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer()),
  };
}

// ---------------------------------------------------------------- TTC 拆分

function checksum(b: Uint8Array): number {
  let sum = 0;
  const n = b.length & ~3;
  const v = view(b);
  for (let i = 0; i < n; i += 4) sum = (sum + v.getUint32(i, false)) >>> 0;
  if (b.length & 3) {
    let last = 0;
    for (let i = 0; i < 4; i++) last = (last << 8) | (n + i < b.length ? b[n + i]! : 0);
    sum = (sum + (last >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

/**
 * 从 TTC 里抽出第 index 个字体，组成一个独立的 TTF/OTF。
 * 浏览器的 @font-face 不认 TTC（OTS 会拒绝），导入时必须先拆开。表的内容原样复制，只重写表目录。
 */
export function extractTtcFace(bytes: Uint8Array, index: number): Uint8Array {
  const v = view(bytes);
  if (tagAt(bytes, 0) !== 'ttcf') throw new Error('不是字体集合');
  const count = u32(v, 8);
  if (index < 0 || index >= count) throw new Error('字体序号越界');
  const base = u32(v, 12 + index * 4);
  const n = u16(v, base + 4);
  const sfntVersion = bytes.subarray(base, base + 4);
  const entries: { tag: Uint8Array; data: Uint8Array }[] = [];
  for (let i = 0; i < n; i++) {
    const r = base + 12 + i * 16;
    const off = u32(v, r + 8);
    const len = u32(v, r + 12);
    if (off + len > bytes.length) throw new Error('字体表越界');
    entries.push({ tag: bytes.subarray(r, r + 4), data: bytes.subarray(off, off + len) });
  }
  entries.sort((a, b) => tagAt(a.tag, 0).localeCompare(tagAt(b.tag, 0)));
  let total = 12 + n * 16;
  const offsets = entries.map((e) => {
    const o = total;
    total += (e.data.length + 3) & ~3;
    return o;
  });
  const out = new Uint8Array(total);
  const ov = view(out);
  out.set(sfntVersion, 0);
  ov.setUint16(4, n, false);
  let pow = 1;
  let log = 0;
  while (pow * 2 <= n) {
    pow *= 2;
    log++;
  }
  ov.setUint16(6, pow * 16, false);
  ov.setUint16(8, log, false);
  ov.setUint16(10, n * 16 - pow * 16, false);
  entries.forEach((e, i) => {
    const r = 12 + i * 16;
    out.set(e.tag, r);
    ov.setUint32(r + 4, checksum(e.data), false);
    ov.setUint32(r + 8, offsets[i]!, false);
    ov.setUint32(r + 12, e.data.length, false);
    out.set(e.data, offsets[i]!);
  });
  return out;
}

/** 文件头判断容器类型，用来决定 @font-face 的 format() 与扩展名 */
export function sniffFormat(head: Uint8Array): 'ttf' | 'otf' | 'ttc' | 'woff' | 'woff2' | null {
  if (head.length < 4) return null;
  const t = tagAt(head, 0);
  if (t === 'ttcf') return 'ttc';
  if (t === 'wOFF') return 'woff';
  if (t === 'wOF2') return 'woff2';
  if (t === 'OTTO') return 'otf';
  if (t === '\x00\x01\x00\x00' || t === 'true') return 'ttf';
  return null;
}
