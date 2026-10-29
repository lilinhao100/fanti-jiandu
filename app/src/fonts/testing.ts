// 测试用：在内存里拼出最小的字体文件（只有 name、cmap、OS/2、head 几张表，不能真的拿来排字，但解析器认得）。
// 只被测试 import，不会进入应用包。
import zlib from 'node:zlib';

const te = (s: string): number[] => Array.from(s).map((c) => c.charCodeAt(0));
const be16 = (n: number): number[] => [(n >> 8) & 0xff, n & 0xff];
const be32 = (n: number): number[] => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
const utf16be = (s: string): number[] => Array.from(s).flatMap((c) => be16(c.charCodeAt(0)));

export interface TestName {
  id: number;
  value: string;
  /** Windows 语言 ID，默认 0x0409（美式英语）；简体中文是 0x0804 */
  lang?: number;
  platform?: number;
  /** Mac 平台（platform 1）的编码，默认 0（Roman）；简体中文是 25 */
  encoding?: number;
  /** 直接给字节（Mac 的 GB2312 名字用），不给就按 value 编码 */
  bytes?: number[];
}

export function nameTable(names: TestName[]): Uint8Array {
  const recs: number[] = [];
  const strs: number[] = [];
  for (const n of names) {
    const platform = n.platform ?? 3;
    const data = n.bytes ?? (platform === 1 ? te(n.value) : utf16be(n.value));
    recs.push(...be16(platform), ...be16(platform === 1 ? (n.encoding ?? 0) : 1), ...be16(n.lang ?? (platform === 1 ? 0 : 0x0409)), ...be16(n.id), ...be16(data.length), ...be16(strs.length));
    strs.push(...data);
  }
  return new Uint8Array([...be16(0), ...be16(names.length), ...be16(6 + names.length * 12), ...recs, ...strs]);
}

/** cmap：一个 Windows Unicode 子表。codePoints 都在 BMP 内用 format 4，否则 format 12 */
export function cmapTable(codePoints: number[]): Uint8Array {
  const cps = [...new Set(codePoints)].sort((a, b) => a - b);
  let sub: number[];
  if (cps.every((c) => c <= 0xfffe)) {
    // 每个码位一段（start = end），idDelta 让字形号 = 1..n
    const segs = cps.map((c, i) => ({ start: c, end: c, delta: (i + 1 - c) & 0xffff }));
    segs.push({ start: 0xffff, end: 0xffff, delta: 1 });
    const n = segs.length;
    const len = 16 + n * 8;
    sub = [
      ...be16(4),
      ...be16(len),
      ...be16(0),
      ...be16(n * 2),
      ...be16(0),
      ...be16(0),
      ...be16(0),
      ...segs.flatMap((s) => be16(s.end)),
      ...be16(0),
      ...segs.flatMap((s) => be16(s.start)),
      ...segs.flatMap((s) => be16(s.delta)),
      ...segs.flatMap(() => be16(0)),
    ];
  } else {
    const groups = cps.map((c, i) => [...be32(c), ...be32(c), ...be32(i + 1)]).flat();
    sub = [...be16(12), ...be16(0), ...be32(16 + cps.length * 12), ...be32(0), ...be32(cps.length), ...groups];
  }
  const isBmp = sub[1] === 4;
  return new Uint8Array([...be16(0), ...be16(1), ...be16(3), ...be16(isBmp ? 1 : 10), ...be32(12), ...sub]);
}

export function os2Table(weight: number, italic = false): Uint8Array {
  const t = new Uint8Array(78);
  const v = new DataView(t.buffer);
  v.setUint16(4, weight, false);
  v.setUint16(62, italic ? 1 : 0, false);
  return t;
}

export interface TestFontSpec {
  /** name 表里的记录 */
  names: TestName[];
  /** cmap 里有哪些码位 */
  chars?: string;
  weight?: number;
  italic?: boolean;
}

export function specTables(spec: TestFontSpec): Record<string, Uint8Array> {
  return {
    name: nameTable(spec.names),
    cmap: cmapTable(Array.from(spec.chars ?? 'Aa').map((c) => c.codePointAt(0)!)),
    'OS/2': os2Table(spec.weight ?? 400, spec.italic),
    head: new Uint8Array(54),
  };
}

const pad4 = (n: number): number => (n + 3) & ~3;

/** 把表拼成 sfnt。tableOffsetBase：放在字体集合里时，偏移量是相对整个文件的 */
export function buildSfnt(tables: Record<string, Uint8Array>, base = 0, version = 0x00010000): Uint8Array {
  const tags = Object.keys(tables).sort();
  const dirLen = 12 + tags.length * 16;
  let off = base + dirLen;
  const dir: number[] = [...be32(version), ...be16(tags.length), ...be16(0), ...be16(0), ...be16(0)];
  const body: number[] = [];
  for (const tag of tags) {
    const t = tables[tag]!;
    dir.push(...te(tag.padEnd(4, ' ')), ...be32(0), ...be32(off), ...be32(t.length));
    body.push(...t, ...new Array(pad4(t.length) - t.length).fill(0));
    off += pad4(t.length);
  }
  return new Uint8Array([...dir, ...body]);
}

export function buildFont(spec: TestFontSpec): Uint8Array {
  return buildSfnt(specTables(spec));
}

/** 字体集合：每个字体各带自己的表（不共享） */
export function buildTtc(specs: TestFontSpec[]): Uint8Array {
  const headerLen = 12 + specs.length * 4;
  const fonts: Uint8Array[] = [];
  const offsets: number[] = [];
  let pos = headerLen;
  for (const s of specs) {
    offsets.push(pos);
    const f = buildSfnt(specTables(s), pos);
    fonts.push(f);
    pos += f.length;
  }
  return new Uint8Array([...te('ttcf'), ...be32(0x00010000), ...be32(specs.length), ...offsets.flatMap(be32), ...fonts.flatMap((f) => Array.from(f))]);
}

export function buildWoff(spec: TestFontSpec): Uint8Array {
  const tables = specTables(spec);
  const tags = Object.keys(tables).sort();
  const dirLen = 44 + tags.length * 20;
  let off = dirLen;
  const dir: number[] = [];
  const body: number[] = [];
  for (const tag of tags) {
    const t = tables[tag]!;
    const z = new Uint8Array(zlib.deflateSync(t));
    const comp = z.length < t.length ? z : t;
    dir.push(...te(tag.padEnd(4, ' ')), ...be32(off), ...be32(comp.length), ...be32(t.length), ...be32(0));
    body.push(...comp, ...new Array(pad4(comp.length) - comp.length).fill(0));
    off += pad4(comp.length);
  }
  const header = [...te('wOFF'), ...be32(0x00010000), ...be32(off), ...be16(tags.length), ...be16(0), ...be32(0), ...be16(1), ...be16(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0)];
  return new Uint8Array([...header, ...dir, ...body]);
}

const WOFF2_KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post'];

function base128(n: number): number[] {
  const out = [n & 0x7f];
  n = Math.floor(n / 128);
  while (n > 0) {
    out.unshift((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  return out;
}

/** WOFF2：不做 glyf 变换（测试字体里没有 glyf），所有表原样放进一个 brotli 流 */
export function buildWoff2(spec: TestFontSpec): Uint8Array {
  const tables = specTables(spec);
  const tags = Object.keys(tables).sort();
  const dir: number[] = [];
  const raw: number[] = [];
  for (const tag of tags) {
    const t = tables[tag]!;
    const idx = WOFF2_KNOWN.indexOf(tag);
    if (idx >= 0) dir.push(idx, ...base128(t.length));
    else dir.push(63, ...te(tag.padEnd(4, ' ')), ...base128(t.length));
    raw.push(...t);
  }
  const comp = new Uint8Array(zlib.brotliCompressSync(new Uint8Array(raw)));
  const total = 48 + dir.length + comp.length;
  const header = [...te('wOF2'), ...be32(0x00010000), ...be32(total), ...be16(tags.length), ...be16(0), ...be32(raw.length), ...be32(comp.length), ...be16(1), ...be16(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0), ...be32(0)];
  return new Uint8Array([...header.slice(0, 48), ...dir, ...comp]);
}
