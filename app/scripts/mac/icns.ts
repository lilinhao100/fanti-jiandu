// icns 图标，纯 JS 写入：文件头 'icns' + 总长度（大端），后面是一个个块（4 字节类型 + 4 字节含头的长度 + 数据）。
// 这里的块都是 PNG（macOS 10.7 起支持）：类型 ic07..ic14，和 docs/icon/final/icon-*.png 一一对应。
import fs from 'node:fs';
import path from 'node:path';

/** 类型 → 像素边长。ic11–ic14 是 @2x（retina）版本，数据和同尺寸的普通版本一样 */
export const ICNS_TYPES: { type: string; px: number }[] = [
  { type: 'ic07', px: 128 },
  { type: 'ic08', px: 256 },
  { type: 'ic09', px: 512 },
  { type: 'ic10', px: 1024 },
  { type: 'ic11', px: 32 },
  { type: 'ic12', px: 64 },
  { type: 'ic13', px: 256 },
  { type: 'ic14', px: 512 },
];

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 读 PNG 的宽高（IHDR）。不是 PNG 就返回 null */
export function pngSize(png: Buffer): { width: number; height: number } | null {
  if (png.length < 24 || !png.subarray(0, 8).equals(PNG_SIGNATURE) || png.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** 组装 icns。pngBySize：边长 → PNG 内容。缺哪个尺寸就报错 */
export function buildIcns(pngBySize: Map<number, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const { type, px } of ICNS_TYPES) {
    const png = pngBySize.get(px);
    if (!png) throw new Error(`缺少 ${px}×${px} 的 PNG（${type}）`);
    const size = pngSize(png);
    if (!size || size.width !== px || size.height !== px) throw new Error(`${type} 需要 ${px}×${px} 的 PNG，实际是 ${size ? `${size.width}×${size.height}` : '不是 PNG'}`);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'latin1');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'latin1');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** 从 docs/icon/final/icon-<px>.png 读出所需尺寸，组装 icns */
export function buildIcnsFromDir(dir: string): Buffer {
  const map = new Map<number, Buffer>();
  for (const px of new Set(ICNS_TYPES.map((t) => t.px))) {
    const file = path.join(dir, `icon-${px}.png`);
    if (!fs.existsSync(file)) throw new Error(`没有图标文件 ${file}`);
    map.set(px, fs.readFileSync(file));
  }
  return buildIcns(map);
}

export interface IcnsInfo {
  chunks: { type: string; length: number; width: number; height: number }[];
}

/** 解析并校验 icns 结构：头、总长度、每个块的长度链条恰好走到文件末尾、块里是尺寸正确的 PNG。不合法就抛错 */
export function parseIcns(buf: Buffer): IcnsInfo {
  if (buf.length < 8 || buf.toString('latin1', 0, 4) !== 'icns') throw new Error('icns：文件头不是 icns');
  if (buf.readUInt32BE(4) !== buf.length) throw new Error(`icns：头里的总长度 ${buf.readUInt32BE(4)} ≠ 文件大小 ${buf.length}`);
  const chunks: IcnsInfo['chunks'] = [];
  let o = 8;
  while (o < buf.length) {
    if (o + 8 > buf.length) throw new Error('icns：块头被截断');
    const type = buf.toString('latin1', o, o + 4);
    const length = buf.readUInt32BE(o + 4);
    if (length < 8 || o + length > buf.length) throw new Error(`icns：块 ${type} 长度 ${length} 越界`);
    const data = buf.subarray(o + 8, o + length);
    const known = ICNS_TYPES.find((t) => t.type === type);
    const size = pngSize(data);
    if (!size) throw new Error(`icns：块 ${type} 不是 PNG`);
    if (known && (size.width !== known.px || size.height !== known.px)) throw new Error(`icns：块 ${type} 应为 ${known.px}px，实际 ${size.width}×${size.height}`);
    chunks.push({ type, length, width: size.width, height: size.height });
    o += length;
  }
  for (const t of ICNS_TYPES) if (!chunks.some((c) => c.type === t.type)) throw new Error(`icns：缺少块 ${t.type}`);
  return { chunks };
}
