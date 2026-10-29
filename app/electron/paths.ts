// 数据目录里的路径解析与防穿越。纯函数，主进程的 IPC 和 fjd:// 协议都靠它。
import path from 'node:path';

/** 数据目录下允许存放文件的子目录 */
export const DATA_DIRS = ['books', 'covers', 'annotations', 'fonts'] as const;
/** 数据目录根下允许读写的 JSON */
export const DATA_FILES = ['library.json', 'settings.json'] as const;
/** 可以通过 fjd://data/ 对外提供的子目录（不含标注和 JSON） */
export const SERVED_DIRS = ['books', 'covers', 'fonts'] as const;

function cleanSegments(rel: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.includes(':')) return null;
  const segs = decoded.split('/');
  if (segs.length === 0) return null;
  for (const s of segs) {
    if (s === '' || s === '.' || s === '..') return null;
    if (/[<>"|?*]/.test(s)) return null;
  }
  return segs;
}

function inside(root: string, full: string): boolean {
  const r = path.resolve(root);
  const f = path.resolve(full);
  return f.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/**
 * IPC 用：把渲染进程给的相对路径解析成数据目录里的绝对路径。
 * 只接受 `library.json`、`settings.json`，以及 `<books|covers|annotations|fonts>/<文件名>`（只有一层）。
 */
export function resolveData(root: string, rel: string): string {
  const segs = cleanSegments(rel.replace(/^\/+/, ''));
  if (!segs) throw new Error(`非法路径：${rel}`);
  let ok = false;
  if (segs.length === 1) ok = (DATA_FILES as readonly string[]).includes(segs[0]!);
  else if (segs.length === 2) ok = (DATA_DIRS as readonly string[]).includes(segs[0]!);
  if (!ok) throw new Error(`不允许访问：${rel}`);
  const full = path.join(root, ...segs);
  if (!inside(root, full)) throw new Error(`非法路径：${rel}`);
  return full;
}

/** 目录名本身（listDir 用） */
export function resolveDataDir(root: string, dir: string): string {
  if (!(DATA_DIRS as readonly string[]).includes(dir)) throw new Error(`不允许访问：${dir}`);
  return path.join(root, dir);
}

/**
 * fjd://data/<子目录>/<文件名> 的请求路径 → 磁盘路径。只提供书、封面、字体，其余（含 library.json）一律拒绝。
 * 返回 null 表示拒绝。
 */
export function resolveServed(root: string, pathname: string): string | null {
  const segs = cleanSegments(pathname.replace(/^\/+/, ''));
  if (!segs || segs.length !== 2) return null;
  if (!(SERVED_DIRS as readonly string[]).includes(segs[0]!)) return null;
  const full = path.join(root, ...segs);
  return inside(root, full) ? full : null;
}

/** fjd://app/<路径> → 界面文件。限制在 appRoot 之内；根路径给 index.html */
export function resolveAppFile(appRoot: string, pathname: string): string | null {
  const rel = pathname.replace(/^\/+/, '');
  if (rel === '') return path.join(appRoot, 'index.html');
  const segs = cleanSegments(rel);
  if (!segs) return null;
  const full = path.join(appRoot, ...segs);
  return inside(appRoot, full) ? full : null;
}
