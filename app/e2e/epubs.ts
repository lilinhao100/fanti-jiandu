// 验收用的合成书：现场拼 epub、在浏览器里画封面。不依赖 samples/，所以谁的机器上都能跑。
import { strToU8, zipSync, type Zippable } from 'fflate';
import type { Page } from '@playwright/test';

export interface EpubSpec {
  title: string;
  author: string;
  lang?: string;
  paragraphs?: string[];
  /** 多章：给了就按章生成（章名进目录），paragraphs 不再使用 */
  chapters?: { title: string; paragraphs: string[] }[];
  /** 封面图片字节（png） */
  cover?: Uint8Array;
  /**
   * 封面怎么放：
   * - marked：OPF 里标记了封面（foliate 的 getCover 能找到）
   * - image-page：OPF 没标记，但 spine 第一项是只有一张图片的页面
   * - first-image：OPF 没标记，spine 第一项是“图片在前、书名在后”的页面（calibre 转 PDF 的样子）
   * - manifest：OPF 没标记，第一页也不是图，但 manifest 里有个文件名含 cover 的图片
   */
  coverMode?: 'marked' | 'image-page' | 'first-image' | 'manifest';
  /** 写进每一页 head 的 generator 标记，例如 'PDF Reflow conversion'（用来模拟 PDF 转制书） */
  generator?: string;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildEpub(spec: EpubSpec): Uint8Array {
  const { title, author, cover } = spec;
  const mode = cover ? (spec.coverMode ?? 'marked') : undefined;
  const lang = spec.lang ?? 'zh-TW';
  const paras = spec.paragraphs ?? [`《${title}》的第一段文字。`, '軟體與網路的故事，從這裡開始。'];

  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(
      `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
    ),
  };
  const chapters = spec.chapters ?? [{ title: '第一章', paragraphs: paras }];
  const manifest: string[] = [
    `<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`,
    ...chapters.map((_, i) => `<item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`),
  ];
  const spine: string[] = [];
  let metaCover = '';

  const generatorMeta = spec.generator ? `<meta name="generator" content="${esc(spec.generator)}"/>` : '';
  const page = (body: string): Uint8Array =>
    strToU8(
      `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>${esc(title)}</title>${generatorMeta}</head><body>${body}</body></html>`,
    );

  if (cover && mode === 'marked') {
    files['OEBPS/images/cover.png'] = cover;
    manifest.push(`<item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image"/>`);
    metaCover = `<meta name="cover" content="cover-image"/>`;
  } else if (cover && mode === 'image-page') {
    files['OEBPS/images/front.png'] = cover;
    files['OEBPS/front.xhtml'] = page(`<div><img src="images/front.png" alt=""/></div>`);
    manifest.push(`<item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>`, `<item id="img1" href="images/front.png" media-type="image/png"/>`);
    spine.push('front');
  } else if (cover && mode === 'first-image') {
    files['OEBPS/images/index-1_1.png'] = cover;
    files['OEBPS/front.xhtml'] = page(`<p><img src="images/index-1_1.png" alt=""/></p><p>${esc(title)}</p><p>作者：${esc(author)}</p>`);
    manifest.push(`<item id="front" href="front.xhtml" media-type="application/xhtml+xml"/>`, `<item id="img1" href="images/index-1_1.png" media-type="image/png"/>`);
    spine.push('front');
  } else if (cover && mode === 'manifest') {
    files['OEBPS/images/my_cover.png'] = cover;
    manifest.push(`<item id="pic" href="images/my_cover.png" media-type="image/png"/>`);
  }

  chapters.forEach((c, i) => {
    spine.push(`ch${i + 1}`);
    files[`OEBPS/ch${i + 1}.xhtml`] = page(`<h1>${esc(c.title)}</h1>${c.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}`);
  });
  files['OEBPS/nav.xhtml'] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>目錄</title></head><body><nav epub:type="toc"><ol>${chapters.map((c, i) => `<li><a href="ch${i + 1}.xhtml">${esc(c.title)}</a></li>`).join('')}</ol></nav></body></html>`,
  );
  files['OEBPS/content.opf'] = strToU8(
    `<?xml version="1.0" encoding="utf-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">fjd-${esc(title)}-${esc(author)}</dc:identifier><dc:title>${esc(title)}</dc:title><dc:creator>${esc(author)}</dc:creator><dc:language>${lang}</dc:language>${metaCover}</metadata><manifest>${manifest.join('')}</manifest><spine>${spine.map((s) => `<itemref idref="${s}"/>`).join('')}</spine></package>`,
  );
  return zipSync(files);
}

export interface CoverSpec {
  w: number;
  h: number;
  title: string;
  author: string;
  /** 渐变的两端 */
  bg: [string, string];
  fg: string;
  accent: string;
  style: 'band' | 'circle' | 'frame' | 'stripes';
  serif?: boolean;
}

/** 在浏览器里画一张封面，返回 PNG 字节 */
export async function drawCover(page: Page, spec: CoverSpec): Promise<Buffer> {
  const dataUrl = await page.evaluate((c) => {
    const canvas = document.createElement('canvas');
    canvas.width = c.w;
    canvas.height = c.h;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, c.w * 0.4, c.h);
    g.addColorStop(0, c.bg[0]);
    g.addColorStop(1, c.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.w, c.h);

    ctx.fillStyle = c.accent;
    if (c.style === 'band') ctx.fillRect(0, c.h * 0.56, c.w, c.h * 0.1);
    if (c.style === 'circle') {
      ctx.beginPath();
      ctx.arc(c.w * 0.5, c.h * 0.62, c.w * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    if (c.style === 'frame') {
      ctx.strokeStyle = c.accent;
      ctx.lineWidth = c.w * 0.025;
      ctx.strokeRect(c.w * 0.07, c.w * 0.07, c.w * 0.86, c.h - c.w * 0.14);
    }
    if (c.style === 'stripes') for (let i = 0; i < 5; i++) ctx.fillRect(0, c.h * (0.5 + i * 0.07), c.w, c.h * 0.025);

    ctx.fillStyle = c.fg;
    ctx.textBaseline = 'top';
    const family = c.serif ? 'Georgia, SimSun, serif' : '"Segoe UI", "Microsoft YaHei", sans-serif';
    const size = c.w * 0.14;
    ctx.font = `700 ${size}px ${family}`;
    // 书名按字折行
    const maxW = c.w * 0.76;
    let line = '';
    let y = c.h * 0.1;
    for (const ch of c.title) {
      if (ctx.measureText(line + ch).width > maxW) {
        ctx.fillText(line, c.w * 0.12, y);
        y += size * 1.25;
        line = '';
      }
      line += ch;
    }
    ctx.fillText(line, c.w * 0.12, y);
    ctx.font = `400 ${c.w * 0.065}px ${family}`;
    ctx.fillText(c.author, c.w * 0.12, c.h * 0.9);
    return canvas.toDataURL('image/png');
  }, spec);
  return Buffer.from(dataUrl.split(',')[1]!, 'base64');
}
