// 流式 zip 读写，纯 JS（读用 yauzl，写自己实现，不依赖任何原生模块）。
// 目的：不在 NTFS 上解压 macOS 的 zip（NTFS 会弄坏符号链接和可执行权限），而是逐条目搬运：
//   - 读：从官方 zip 的中央目录取出每个条目的 unix 权限位（external attributes 的高 16 位）、压缩数据、CRC；
//   - 写：未改动的条目把“压缩后的原始字节”原样写进新 zip（不解压、不重新压缩），权限位原样保留；
//     符号链接条目是 mode 0o120777、内容为链接目标路径的普通条目，原样写入；
//   - 只有被替换或新增的条目才用我们自己给的内容。
// 写入器不用数据描述符（每个条目写入时大小和 CRC 都已知），不用 zip64（条目、体积都远小于 4GB，超了就报错）。
import fs from 'node:fs';
import { once } from 'node:events';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import yauzl from 'yauzl';

export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFLNK = 0o120000;

/** 一个条目（来自已有的 zip）的元数据，字段与中央目录一一对应 */
export interface ZipEntryInfo {
  /** UTF-8 解码后的条目名；目录以 / 结尾 */
  name: string;
  method: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  versionMadeBy: number;
  flags: number;
  internalAttrs: number;
  externalAttrs: number;
  dosTime: number;
  dosDate: number;
}

export const modeOf = (e: Pick<ZipEntryInfo, 'externalAttrs'>): number => (e.externalAttrs >>> 16) & 0xffff;
export const isDirectory = (e: ZipEntryInfo): boolean => e.name.endsWith('/');
/** 只有 Unix 创建的条目（versionMadeBy 的高字节为 3），外部属性高 16 位才是 st_mode */
export const isUnix = (e: Pick<ZipEntryInfo, 'versionMadeBy'>): boolean => e.versionMadeBy >> 8 === 3;
export const isSymlink = (e: ZipEntryInfo): boolean => isUnix(e) && (modeOf(e) & S_IFMT) === S_IFLNK;
export const isExecutable = (e: ZipEntryInfo): boolean => isUnix(e) && (modeOf(e) & S_IFMT) === S_IFREG && (modeOf(e) & 0o111) !== 0;

// ------------------------------------------------------------------ 读

export class ZipSource {
  // 注意：脚本由 node 直接剥掉类型运行，不能用构造函数参数属性（非“可擦除”语法）
  readonly path: string;
  readonly entries: ZipEntryInfo[];
  private readonly zf: yauzl.ZipFile;
  private readonly raw: yauzl.Entry[];

  private constructor(path: string, zf: yauzl.ZipFile, raw: yauzl.Entry[], entries: ZipEntryInfo[]) {
    this.path = path;
    this.zf = zf;
    this.raw = raw;
    this.entries = entries;
  }

  static async open(path: string): Promise<ZipSource> {
    const zf = await new Promise<yauzl.ZipFile>((resolve, reject) => {
      yauzl.open(path, { lazyEntries: true, autoClose: false, decodeStrings: true, validateEntrySizes: true, strictFileNames: false }, (err, z) =>
        err ? reject(err) : resolve(z),
      );
    });
    const raw: yauzl.Entry[] = [];
    await new Promise<void>((resolve, reject) => {
      zf.on('entry', (e: yauzl.Entry) => {
        raw.push(e);
        zf.readEntry();
      });
      zf.on('end', () => resolve());
      zf.on('error', reject);
      zf.readEntry();
    });
    const entries = raw.map(
      (e): ZipEntryInfo => ({
        name: e.fileName,
        method: e.compressionMethod,
        crc32: e.crc32,
        compressedSize: e.compressedSize,
        uncompressedSize: e.uncompressedSize,
        versionMadeBy: e.versionMadeBy,
        flags: e.generalPurposeBitFlag,
        internalAttrs: e.internalFileAttributes,
        externalAttrs: e.externalFileAttributes,
        dosTime: e.lastModFileTime,
        dosDate: e.lastModFileDate,
      }),
    );
    return new ZipSource(path, zf, raw, entries);
  }

  private rawOf(info: ZipEntryInfo): yauzl.Entry {
    const i = this.entries.indexOf(info);
    if (i < 0) throw new Error(`条目不属于这个 zip：${info.name}`);
    return this.raw[i]!;
  }

  /** 压缩后的原始字节（不解压） */
  openRaw(info: ZipEntryInfo): Promise<Readable> {
    return this.zf.openReadStreamPromise(this.rawOf(info), { decodeFileData: false } as yauzl.ZipFileOptions);
  }

  /** 解压后的内容流 */
  openDecoded(info: ZipEntryInfo): Promise<Readable> {
    return this.zf.openReadStreamPromise(this.rawOf(info));
  }

  async readBuffer(info: ZipEntryInfo): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const c of await this.openDecoded(info)) chunks.push(c as Buffer);
    return Buffer.concat(chunks);
  }

  close(): void {
    this.zf.close();
  }
}

// ------------------------------------------------------------------ 写

/** MS-DOS 时间（本地时间，2 秒精度，最早 1980 年） */
export function toDos(d: Date): { dosTime: number; dosDate: number } {
  const year = Math.max(1980, d.getFullYear());
  return {
    dosTime: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    dosDate: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

const hasNonAscii = (s: string): boolean => /[^\x00-\x7f]/.test(s);

interface Written {
  name: Buffer;
  flags: number;
  method: number;
  dosTime: number;
  dosDate: number;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  versionMadeBy: number;
  internalAttrs: number;
  externalAttrs: number;
  offset: number;
}

/** unix 创建、版本 3.0（符号链接、权限位的标准写法） */
const UNIX_MADE_BY = (3 << 8) | 30;

export class ZipWriter {
  readonly path: string;
  private readonly out: fs.WriteStream;
  private offset = 0;
  private readonly written: Written[] = [];
  private readonly names = new Set<string>();

  constructor(path: string) {
    this.path = path;
    this.out = fs.createWriteStream(path);
  }

  private async write(buf: Buffer): Promise<void> {
    this.offset += buf.length;
    if (!this.out.write(buf)) await once(this.out, 'drain');
  }

  private claim(name: string): Buffer {
    if (this.names.has(name)) throw new Error(`zip 里条目重名：${name}`);
    this.names.add(name);
    return Buffer.from(name, 'utf8');
  }

  private async header(w: Written): Promise<void> {
    if (w.offset > 0xfffffffe || w.compressedSize > 0xfffffffe || w.uncompressedSize > 0xfffffffe) throw new Error('zip 超过 4GB，需要 zip64，本脚本不支持');
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(w.flags, 6);
    h.writeUInt16LE(w.method, 8);
    h.writeUInt16LE(w.dosTime, 10);
    h.writeUInt16LE(w.dosDate, 12);
    h.writeUInt32LE(w.crc32 >>> 0, 14);
    h.writeUInt32LE(w.compressedSize, 18);
    h.writeUInt32LE(w.uncompressedSize, 22);
    h.writeUInt16LE(w.name.length, 26);
    h.writeUInt16LE(0, 28);
    await this.write(h);
    await this.write(w.name);
  }

  /**
   * 把已有条目原样搬过来：压缩后的原始字节、CRC、权限位、时间都不变。
   * newName 不给就沿用原名；给了就只改名字（比如 Electron.app/ → 繁体简读.app/）。
   */
  async copyRaw(src: ZipSource, info: ZipEntryInfo, newName: string = info.name): Promise<void> {
    if (info.method !== 0 && info.method !== 8) throw new Error(`不支持的压缩方式 ${info.method}：${info.name}`);
    const name = this.claim(newName);
    const w: Written = {
      name,
      // 原条目名是纯 ASCII（flags 无 UTF-8 位）；改名后含中文的条目要置位 UTF-8（第 11 位）
      flags: (info.flags & ~0x0008 & ~0x0800) | (hasNonAscii(newName) ? 0x0800 : 0),
      method: info.method,
      dosTime: info.dosTime,
      dosDate: info.dosDate,
      crc32: info.crc32,
      compressedSize: info.compressedSize,
      uncompressedSize: info.uncompressedSize,
      versionMadeBy: info.versionMadeBy,
      internalAttrs: info.internalAttrs,
      externalAttrs: info.externalAttrs,
      offset: this.offset,
    };
    await this.header(w);
    if (info.compressedSize > 0) {
      const rs = await src.openRaw(info);
      let n = 0;
      for await (const chunk of rs) {
        n += (chunk as Buffer).length;
        await this.write(chunk as Buffer);
      }
      if (n !== info.compressedSize) throw new Error(`读取 ${info.name} 的字节数不对：${n} ≠ ${info.compressedSize}`);
    }
    this.written.push(w);
  }

  /** 新增一个有内容的条目（普通文件或符号链接）。mode 是完整的 st_mode，如 0o100644、0o120777 */
  async addBuffer(name: string, data: Buffer, opts: { mode: number; compress?: boolean; mtime?: Date }): Promise<void> {
    const nameBuf = this.claim(name);
    const compress = (opts.compress ?? true) && data.length > 0;
    const body = compress ? zlib.deflateRawSync(data, { level: 9 }) : data;
    const { dosTime, dosDate } = toDos(opts.mtime ?? new Date());
    const w: Written = {
      name: nameBuf,
      flags: hasNonAscii(name) ? 0x0800 : 0,
      method: compress ? 8 : 0,
      dosTime,
      dosDate,
      crc32: zlib.crc32(data),
      compressedSize: body.length,
      uncompressedSize: data.length,
      versionMadeBy: UNIX_MADE_BY,
      internalAttrs: 0,
      externalAttrs: ((opts.mode << 16) | 0) >>> 0,
      offset: this.offset,
    };
    await this.header(w);
    await this.write(body);
    this.written.push(w);
  }

  /** 收尾：写中央目录和结束记录，关闭文件 */
  async finish(): Promise<void> {
    const cdStart = this.offset;
    for (const w of this.written) {
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(w.versionMadeBy, 4);
      c.writeUInt16LE(20, 6);
      c.writeUInt16LE(w.flags, 8);
      c.writeUInt16LE(w.method, 10);
      c.writeUInt16LE(w.dosTime, 12);
      c.writeUInt16LE(w.dosDate, 14);
      c.writeUInt32LE(w.crc32 >>> 0, 16);
      c.writeUInt32LE(w.compressedSize, 20);
      c.writeUInt32LE(w.uncompressedSize, 24);
      c.writeUInt16LE(w.name.length, 28);
      c.writeUInt16LE(0, 30); // extra
      c.writeUInt16LE(0, 32); // comment
      c.writeUInt16LE(0, 34); // disk
      c.writeUInt16LE(w.internalAttrs, 36);
      c.writeUInt32LE(w.externalAttrs >>> 0, 38);
      c.writeUInt32LE(w.offset, 42);
      await this.write(c);
      await this.write(w.name);
    }
    const cdSize = this.offset - cdStart;
    if (this.written.length > 0xfffe || cdStart > 0xfffffffe) throw new Error('zip 条目过多或体积过大，需要 zip64');
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(0, 4);
    e.writeUInt16LE(0, 6);
    e.writeUInt16LE(this.written.length, 8);
    e.writeUInt16LE(this.written.length, 10);
    e.writeUInt32LE(cdSize, 12);
    e.writeUInt32LE(cdStart, 16);
    e.writeUInt16LE(0, 20);
    await this.write(e);
    this.out.end();
    await once(this.out, 'finish');
  }
}
