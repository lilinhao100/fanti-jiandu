import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type BookRecord } from '../model';
import { Idb, openDb } from './idb';
import { createWebPlatform } from './web';

function rec(id: string, extra: Partial<BookRecord> = {}): BookRecord {
  return { id, title: `书${id}`, author: '作者', format: 'epub', fileName: `${id}.epub`, size: 3, addedAt: 1, ...extra };
}

describe('web 平台（IndexedDB）', () => {
  let factory: IDBFactory;
  let idb: Idb;
  beforeEach(async () => {
    factory = new IDBFactory();
    idb = new Idb(await openDb(factory));
  });
  const platform = () => createWebPlatform({ indexedDB: factory });

  async function seed(r: BookRecord, bytes = [1, 2, 3], cover?: Blob): Promise<void> {
    await idb.putMany([
      { store: 'books', value: r },
      { store: 'files', value: new Blob([new Uint8Array(bytes)]), key: r.id },
      ...(cover ? [{ store: 'covers' as const, value: cover, key: r.id }] : []),
    ]);
  }

  it('listBooks：空库返回空数组；有封面的书带 coverUrl，没有的不带', async () => {
    const p = platform();
    expect(await p.listBooks()).toEqual([]);
    await seed(rec('a'), [1], new Blob([new Uint8Array([9])], { type: 'image/png' }));
    await seed(rec('b'));
    const list = await p.listBooks();
    const a = list.find((b) => b.id === 'a')!;
    const b = list.find((b) => b.id === 'b')!;
    expect(a.coverUrl).toMatch(/^blob:/);
    expect(b.coverUrl).toBeUndefined();
    // 同一本书多次 list，封面 URL 复用，不泄漏
    expect((await p.listBooks()).find((x) => x.id === 'a')!.coverUrl).toBe(a.coverUrl);
  });

  it('readBookFile：返回带原扩展名的 File；txt 存的是 epub，文件名是 <id>.epub', async () => {
    const p = platform();
    await seed(rec('f', { format: 'fb2', fileName: '某书.fb2' }), [7, 8]);
    await seed(rec('t', { format: 'txt', fileName: '某书.txt' }), [5]);
    const f = await p.readBookFile('f');
    expect(f.name).toBe('某书.fb2');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(new Uint8Array([7, 8]));
    expect((await p.readBookFile('t')).name).toBe('t.epub');
    await expect(p.readBookFile('missing')).rejects.toThrow();
  });

  it('updateBook：合并字段，不改 id，不持久化 coverUrl；不存在的书静默忽略', async () => {
    const p = platform();
    await seed(rec('a'));
    await p.updateBook('a', { progress: { cfi: 'epubcfi(/6/2)', fraction: 0.5, updatedAt: 9 }, display: 'original', coverUrl: 'blob:x' });
    const [b] = await p.listBooks();
    expect(b!.progress?.fraction).toBe(0.5);
    expect(b!.display).toBe('original');
    expect(b!.title).toBe('书a');
    expect(b!.coverUrl).toBeUndefined();
    const raw = await idb.get<BookRecord>('books', 'a');
    expect('coverUrl' in raw!).toBe(false);
    await expect(p.updateBook('nope', { title: 'x' })).resolves.toBeUndefined();
  });

  it('并发的两次 updateBook 不会互相覆盖（同一事务里读改写）', async () => {
    const p = platform();
    await seed(rec('a'));
    await Promise.all([p.updateBook('a', { script: { script: 'hant', confidence: 1, variant: 'tw' } }), p.updateBook('a', { pdfReflow: true })]);
    const [b] = await p.listBooks();
    expect(b!.script?.script).toBe('hant');
    expect(b!.pdfReflow).toBe(true);
  });

  it('removeBook：书、文件、封面、标注一起删', async () => {
    const p = platform();
    await seed(rec('a'), [1], new Blob([new Uint8Array([9])]));
    await p.saveAnnotations('a', { bookmarks: [{ id: '1', cfi: 'c', label: 'l', createdAt: 1 }], highlights: [] });
    await p.removeBook('a');
    expect(await p.listBooks()).toEqual([]);
    expect(await idb.get('files', 'a')).toBeUndefined();
    expect(await idb.get('covers', 'a')).toBeUndefined();
    expect((await p.loadAnnotations('a')).bookmarks).toEqual([]);
  });

  it('saveCover 返回可用的 URL，并写进封面库', async () => {
    const p = platform();
    await seed(rec('a'));
    const url = await p.saveCover('a', new Blob([new Uint8Array([1, 2])], { type: 'image/jpeg' }));
    expect(url).toMatch(/^blob:/);
    expect((await p.listBooks())[0]!.coverUrl).toBe(url);
  });

  it('标注与设置：读不到时给默认值，写后能读回；设置缺字段时用默认值补齐', async () => {
    const p = platform();
    expect(await p.loadAnnotations('x')).toEqual({ bookmarks: [], highlights: [] });
    expect(await p.loadSettings()).toEqual(DEFAULT_SETTINGS);
    await p.saveSettings({ ...DEFAULT_SETTINGS, library: { view: 'list', sort: 'title' } });
    expect((await p.loadSettings()).library).toEqual({ view: 'list', sort: 'title' });
    await idb.put('kv', { conversion: { vocabulary: false } }, 'settings');
    const s = await p.loadSettings();
    expect(s.conversion).toEqual({ ...DEFAULT_SETTINGS.conversion, vocabulary: false });
    expect(s.appearance).toEqual(DEFAULT_SETTINGS.appearance);
  });

  it('onOpenFiles 在 web 上返回可调用的取消函数', () => {
    const off = platform().onOpenFiles(() => {});
    expect(() => off()).not.toThrow();
  });
});
