import { DEFAULT_OPTIONS, type BookContext, type ConvertOptions } from '@fjd/engine';
import { DOMParser as LinkedomDOMParser } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoliateBook, FoliateSection } from './foliateTypes';
import { detectBook, hookDataEvent, isCjkLanguage, kindOf, onSectionLoaded, wrapCreateDocument, type TransformState } from './transforms';

// linkedom 没有 XMLSerializer；它的 toString() 对 XML 文档就是 XML 序列化（与引擎测试同样的做法）
class ShimXMLSerializer {
  serializeToString(node: Node): string {
    return String(node);
  }
}

beforeEach(() => {
  vi.stubGlobal('DOMParser', LinkedomDOMParser);
  vi.stubGlobal('XMLSerializer', ShimXMLSerializer);
});
afterEach(() => vi.unstubAllGlobals());

const XHTML = 'application/xhtml+xml';
const xhtml = (inner: string, head = ''): string =>
  `<?xml version="1.0" encoding="utf-8"?>\n<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>${head}</head><body>${inner}</body></html>`;
const parse = (s: string, type: 'text/html' | 'text/xml' = 'text/html'): Document =>
  new LinkedomDOMParser().parseFromString(s, type) as unknown as Document;

const opts = (over: Partial<ConvertOptions> = {}): ConvertOptions => ({ ...DEFAULT_OPTIONS, ...over });
const state = (over: Partial<TransformState> = {}): TransformState => ({
  kind: 'epub',
  opts: opts(),
  ctx: { pdfReflow: false } as BookContext,
  cjk: true,
  ...over,
});

const epubLike = (sections: Partial<FoliateSection>[], extra: Partial<FoliateBook> = {}): FoliateBook => ({
  sections: sections.map((s, i) => ({ id: `s${i}.xhtml`, load: () => '', size: 1, ...s })),
  transformTarget: new EventTarget(),
  loadText: async () => null,
  resources: { manifest: [] }, // 只有 EPUB 类有
  ...extra,
});

describe('kindOf：哪些格式的正文走 data 事件', () => {
  it('只有 EPUB 类有 resources；KF8 虽然有 loadText 和 transformTarget 也是 doc 类', () => {
    expect(kindOf(epubLike([]))).toBe('epub');
    // KF8：有 transformTarget，也有 loadText（但参数是章节对象），没有 resources
    expect(kindOf({ sections: [], transformTarget: new EventTarget(), loadText: async () => '' })).toBe('doc');
    // MOBI6：有 loadText，没有 transformTarget
    expect(kindOf({ sections: [], loadText: async () => '' })).toBe('doc');
    // fb2：什么都没有
    expect(kindOf({ sections: [] })).toBe('doc');
  });
});

describe('wrapCreateDocument：书内搜索读到转换后的文本', () => {
  it('繁转简、词汇、引号', async () => {
    const book = epubLike([{ createDocument: async () => parse(xhtml('<p>「燈塔」的軟體</p>')) }]);
    wrapCreateDocument(book, state());
    const doc = await book.sections[0]!.createDocument!();
    expect(doc.body.textContent).toBe('“灯塔”的软件');
  });

  it('PDF 转制书：删汉字间空格、合并被截断的段落，且与 transformMarkup 同样的结构', async () => {
    const a = '這是一段很長的文字它在分頁處被截斷了所以後面的內容';
    const html = xhtml(`<p class="c">${a}</p><p class="c">接在下一頁開頭 的文字</p>`);
    const book = epubLike([{ createDocument: async () => parse(html) }]);
    wrapCreateDocument(book, state({ ctx: { pdfReflow: true } }));
    const doc = await book.sections[0]!.createDocument!();
    expect(doc.querySelectorAll('p')).toHaveLength(1);
    expect(doc.body.textContent).toContain('后面的内容接在下一页开头的文字');
  });

  it('original 模式（convert/cleanup 全关）原样不动', async () => {
    const book = epubLike([{ createDocument: async () => parse(xhtml('<p>「燈塔」</p>')) }]);
    wrapCreateDocument(book, state({ opts: opts({ convert: false, quotes: false, cleanup: false, horizontal: false }) }));
    expect((await book.sections[0]!.createDocument!()).body.textContent).toBe('「燈塔」');
  });

  it('没有 createDocument 的章节（KF8 空骨架）跳过，不报错', () => {
    const book = epubLike([{ createDocument: undefined, linear: 'no' }]);
    expect(() => wrapCreateDocument(book, state())).not.toThrow();
    expect(book.sections[0]!.createDocument).toBeUndefined();
  });

  it('XHTML 解析失败时，和 epub.js 的 Loader 一样按 HTML 重新解析', async () => {
    const bad = parse('<html xmlns="http://www.w3.org/1999/xhtml"><body><p>壞的 &nbsp; 實體</body>', 'text/xml');
    // 构造一个带 parsererror 的文档
    const err = bad.createElement('parsererror');
    bad.documentElement!.append(err);
    const book = epubLike([{ createDocument: async () => bad }], {
      loadText: async () => '<html><body><p>軟體&nbsp;實體</p></body></html>',
    });
    wrapCreateDocument(book, state());
    const doc = await book.sections[0]!.createDocument!();
    expect(doc.body.textContent).toContain('软件');
  });

  it('可以重复包装同一本书的不同状态：读的是最新的 state', async () => {
    const st = state();
    const book = epubLike([{ createDocument: async () => parse(xhtml('<p>幣</p>')) }]);
    wrapCreateDocument(book, st);
    expect((await book.sections[0]!.createDocument!()).body.textContent).toBe('币');
    st.opts = opts({ convert: false });
    expect((await book.sections[0]!.createDocument!()).body.textContent).toBe('幣');
  });
});

describe('hookDataEvent：epub 资源经过 data 事件', () => {
  const fire = async (book: FoliateBook, data: unknown, type: string): Promise<unknown> => {
    const detail: { data: unknown; type: string } = { data, type };
    book.transformTarget!.dispatchEvent(new CustomEvent('data', { detail }));
    return await detail.data;
  };

  it('xhtml → transformMarkup（字符串或 Promise 字符串都行）', async () => {
    const book = epubLike([]);
    hookDataEvent(book, state());
    const out = (await fire(book, xhtml('<p>燈塔</p>'), XHTML)) as string;
    expect(out).toContain('灯塔');
    expect(out).not.toContain('幣');
    expect(((await fire(book, Promise.resolve(xhtml('<p>幣</p>')), 'text/html')) as string)).toContain('币');
  });

  it('css → transformCss：竖排改横排；开关关闭时不动', async () => {
    const book = epubLike([]);
    const st = state();
    hookDataEvent(book, st);
    expect(await fire(book, 'body{writing-mode:vertical-rl;-epub-writing-mode:vertical-rl}', 'text/css')).toBe(
      'body{writing-mode:horizontal-tb;-epub-writing-mode:horizontal-tb}',
    );
    st.opts = opts({ horizontal: false });
    expect(await fire(book, 'body{writing-mode:vertical-rl}', 'text/css')).toBe('body{writing-mode:vertical-rl}');
  });

  it('图片等二进制原样通过（Blob 的 Promise 也不被破坏）', async () => {
    const book = epubLike([]);
    hookDataEvent(book, state());
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    expect(await fire(book, Promise.resolve(blob), 'image/png')).toBe(blob);
  });

  it('和别的监听器接力：前面的监听器换了 data，我们接着处理', async () => {
    const book = epubLike([]);
    book.transformTarget!.addEventListener('data', (e) => {
      const d = (e as CustomEvent).detail as { data: unknown };
      d.data = Promise.resolve(d.data).then((x) => String(x).replace('A', 'B'));
    });
    hookDataEvent(book, state());
    expect(await fire(book, 'a{x:A}', 'text/css')).toBe('a{x:B}');
  });

  it('KF8（kind=doc）：css 照转，正文类型的资源不在这里处理', async () => {
    const book: FoliateBook = { sections: [], transformTarget: new EventTarget() };
    hookDataEvent(book, state({ kind: 'doc' }));
    expect(await fire(book, xhtml('<p>幣</p>'), XHTML)).toBe(xhtml('<p>幣</p>'));
    expect(await fire(book, 'p{writing-mode:vertical-rl}', 'text/css')).toBe('p{writing-mode:horizontal-tb}');
  });

  it('没有 transformTarget 的书（MOBI6、fb2）什么也不做', () => {
    expect(() => hookDataEvent({ sections: [] }, state())).not.toThrow();
  });
});

describe('onSectionLoaded：view 的 load 事件', () => {
  it('doc 类（MOBI6、KF8、fb2）：对加载好的文档就地转换', () => {
    const doc = parse(xhtml('<p>「幣」</p>'));
    onSectionLoaded(doc, state({ kind: 'doc' }));
    expect(doc.body.textContent).toBe('“币”');
  });

  it('epub 已在 data 事件里转换过，这里不能重复转换', () => {
    const doc = parse(xhtml('<p>幣</p>'));
    onSectionLoaded(doc, state({ kind: 'epub' }));
    expect(doc.body.textContent).toBe('幣');
  });

  it('横排 + 中日韩书：清掉 rtl，让分页器从左往右翻', () => {
    const doc = parse(xhtml('<p>x</p>'));
    doc.documentElement!.setAttribute('dir', 'rtl');
    doc.body.setAttribute('dir', 'rtl');
    onSectionLoaded(doc, state());
    expect(doc.documentElement!.getAttribute('dir')).toBe('ltr');
    expect(doc.body.getAttribute('dir')).toBe('ltr');
  });

  it('非中日韩的 rtl 书（阿拉伯文）不动', () => {
    const doc = parse(xhtml('<p>x</p>'));
    doc.documentElement!.setAttribute('dir', 'rtl');
    onSectionLoaded(doc, state({ cjk: false }));
    expect(doc.documentElement!.getAttribute('dir')).toBe('rtl');
  });

  it('关掉竖排转横排时不动', () => {
    const doc = parse(xhtml('<p>x</p>'));
    doc.documentElement!.setAttribute('dir', 'rtl');
    onSectionLoaded(doc, state({ opts: opts({ horizontal: false }) }));
    expect(doc.documentElement!.getAttribute('dir')).toBe('rtl');
  });
});

describe('detectBook：首次打开时检测繁/简与 PDF 转制', () => {
  it('PDF Reflow 的繁体 epub', async () => {
    const pdfHead = '<meta name="generator" content="PDF Reflow conversion"/>';
    const text = '這是繁體中文的內容我們希望它被正確地識別出來因為它使用了很多繁體專有的字詞';
    const raws = [xhtml(`<p>${text}</p>`, pdfHead), xhtml(`<p>${text}</p>`)];
    const book = epubLike(
      raws.map(() => ({ createDocument: async () => parse('<x/>') })),
      { loadText: async (p: string) => raws[Number(p.slice(1, 2))] ?? null, metadata: { language: ['zh'] } },
    );
    const d = await detectBook(book);
    expect(d.script.script).toBe('hant');
    expect(d.pdfReflow).toBe(true);
  });

  it('普通简体 epub：不是繁体，也不是 PDF 转制', async () => {
    const raw = xhtml('<p>这是简体中文的内容，我们希望它被正确地识别出来，因为它使用了很多简体专有的字词。</p>');
    const book = epubLike([{}], { loadText: async () => raw });
    const d = await detectBook(book);
    expect(d.script.script).toBe('hans');
    expect(d.pdfReflow).toBe(false);
  });

  it('MOBI6/KF8 也有 loadText 但参数是章节对象：不能当 epub 的路径来调用，要走 createDocument', async () => {
    const loadText = vi.fn(async () => '');
    const book: FoliateBook = {
      sections: [{ id: 0, load: () => '', size: 1, createDocument: async () => parse(xhtml('<p>這是繁體中文的內容我們希望它被正確地識別出來因為它使用了很多繁體專有的字詞</p>')) }],
      loadText,
      transformTarget: new EventTarget(),
    };
    expect((await detectBook(book)).script.script).toBe('hant');
    expect(loadText).not.toHaveBeenCalled();
  });

  it('doc 类格式（没有 loadText）：把 createDocument 序列化后检测', async () => {
    const book: FoliateBook = {
      sections: [{ id: 0, load: () => '', size: 1, createDocument: async () => parse(xhtml('<p>這是繁體中文的內容我們希望它被正確地識別出來因為它使用了很多繁體專有的字詞</p>')) }],
    };
    expect((await detectBook(book)).script.script).toBe('hant');
  });

  it('isCjkLanguage：看语言标记，没有标记时看检测结果', () => {
    expect(isCjkLanguage({ sections: [], metadata: { language: ['zh-TW'] } }, undefined)).toBe(true);
    expect(isCjkLanguage({ sections: [], metadata: { language: 'ja' } }, undefined)).toBe(true);
    expect(isCjkLanguage({ sections: [], metadata: { language: 'en' } }, undefined)).toBe(false);
    expect(isCjkLanguage({ sections: [] }, { script: 'hant', confidence: 1, variant: 'tw' })).toBe(true);
    expect(isCjkLanguage({ sections: [] }, undefined)).toBe(false);
  });
});
