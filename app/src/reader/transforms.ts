// 把引擎接到 foliate 上。接线方案见 docs/notes/foliate-hooks.md 第 9 节。
import {
  detectPdfReflow,
  detectScript,
  transformCss,
  transformDocument,
  transformMarkup,
  type BookContext,
  type ConvertOptions,
  type ScriptInfo,
  type TransformEnv,
} from '@fjd/engine';
import type { FoliateBook } from './foliateTypes';
import { pickLanguage } from './meta';

/** epub 的正文走 transformTarget 的 data 事件；其余格式的正文走 view 的 load 事件 */
export type BookKind = 'epub' | 'doc';

/**
 * 只有 EPUB 类会设置 resources（epub.js:968）。不能用 loadText 或 transformTarget 判断：
 * MOBI6、KF8 也有 loadText（参数是章节对象，不是路径），KF8 也有 transformTarget（但正文没有 data 事件）。
 */
export function kindOf(book: FoliateBook): BookKind {
  return book.resources?.manifest ? 'epub' : 'doc';
}

/** epub 专用：按包内路径读章节原文 */
function epubLoadText(book: FoliateBook): ((path: string) => Promise<string | null>) | null {
  if (kindOf(book) !== 'epub' || typeof book.loadText !== 'function') return null;
  const f = book.loadText as unknown as (path: string) => Promise<string | null>;
  return f.bind(book);
}

const MARKUP_TYPES = new Set(['application/xhtml+xml', 'text/html', 'application/xml', 'text/xml']);

export const browserEnv = (): TransformEnv => ({ DOMParser, XMLSerializer });

/** 转换状态：重新打开书时整体替换，钩子读的永远是最新的 */
export interface TransformState {
  kind: BookKind;
  opts: ConvertOptions;
  ctx: BookContext;
  /** 书的语言以 zh/ja 开头：竖排转横排时顺带清掉 rtl */
  cjk: boolean;
}

function isParseError(doc: Document): boolean {
  return !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0;
}

/** 5 种格式统一：包装 section.createDocument，让书内搜索读到转换后的文本（笔记第 3 节） */
export function wrapCreateDocument(book: FoliateBook, state: TransformState): void {
  for (const section of book.sections) {
    const orig = section.createDocument;
    if (!orig) continue;
    section.createDocument = async () => {
      let doc = await orig.call(section);
      const loadText = epubLoadText(book);
      if (state.kind === 'epub' && loadText && isParseError(doc)) {
        // 与 epub.js 的 Loader 同样处理：不是合法 XHTML 就按 HTML 重新解析（epub.js:817-822）
        const raw = await loadText(String(section.id));
        if (raw) doc = new DOMParser().parseFromString(raw, 'text/html');
      }
      transformDocument(doc, state.opts, state.ctx);
      return doc;
    };
  }
}

/** epub 与 KF8：资源经过 transformTarget 的 data 事件。必须用 Promise 链式接力，paginator 也监听了 css */
export function hookDataEvent(book: FoliateBook, state: TransformState): void {
  const target = book.transformTarget;
  if (!target) return;
  const env = browserEnv();
  target.addEventListener('data', (e) => {
    const detail = (e as CustomEvent<{ data: unknown; type: string }>).detail;
    const type = String(detail.type ?? '').toLowerCase();
    if (state.kind === 'epub' && MARKUP_TYPES.has(type)) {
      detail.data = Promise.resolve(detail.data).then((d) =>
        typeof d === 'string' ? transformMarkup(d, type, state.opts, state.ctx, env).markup : d,
      );
    } else if (type === 'text/css') {
      detail.data = Promise.resolve(detail.data).then((d) => (typeof d === 'string' ? transformCss(d, state.opts) : d));
    }
  });
}

/** view 的 load 事件：doc 是 iframe 里刚加载好的文档，此时还没有布局（paginator.js:985 早于 257-272） */
export function onSectionLoaded(doc: Document, state: TransformState): void {
  if (state.kind === 'doc') transformDocument(doc, state.opts, state.ctx);
  if (state.opts.horizontal && state.cjk) {
    // 分页器读的是 dir 属性（paginator.js:183-185），竖排书常带 dir=rtl
    if (doc.documentElement.getAttribute('dir') === 'rtl') doc.documentElement.setAttribute('dir', 'ltr');
    if (doc.body?.getAttribute('dir') === 'rtl') doc.body.setAttribute('dir', 'ltr');
  }
}

export interface Detection {
  script: ScriptInfo;
  pdfReflow: boolean;
}

/** 读章节原文：epub 用 loadText 保留 head；其余格式把 createDocument 序列化 */
async function rawSection(book: FoliateBook, index: number): Promise<string | null> {
  const section = book.sections[index];
  if (!section) return null;
  const loadText = epubLoadText(book);
  if (loadText) {
    try {
      return await loadText(String(section.id));
    } catch {
      return null;
    }
  }
  if (!section.createDocument) return null;
  try {
    return new XMLSerializer().serializeToString(await section.createDocument());
  } catch {
    return null;
  }
}

function textOf(raw: string): string {
  return new DOMParser().parseFromString(raw, 'text/html').body?.textContent ?? '';
}

/**
 * 首次打开时检测：是不是繁体、是不是 PDF 转制（ARCHITECTURE 3.5）。
 * 必须在包装 createDocument 之前调用，要读原文。
 */
export async function detectBook(book: FoliateBook): Promise<Detection> {
  const raws: string[] = [];
  const limit = Math.min(book.sections.length, 8);
  for (let i = 0; i < limit; i++) {
    const raw = await rawSection(book, i);
    if (raw) raws.push(raw);
  }
  const sample = raws.map(textOf).join('\n').slice(0, 30000);
  const lang = pickLanguage(book.metadata?.language);
  return {
    script: detectScript(sample, lang || undefined),
    // 规格：取前 5 个章节
    pdfReflow: detectPdfReflow(raws.slice(0, 5)),
  };
}

export function isCjkLanguage(book: FoliateBook, script: ScriptInfo | undefined): boolean {
  const lang = pickLanguage(book.metadata?.language).toLowerCase();
  if (/^(zh|ja|ko)/.test(lang)) return true;
  return script?.script === 'hant' || script?.script === 'mixed';
}
