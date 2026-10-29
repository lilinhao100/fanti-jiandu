// 封面兜底。foliate 的 getCover 靠 OPF 里的标记找封面；很多书（比如 calibre 转出来的 PDF 转制书）没有标记。
// 这时按下面的顺序再找一次：
//   1. spine 第一项是“只有一张图片的页面”（或图片排在所有文字前面的页面）→ 用这张图；
//   2. manifest 里 id 或文件名含 cover 的图片；
//   3. 都没有 → 调用方用生成封面。
import type { FoliateBook } from '../reader/foliateTypes';

export interface ManifestItem {
  id?: string;
  href: string;
  mediaType?: string;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export function isImageItem(it: ManifestItem): boolean {
  return (it.mediaType ?? '').startsWith('image/') || IMAGE_EXT.test(it.href);
}

/** 相对路径解析成包内路径（章节 id 就是章节文件在包内的路径） */
export function resolvePackagePath(src: string, from: string): string | null {
  if (!src || /^(data:|blob:|https?:|\/\/)/i.test(src)) return null;
  try {
    const base = new URL(`http://pkg/${from.replace(/^\/+/, '')}`);
    const url = new URL(src.split('#')[0]!.split('?')[0]!, base);
    return decodeURIComponent(url.pathname.slice(1));
  } catch {
    return null;
  }
}

export interface FirstPageImage {
  src: string;
  /** 页面上除了这张图没有别的文字 */
  imageOnly: boolean;
}

/** 这一页是不是封面页：恰好一张图，并且它排在所有文字前面 */
export function inspectFirstPage(doc: Document): FirstPageImage | null {
  const body = doc.body ?? doc.documentElement;
  if (!body) return null;
  const imgs = Array.from(body.querySelectorAll('img, image'));
  if (imgs.length !== 1) return null;
  const img = imgs[0]!;
  const src = img.getAttribute('src') ?? img.getAttribute('href') ?? img.getAttribute('xlink:href');
  if (!src) return null;

  let before = '';
  let after = '';
  let seen = false;
  const walk = (n: Node): void => {
    if (n === img) {
      seen = true;
      return;
    }
    if (n.nodeType === 3) {
      if (seen) after += n.nodeValue ?? '';
      else before += n.nodeValue ?? '';
      return;
    }
    const name = (n as Element).nodeName?.toLowerCase();
    if (name === 'script' || name === 'style') return;
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(body);
  if (before.trim()) return null;
  return { src, imageOnly: !after.trim() };
}

/** manifest 里 id 或文件名含 cover 的图片；多张时优先 id 就是 cover 的，避开缩略图 */
export function pickManifestCover(manifest: ManifestItem[]): ManifestItem | null {
  const score = (it: ManifestItem): number => {
    const file = it.href.split('/').pop() ?? it.href;
    const id = it.id ?? '';
    let s = 0;
    if (/cover/i.test(id)) s += 2;
    if (/cover/i.test(file)) s += 2;
    if (/^cover(-?image)?$/i.test(id)) s += 2;
    if (/^cover\.[a-z]+$/i.test(file)) s += 2;
    if (/thumb|small|back|spine/i.test(`${id} ${file}`)) s -= 3;
    return s;
  };
  let best: ManifestItem | null = null;
  let bestScore = 0;
  for (const it of manifest) {
    if (!isImageItem(it)) continue;
    const sc = score(it);
    if (sc > bestScore) {
      best = it;
      bestScore = sc;
    }
  }
  return best;
}

export interface CoverCandidate {
  blob: Blob;
  /** 来自“只有一张图的页面”（可信），还是“图片排在文字前面的页面”（要再看尺寸） */
  source: 'image-page' | 'first-image' | 'manifest';
}

/** 返回候选封面；不负责缩放和检查能不能解码 */
export async function findFallbackCover(book: FoliateBook): Promise<CoverCandidate | null> {
  const loadBlob = typeof book.loadBlob === 'function' ? book.loadBlob.bind(book) : null;
  if (!loadBlob) return null; // 只有 epub 有包内路径；其它格式没有“OPF”，getCover 找不到就算了

  const first = book.sections?.[0];
  if (first?.createDocument && typeof first.id === 'string') {
    try {
      const page = inspectFirstPage(await first.createDocument());
      const path = page ? resolvePackagePath(page.src, first.id) : null;
      if (page && path) {
        const blob = await loadBlob(path);
        if (blob && blob.size > 0) return { blob, source: page.imageOnly ? 'image-page' : 'first-image' };
      }
    } catch (e) {
      console.warn('从第一页找封面失败', e);
    }
  }

  const item = pickManifestCover(book.resources?.manifest ?? []);
  if (item) {
    try {
      const blob = await loadBlob(item.href);
      if (blob && blob.size > 0) return { blob: item.mediaType ? new Blob([blob], { type: item.mediaType }) : blob, source: 'manifest' };
    } catch (e) {
      console.warn('读取 manifest 封面失败', e);
    }
  }
  return null;
}
