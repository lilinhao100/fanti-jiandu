import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import type { FoliateBook } from '../reader/foliateTypes';
import { findFallbackCover, inspectFirstPage, pickManifestCover, resolvePackagePath } from './cover';

const doc = (html: string): Document => parseHTML(`<html><body>${html}</body></html>`).document as unknown as Document;

describe('inspectFirstPage：封面页判断', () => {
  it('只有一张图的页面', () => {
    expect(inspectFirstPage(doc('<div><img src="images/c.jpg"/></div>'))).toEqual({ src: 'images/c.jpg', imageOnly: true });
    expect(inspectFirstPage(doc('<svg><image xlink:href="c.png"/></svg>'))).toEqual({ src: 'c.png', imageOnly: true });
  });
  it('图排在文字前面（calibre 的 PDF 转制书：第一页是封面图加书名）', () => {
    const p = inspectFirstPage(doc('<p> </p><p id="page_1"><img src="index-1_1.jpg"/></p><p>燈塔日記</p>'));
    expect(p).toEqual({ src: 'index-1_1.jpg', imageOnly: false });
  });
  it('文字在图前面、多张图、没有图：都不是', () => {
    expect(inspectFirstPage(doc('<h1>序</h1><img src="a.jpg"/>'))).toBeNull();
    expect(inspectFirstPage(doc('<img src="a.jpg"/><img src="b.jpg"/>'))).toBeNull();
    expect(inspectFirstPage(doc('<p>只有字</p>'))).toBeNull();
  });
});

describe('路径解析与 manifest', () => {
  it('相对章节解析成包内路径；外链不算', () => {
    expect(resolvePackagePath('../images/c%20x.jpg', 'OEBPS/text/ch1.xhtml')).toBe('OEBPS/images/c x.jpg');
    expect(resolvePackagePath('index-1_1.jpg', 'index_split_000.html')).toBe('index-1_1.jpg');
    expect(resolvePackagePath('https://x/y.jpg', 'a.html')).toBeNull();
    expect(resolvePackagePath('data:image/png;base64,xx', 'a.html')).toBeNull();
  });
  it('manifest：id 或文件名含 cover 的图片；避开缩略图；没有就是空', () => {
    const m = [
      { id: 'c', href: 'a/cover-thumb.jpg', mediaType: 'image/jpeg' },
      { id: 'cover-image', href: 'a/x.jpg', mediaType: 'image/jpeg' },
      { id: 'p1', href: 'a/p1.jpg', mediaType: 'image/jpeg' },
      { id: 'cover', href: 'a/cover.xhtml', mediaType: 'application/xhtml+xml' },
    ];
    expect(pickManifestCover(m)?.id).toBe('cover-image');
    expect(pickManifestCover([{ id: 'p1', href: 'p1.jpg', mediaType: 'image/jpeg' }])).toBeNull();
    expect(pickManifestCover([{ id: 'x', href: 'my_cover.PNG' }])?.href).toBe('my_cover.PNG');
  });
});

describe('findFallbackCover', () => {
  const blob = (s: string): Blob => new Blob([s]);
  const book = (over: Partial<FoliateBook> & { page?: string }): FoliateBook => ({
    sections: [{ id: 'OEBPS/ch1.xhtml', load: () => '', size: 1, createDocument: () => doc(over.page ?? '<p>字</p>') }],
    resources: { manifest: [] },
    loadBlob: async (path: string) => blob(`blob:${path}`),
    ...over,
  });

  it('第一页是图片页：用它', async () => {
    const r = await findFallbackCover(book({ page: '<img src="img/c.jpg"/>' }));
    expect(r?.source).toBe('image-page');
    expect(await r!.blob.text()).toBe('blob:OEBPS/img/c.jpg');
  });
  it('第一页不是图片页：看 manifest', async () => {
    const r = await findFallbackCover(book({ resources: { manifest: [{ id: 'cover-img', href: 'OEBPS/z.jpg', mediaType: 'image/jpeg' }] } }));
    expect(r?.source).toBe('manifest');
    expect(await r!.blob.text()).toBe('blob:OEBPS/z.jpg');
  });
  it('都没有、或者不是 epub：空', async () => {
    expect(await findFallbackCover(book({}))).toBeNull();
    expect(await findFallbackCover(book({ loadBlob: undefined }))).toBeNull();
  });
});
