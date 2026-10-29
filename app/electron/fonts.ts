// 字体服务（主进程，M2d）：
//   - 扫描系统字体：Windows 是 C:\Windows\Fonts 和 %LOCALAPPDATA%\Microsoft\Windows\Fonts；
//     macOS（M4）是 /System/Library/Fonts（含 Supplemental）、/Library/Fonts、~/Library/Fonts，以及 /System/Library/AssetsV2 下已下载的字体资源。
//     用纯 JS 的 sfnt 解析器（src/fonts/sfnt.ts）
//     只读每个文件的 name、cmap 表，按家族去重，显示名优先简体中文的本地化名。结果缓存到 font-cache.json，
//     字体文件夹的修改时间或文件数变了才重新扫描。
//   - 导入字体：.ttf .otf .ttc .woff .woff2 复制进 fonts/（TTC 先拆成单个字体，浏览器的 @font-face 不认 TTC），
//     登记在 fonts.json。
//   - 生成导入字体的 @font-face 规则，url 用 fjd://data/fonts/<文件>。
// 不使用任何原生模块；woff/woff2 的解压用 node 自带的 zlib。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fontFaceRule, type FontFileFormat } from '../src/fonts/css';
import { IMPORT_EXTS, prepareFontFile } from '../src/fonts/importer';
import { readFaces, type ByteSource, type Decompressors, type ParsedFace } from '../src/fonts/sfnt';
import type { FontInfo } from '../src/model';

const inflate = promisify(zlib.inflate);
const brotli = promisify(zlib.brotliDecompress);

export const nodeDecompressors: Decompressors = {
  inflate: async (d) => new Uint8Array(await inflate(d)),
  brotli: async (d) => new Uint8Array(await brotli(d)),
};

/** 缓存格式或解析规则变了就加一，旧缓存作废 */
export const SCAN_CACHE_VERSION = 1;
const SCAN_EXTS = new Set(['.ttf', '.otf', '.ttc', '.otc']);
export { IMPORT_EXTS };
/** 导入的字体文件上限。CJK 完整字体十几 MB 很常见，再大的多半不是字体 */
const MAX_IMPORT_BYTES = 200 * 1024 * 1024;

/** 一个要扫描的字体根目录。depth：往下进几层子目录（0 = 只扫这一层）；include：只进第一层里名字匹配的子目录 */
export interface FontRoot {
  dir: string;
  depth: number;
  include?: RegExp;
}

export function defaultSystemFontDirs(env: NodeJS.ProcessEnv = process.env): string[] {
  const dirs = [path.join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'Fonts')];
  const local = env.LOCALAPPDATA ?? (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Local') : null);
  if (local) dirs.push(path.join(local, 'Microsoft', 'Windows', 'Fonts'));
  return dirs;
}

/**
 * 按平台给出字体根目录。macOS：
 *   /System/Library/Fonts（楷体、圆体等在它的 Supplemental 子目录里）、/Library/Fonts、~/Library/Fonts，
 *   以及 /System/Library/AssetsV2/com_apple_MobileAsset_Font*\/<哈希>.asset/AssetData（系统按需下载的字体，新版 macOS 的苹方等在这里）。
 */
export function defaultSystemFontRoots(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform, home: string = os.homedir()): FontRoot[] {
  if (platform === 'darwin') {
    return [
      { dir: '/System/Library/Fonts', depth: 1 },
      { dir: '/Library/Fonts', depth: 1 },
      { dir: path.join(home, 'Library', 'Fonts'), depth: 2 },
      { dir: '/System/Library/AssetsV2', depth: 3, include: /^com_apple_MobileAsset_Font\d*$/ },
    ];
  }
  return defaultSystemFontDirs(env).map((dir) => ({ dir, depth: 0 }));
}

/** 把根目录展开成要扫描的目录列表（根目录自己，加上符合条件的子目录；不跟随符号链接，不会绕圈） */
export async function expandFontRoots(roots: FontRoot[]): Promise<string[]> {
  const out: string[] = [];
  const visit = async (dir: string, depth: number, include?: RegExp): Promise<void> => {
    out.push(dir);
    if (depth <= 0) return;
    let entries: fs.Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // 不存在或没有权限：跳过
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      if (include && !include.test(e.name)) continue;
      await visit(path.join(dir, e.name), depth - 1);
    }
  };
  for (const r of roots) await visit(r.dir, r.depth, r.include);
  return out;
}

// ---------------------------------------------------------------- 系统字体

async function fileSource(file: string): Promise<{ src: ByteSource; close(): Promise<void> }> {
  const fh = await fsp.open(file, 'r');
  const { size } = await fh.stat();
  return {
    src: {
      size,
      read: async (offset, length) => {
        const n = Math.max(0, Math.min(length, size - offset));
        const buf = Buffer.allocUnsafe(n);
        const { bytesRead } = await fh.read(buf, 0, n, offset);
        return new Uint8Array(buf.buffer, buf.byteOffset, bytesRead);
      },
    },
    close: () => fh.close(),
  };
}

/** 把一批字体面合并成家族列表：同一个英文家族名只留一项（Regular、Bold、Light 等合并），中文本地化名取第一个有的 */
export function mergeFaces(faces: ParsedFace[], source: FontInfo['source']): FontInfo[] {
  const byFamily = new Map<string, FontInfo>();
  for (const f of faces) {
    // 没有拉丁字母也没有汉字的是图标、符号字体（Wingdings、Segoe MDL2 Assets 等），选了正文全是乱码，不列
    if (!f.hasLatin && !f.hasCJK) continue;
    const key = f.family.toLowerCase();
    const have = byFamily.get(key);
    if (!have) {
      byFamily.set(key, {
        id: `${source === 'system' ? 'sys' : 'imp'}:${f.family}`,
        family: f.family,
        displayName: f.zhName ?? f.family,
        source,
        hasCJK: f.hasCJK,
      });
    } else {
      if (f.hasCJK) have.hasCJK = true;
      if (f.zhName && have.displayName === have.family) have.displayName = f.zhName;
    }
  }
  return [...byFamily.values()];
}

interface DirStamp {
  mtimeMs: number;
  count: number;
}

interface ScanCache {
  version: number;
  stamps: Record<string, DirStamp>;
  fonts: FontInfo[];
}

async function stampOf(dir: string): Promise<{ stamp: DirStamp; files: string[] } | null> {
  try {
    const [st, names] = await Promise.all([fsp.stat(dir), fsp.readdir(dir)]);
    const files = names.filter((n) => SCAN_EXTS.has(path.extname(n).toLowerCase()));
    return { stamp: { mtimeMs: st.mtimeMs, count: files.length }, files: files.map((n) => path.join(dir, n)) };
  } catch {
    return null;
  }
}

async function readFaceFile(file: string): Promise<ParsedFace[]> {
  let h: Awaited<ReturnType<typeof fileSource>> | null = null;
  try {
    h = await fileSource(file);
    return await readFaces(h.src, nodeDecompressors);
  } catch {
    return [];
  } finally {
    await h?.close().catch(() => {});
  }
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) await fn(items[next++]!);
    }),
  );
}

/**
 * 扫描字体目录，返回按家族去重的列表。cachePath 存在且各目录的修改时间、文件数都没变时直接用缓存。
 * 返回的列表没有排序（排序是界面的事）。
 */
export async function scanSystemFonts(dirs: string[], cachePath?: string): Promise<{ fonts: FontInfo[]; cached: boolean }> {
  const found = (await Promise.all(dirs.map(async (d) => [d, await stampOf(d)] as const))).filter(
    (x): x is readonly [string, NonNullable<Awaited<ReturnType<typeof stampOf>>>] => x[1] !== null,
  );
  const stamps: Record<string, DirStamp> = {};
  for (const [d, s] of found) stamps[d] = s.stamp;

  if (cachePath) {
    try {
      const c = JSON.parse(await fsp.readFile(cachePath, 'utf8')) as ScanCache;
      if (c.version === SCAN_CACHE_VERSION && JSON.stringify(c.stamps) === JSON.stringify(stamps) && Array.isArray(c.fonts)) {
        return { fonts: c.fonts, cached: true };
      }
    } catch {
      /* 没有缓存或缓存坏了：重新扫描 */
    }
  }

  const faces: ParsedFace[] = [];
  const files = found.flatMap(([, s]) => s.files);
  await pool(files, 8, async (f) => void faces.push(...(await readFaceFile(f))));
  // 并发读取的完成顺序不固定，先排一下让“第一个有中文名的”稳定
  faces.sort((a, b) => a.family.localeCompare(b.family) || a.index - b.index);
  const fonts = mergeFaces(faces, 'system');

  if (cachePath) {
    const cache: ScanCache = { version: SCAN_CACHE_VERSION, stamps, fonts };
    const tmp = `${cachePath}.tmp`;
    try {
      await fsp.writeFile(tmp, JSON.stringify(cache));
      await fsp.rename(tmp, cachePath);
    } catch {
      await fsp.rm(tmp, { force: true }).catch(() => {});
    }
  }
  return { fonts, cached: false };
}

// ---------------------------------------------------------------- 导入的字体

/** fonts.json 里的一项：一个字体文件 */
export interface ImportedFontFile {
  /** `imp:<family>` */
  id: string;
  family: string;
  displayName: string;
  hasCJK: boolean;
  /** fonts/ 下的文件名 */
  file: string;
  format: FontFileFormat;
  weight: number;
  italic: boolean;
}

interface Registry {
  version: 1;
  fonts: ImportedFontFile[];
}

export interface FontServiceOptions {
  /** 只扫这些目录（不进子目录）；测试用 */
  systemDirs?: string[];
  /** 要扫的根目录（可以进子目录）；默认按平台，见 defaultSystemFontRoots */
  systemRoots?: FontRoot[];
  /** 导入字体的 URL 前缀，默认 fjd://data/fonts */
  urlBase?: string;
}

export class FontService {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly fontsDir: string;
  private readonly registryFile: string;
  private readonly cacheFile: string;
  private readonly systemRoots: FontRoot[];
  private readonly urlBase: string;
  private scanning: Promise<FontInfo[]> | null = null;

  constructor(
    readonly root: string,
    opts: FontServiceOptions = {},
  ) {
    this.fontsDir = path.join(root, 'fonts');
    this.registryFile = path.join(root, 'fonts.json');
    this.cacheFile = path.join(root, 'font-cache.json');
    this.systemRoots = opts.systemRoots ?? (opts.systemDirs ? opts.systemDirs.map((dir) => ({ dir, depth: 0 })) : defaultSystemFontRoots());
    this.urlBase = opts.urlBase ?? 'fjd://data/fonts';
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  private async readRegistry(): Promise<ImportedFontFile[]> {
    try {
      const r = JSON.parse(await fsp.readFile(this.registryFile, 'utf8')) as Registry;
      return Array.isArray(r.fonts) ? r.fonts.filter((f) => f && typeof f.file === 'string' && typeof f.family === 'string') : [];
    } catch {
      return [];
    }
  }

  private async writeRegistry(fonts: ImportedFontFile[]): Promise<void> {
    const tmp = `${this.registryFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify({ version: 1, fonts } satisfies Registry));
    await fsp.rename(tmp, this.registryFile);
  }

  /**
   * 系统字体。每次都先看一眼字体目录的修改时间和文件数（stat + readdir，很快），没变就直接用缓存文件；
   * 正在扫描时，别的窗口再来问就共用同一次扫描。
   */
  listSystem(): Promise<FontInfo[]> {
    if (!this.scanning) {
      const p = expandFontRoots(this.systemRoots)
        .then((dirs) => scanSystemFonts(dirs, this.cacheFile))
        .then((r) => r.fonts);
      const clear = (): void => {
        if (this.scanning === p) this.scanning = null;
      };
      p.then(clear, clear);
      this.scanning = p;
    }
    return this.scanning;
  }

  async listImported(): Promise<FontInfo[]> {
    const files = await this.readRegistry();
    const out = new Map<string, FontInfo>();
    for (const f of files) {
      const have = out.get(f.id);
      if (have) have.hasCJK ||= f.hasCJK;
      else out.set(f.id, { id: f.id, family: f.family, displayName: f.displayName, source: 'imported', hasCJK: f.hasCJK });
    }
    return [...out.values()];
  }

  /** 导入的字体 + 系统字体 */
  async list(): Promise<FontInfo[]> {
    const [system, imported] = await Promise.all([this.listSystem(), this.listImported()]);
    return [...imported, ...system];
  }

  /**
   * 导入一批字体文件。TTC 拆成单个字体。返回这次新增或补充了字重的家族；
   * 全部失败时抛错，部分失败只导入成功的。
   */
  importFiles(paths: string[]): Promise<FontInfo[]> {
    return this.serial(async () => {
      await fsp.mkdir(this.fontsDir, { recursive: true });
      const registry = await this.readRegistry();
      const touched = new Map<string, FontInfo>();
      const errors: string[] = [];
      for (const p of paths) {
        const name = path.basename(p);
        try {
          const st = await fsp.stat(p);
          if (!st.isFile()) throw new Error(`不是有效的字体文件：${name}`);
          if (st.size > MAX_IMPORT_BYTES) throw new Error(`字体文件太大：${name}`);
          const bytes = new Uint8Array(await fsp.readFile(p));
          for (const face of await prepareFontFile(name, bytes, nodeDecompressors)) {
            const hash = crypto.createHash('sha256').update(face.data).digest('hex').slice(0, 12);
            const file = `${hash}.${face.format}`;
            const id = `imp:${face.family}`;
            if (registry.some((r) => r.file === file || (r.id === id && r.weight === face.weight && r.italic === face.italic))) continue;
            await fsp.writeFile(path.join(this.fontsDir, file), face.data);
            registry.push({ id, family: face.family, displayName: face.displayName, hasCJK: face.hasCJK, file, format: face.format, weight: face.weight, italic: face.italic });
            touched.set(id, { id, family: face.family, displayName: face.displayName, source: 'imported', hasCJK: face.hasCJK });
          }
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
      if (touched.size > 0) await this.writeRegistry(registry);
      if (touched.size === 0 && errors.length > 0) throw new Error(errors.join('；'));
      return [...touched.values()];
    });
  }

  /** 删掉一个导入的家族（它的所有字重）。不是导入的字体一律拒绝 */
  remove(id: string): Promise<void> {
    return this.serial(async () => {
      if (typeof id !== 'string' || !id.startsWith('imp:')) throw new Error('只能删除导入的字体');
      const registry = await this.readRegistry();
      const gone = registry.filter((f) => f.id === id);
      if (gone.length === 0) return;
      await this.writeRegistry(registry.filter((f) => f.id !== id));
      for (const f of gone) {
        // 文件名来自我们自己写的登记表，仍然只取 basename，防止被改过的 fonts.json 带出目录
        await fsp.rm(path.join(this.fontsDir, path.basename(f.file)), { force: true });
      }
    });
  }

  /** 导入字体的 @font-face 规则 */
  async faceCss(): Promise<string> {
    const files = await this.readRegistry();
    return files
      .filter((f) => fs.existsSync(path.join(this.fontsDir, path.basename(f.file))))
      .map((f) =>
        fontFaceRule({
          family: f.family,
          url: `${this.urlBase}/${encodeURIComponent(path.basename(f.file))}`,
          format: f.format,
          weight: f.weight,
          italic: f.italic,
        }),
      )
      .join('\n');
  }
}
