import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  convertText,
  detectPdfReflow,
  detectScript,
  transformCss,
  transformMarkup,
  type ConvertOptions,
  type ScriptInfo,
  type Trace,
  type TransformStats,
} from '@fjd/engine';
import { env } from './env';

export interface Manifest {
  opfPath: string;
  items: Map<string, { id: string; mediaType: string; properties: string }>; // 键：zip 内的完整路径
  spine: string[]; // 章节在 zip 内的完整路径
  language: string;
}

export interface EpubResult {
  files: Record<string, Uint8Array>;
  order: string[];
  manifest: Manifest;
  info: ScriptInfo;
  pdfReflow: boolean;
  opts: ConvertOptions;
  stats: TransformStats;
  warnings: string[];
}

export interface ConvertFlags {
  vocabulary: boolean;
  quotes: boolean;
  cleanup: boolean;
  horizontal: boolean;
  variant?: 'tw' | 'hk' | 't';
  reflow: 'auto' | 'on' | 'off';
}

const XHTML = 'application/xhtml+xml';

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i + 1);
}

function resolvePath(base: string, href: string): string {
  const clean = decodeURIComponent(href.split('#')[0]!.split('?')[0]!);
  const parts = (base + clean).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function attr(tag: string, name: string): string {
  const m = new RegExp(`(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(tag);
  return m ? (m[2] ?? m[3] ?? '') : '';
}

export function readManifest(files: Record<string, Uint8Array>): Manifest {
  const container = files['META-INF/container.xml'];
  if (!container) throw new Error('不是有效的 epub：缺少 META-INF/container.xml');
  const rf = /<rootfile\b[^>]*>/i.exec(strFromU8(container));
  const opfPath = rf ? attr(rf[0], 'full-path') : '';
  const opfBytes = files[opfPath];
  if (!opfPath || !opfBytes) throw new Error('不是有效的 epub：找不到 OPF 文件 ' + opfPath);
  const opf = strFromU8(opfBytes);
  const base = dirname(opfPath);

  const byId = new Map<string, string>();
  const items: Manifest['items'] = new Map();
  for (const m of opf.matchAll(/<item\b[^>]*>/gi)) {
    const tag = m[0];
    const href = attr(tag, 'href');
    if (!href) continue;
    const path = resolvePath(base, href);
    const id = attr(tag, 'id');
    items.set(path, { id, mediaType: attr(tag, 'media-type'), properties: attr(tag, 'properties') });
    byId.set(id, path);
  }
  const spine: string[] = [];
  for (const m of opf.matchAll(/<itemref\b[^>]*>/gi)) {
    const p = byId.get(attr(m[0], 'idref'));
    if (p) spine.push(p);
  }
  const lang = /<dc:language\b[^>]*>([\s\S]*?)<\/dc:language>/i.exec(opf);
  return { opfPath, items, spine, language: lang ? lang[1]!.trim() : '' };
}

function guessMediaType(path: string, manifest: Manifest): string {
  const m = manifest.items.get(path)?.mediaType;
  if (m) return m;
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'xhtml') return XHTML;
  if (ext === 'html' || ext === 'htm') return 'text/html';
  if (ext === 'css') return 'text/css';
  if (ext === 'ncx') return 'application/x-dtbncx+xml';
  if (ext === 'opf') return 'application/oebps-package+xml';
  return '';
}

function stripTags(x: string): string {
  return x.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '').replace(/<[^>]*>/g, '');
}

function declaredEncoding(markup: string): string | null {
  const x = /^\uFEFF?\s*<\?xml[^>]*\bencoding\s*=\s*["']([^"']+)["']/i.exec(markup);
  if (x) return x[1]!.toLowerCase();
  const m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(markup.slice(0, 4096));
  return m ? m[1]!.toLowerCase() : null;
}

function isUtf8Label(enc: string | null): boolean {
  return enc === null || enc === 'utf-8' || enc === 'utf8' || enc === 'us-ascii' || enc === 'ascii';
}

const STORE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp3', 'mp4', 'm4a', 'm4v', 'woff', 'woff2', 'zip', 'epub']);

export function readEpub(data: Uint8Array): { files: Record<string, Uint8Array>; order: string[] } {
  const files = unzipSync(data);
  return { files, order: Object.keys(files) };
}

/** 重新打包：mimetype 放第一个且不压缩；固定时间戳，保证同样输入得到同样字节 */
export function writeEpub(files: Record<string, Uint8Array>, order: string[]): Uint8Array {
  const z: Zippable = {};
  const mtime = new Date(2020, 0, 1, 0, 0, 0);
  const put = (name: string): void => {
    const ext = name.slice(name.lastIndexOf('.') + 1).toLowerCase();
    const level = name === 'mimetype' || STORE_EXT.has(ext) ? 0 : 6;
    z[name] = [files[name]!, { level, mtime }];
  };
  if (files['mimetype']) put('mimetype');
  for (const name of order) {
    if (name === 'mimetype' || name.endsWith('/')) continue;
    put(name);
  }
  return zipSync(z);
}

export function decideOptions(flags: ConvertFlags, info: ScriptInfo): ConvertOptions {
  return {
    convert: true,
    vocabulary: flags.vocabulary,
    quotes: flags.quotes,
    cleanup: flags.cleanup,
    horizontal: flags.horizontal,
    variant: flags.variant ?? info.variant,
  };
}

/** 转换整本 epub。trace 用于 report 抽样。 */
export function convertEpub(data: Uint8Array, flags: ConvertFlags, trace?: Trace): EpubResult {
  const { files, order } = readEpub(data);
  const manifest = readManifest(files);
  const warnings: string[] = [];

  const readText = (path: string): string => strFromU8(files[path]!);
  const spineDocs = manifest.spine.filter((p) => files[p] && /html/i.test(guessMediaType(p, manifest)));

  // 检测书的文字和是否 PDF 转制（取前 5 个章节，与 ARCHITECTURE 3.5 一致）
  const sample = spineDocs
    .slice(0, 8)
    .map((p) => stripTags(readText(p)))
    .join('\n')
    .slice(0, 30000);
  const info = detectScript(sample, manifest.language);
  const first5 = spineDocs.slice(0, 5).map(readText);
  const pdfReflow = flags.reflow === 'on' ? true : flags.reflow === 'off' ? false : detectPdfReflow(first5);
  const opts = decideOptions(flags, info);

  const stats: TransformStats = { convertedChars: 0, spacesRemoved: 0, paragraphsMerged: 0, newlinesRemoved: 0 };
  const add = (s: TransformStats): void => {
    stats.convertedChars += s.convertedChars;
    stats.spacesRemoved += s.spacesRemoved;
    stats.paragraphsMerged += s.paragraphsMerged;
    stats.newlinesRemoved += s.newlinesRemoved;
  };

  const out: Record<string, Uint8Array> = { ...files };
  for (const path of order) {
    const bytes = files[path];
    if (!bytes || path.endsWith('/')) continue;
    const mt = guessMediaType(path, manifest);
    if (/^(application\/xhtml\+xml|text\/html)$/i.test(mt)) {
      const markup = strFromU8(bytes).replace(/^\uFEFF/, '');
      if (!isUtf8Label(declaredEncoding(markup))) {
        warnings.push(`${path}: 编码声明不是 UTF-8（${declaredEncoding(markup)}），已跳过`);
        continue;
      }
      const r = transformMarkup(markup, mt, opts, { pdfReflow }, env, trace);
      add(r.stats);
      if (r.markup !== markup) out[path] = strToU8(r.markup);
    } else if (/^text\/css$/i.test(mt)) {
      const css = strFromU8(bytes);
      const c = transformCss(css, opts);
      if (c !== css) out[path] = strToU8(c);
    } else if (/ncx/i.test(mt) || path.endsWith('.ncx')) {
      const ncx = strFromU8(bytes);
      const c = ncx.replace(
        /(<text\b[^>]*>)([\s\S]*?)(<\/text>)/g,
        (_m, a: string, t: string, b: string) => a + convertText(t, opts) + b,
      );
      if (c !== ncx) out[path] = strToU8(c);
    } else if (path === manifest.opfPath) {
      const opf = strFromU8(bytes);
      const c = opf.replace(
        /(<dc:(?:title|creator)\b[^>]*>)([\s\S]*?)(<\/dc:(?:title|creator)>)/g,
        (_m, a: string, t: string, b: string) => a + convertText(t, opts) + b,
      );
      if (c !== opf) out[path] = strToU8(c);
    }
  }
  return { files: out, order, manifest, info, pdfReflow, opts, stats, warnings };
}
