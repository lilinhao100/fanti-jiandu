// 导入一本书：算 id、识别格式、用 foliate 读元数据和封面；txt 先转成 epub。
// 只负责“准备”，不碰存储；存储由平台实现完成。
import { decodeText, detectScript, splitChapters } from '@fjd/engine';
import { makeBook } from 'foliate-js/view.js';
import { bookIdOf } from '../lib/hash';
import type { BookFormat, BookRecord } from '../model';
import type { FoliateBook } from '../reader/foliateTypes';
import { pickAuthors, pickTitle } from '../reader/meta';
import { findFallbackCover } from './cover';
import { buildTxtEpub } from './txtEpub';

export interface PreparedBook {
  record: BookRecord;
  /** 要存下来的文件。txt 是拼好的 epub，其余是原文件 */
  file: Blob;
  cover?: Blob;
}

const EXT_FORMAT: Record<string, BookFormat> = {
  epub: 'epub',
  mobi: 'mobi',
  prc: 'mobi',
  azw3: 'azw3',
  azw: 'azw3',
  kf8: 'azw3',
  fb2: 'fb2',
  txt: 'txt',
};

export function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return (i > 0 ? name.slice(0, i) : name).trim();
}

export function formatOf(name: string): BookFormat | null {
  return EXT_FORMAT[extOf(name)] ?? null;
}

/** 封面缩到最高 720px（网格里最宽 200px，两倍屏也够）。解码失败说明它不是图片，当作没有封面。 */
async function shrinkCover(blob: Blob, maxHeight = 720): Promise<Blob | undefined> {
  if (!blob.size) return undefined;
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob);
  } catch {
    return undefined;
  }
  try {
    if (bmp.height <= maxHeight) return blob;
    const scale = maxHeight / bmp.height;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = maxHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return blob;
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.88));
    return out ?? blob;
  } finally {
    bmp.close();
  }
}

/**
 * foliate 的 getCover 返回空时的兜底（见 cover.ts）。
 * 第一页上“图片排在文字前面”的情况只收竖版的大图，免得把一个小徽标当成封面。
 */
async function fallbackCover(book: FoliateBook): Promise<Blob | undefined> {
  const found = await findFallbackCover(book);
  if (!found) return undefined;
  if (found.source === 'first-image') {
    try {
      const bmp = await createImageBitmap(found.blob);
      const ok = bmp.height >= 400 && bmp.height > bmp.width;
      bmp.close();
      if (!ok) return undefined;
    } catch {
      return undefined;
    }
  }
  return shrinkCover(found.blob);
}

async function prepareTxt(file: File, bytes: Uint8Array, id: string): Promise<PreparedBook> {
  const { text } = decodeText(bytes);
  const chapters = splitChapters(text);
  const title = baseName(file.name) || '未命名';
  const sample = text.slice(0, 20000);
  const script = detectScript(sample);
  const language = script.script === 'hant' ? (script.variant === 'hk' ? 'zh-HK' : 'zh-TW') : script.script === 'hans' ? 'zh-CN' : 'zh';
  const epub = buildTxtEpub({ id, title, language, chapters });
  const record: BookRecord = {
    id,
    title,
    author: '',
    format: 'txt',
    fileName: file.name,
    size: file.size,
    addedAt: Date.now(),
    script,
    pdfReflow: false,
  };
  return { record, file: new Blob([epub.slice()], { type: 'application/epub+zip' }) };
}

export async function prepareBook(file: File): Promise<PreparedBook> {
  const format = formatOf(file.name);
  if (!format) throw new Error(`不支持的格式：${file.name}`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) throw new Error(`文件是空的：${file.name}`);
  const id = await bookIdOf(bytes);

  if (format === 'txt') return prepareTxt(file, bytes, id);

  // 交给 foliate 的 File 必须保留原文件名（它靠扩展名认 fb2）
  const book = await makeBook(new File([bytes.slice()], file.name, { type: file.type }));
  try {
    const meta = book.metadata ?? {};
    const title = pickTitle(meta.title) || baseName(file.name) || '未命名';
    const author = pickAuthors(meta.author).join('、');
    let cover: Blob | undefined;
    try {
      const raw = await book.getCover?.();
      if (raw) cover = await shrinkCover(raw);
      cover ??= await fallbackCover(book);
    } catch (e) {
      console.warn('读取封面失败', e);
    }
    const record: BookRecord = {
      id,
      title,
      author,
      format,
      fileName: file.name,
      size: file.size,
      addedAt: Date.now(),
    };
    return { record, file: new Blob([bytes.slice()], { type: file.type }), cover };
  } finally {
    book.destroy?.();
  }
}
