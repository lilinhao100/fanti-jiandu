// 导入字体文件前的准备：认格式、读名字、TTC 拆成单个字体。主进程（electron）和 web 版共用。
import type { FontFileFormat } from './css';
import { bytesSource, extractTtcFace, readFaces, sniffFormat, type Decompressors } from './sfnt';

export const IMPORT_EXTS = ['ttf', 'otf', 'ttc', 'woff', 'woff2'];

export interface PreparedFace {
  /** 英文家族名，导入后写进 @font-face 的 font-family */
  family: string;
  /** 显示名：简体中文名，没有就用英文名 */
  displayName: string;
  hasCJK: boolean;
  weight: number;
  italic: boolean;
  format: FontFileFormat;
  /** 单个字体的文件内容（TTC 已拆开） */
  data: Uint8Array;
}

const baseName = (fileName: string): string => fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');

/**
 * 把一个字体文件整理成一个或多个可以直接放进 @font-face 的字体。
 * 不是字体、格式不支持、读不出名字都抛带中文说明的错误。
 * 运行环境没有 brotli（浏览器）时读不了 WOFF2 里的名字，退回用文件名当家族名，hasCJK 记为假。
 */
export async function prepareFontFile(fileName: string, bytes: Uint8Array, dec: Decompressors): Promise<PreparedFace[]> {
  const ext = fileName.slice(fileName.lastIndexOf('.') + 1).toLowerCase();
  if (!IMPORT_EXTS.includes(ext)) throw new Error(`不支持的字体格式：${fileName}`);
  if (bytes.length === 0) throw new Error(`不是有效的字体文件：${fileName}`);
  const kind = sniffFormat(bytes);
  if (!kind) throw new Error(`不是有效的字体文件：${fileName}`);
  const faces = await readFaces(bytesSource(bytes), dec);
  if (faces.length === 0) {
    if (kind === 'woff2' && !dec.brotli) {
      return [{ family: baseName(fileName), displayName: baseName(fileName), hasCJK: false, weight: 400, italic: false, format: 'woff2', data: bytes }];
    }
    throw new Error(`读不出字体名字：${fileName}`);
  }
  return faces.map((face) => {
    const data = kind === 'ttc' ? extractTtcFace(bytes, face.index) : bytes;
    const format: FontFileFormat = kind === 'ttc' ? (data[0] === 0x4f ? 'otf' : 'ttf') : kind;
    return { family: face.family, displayName: face.zhName ?? face.family, hasCJK: face.hasCJK, weight: face.weight, italic: face.italic, format, data };
  });
}
