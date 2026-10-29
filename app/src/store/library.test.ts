import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type BookRecord, type ImportResult } from '../model';
import { setPlatform, type Platform } from '../platform';
import { useLibrary } from './library';

function book(id: string, extra: Partial<BookRecord> = {}): BookRecord {
  return { id, title: id, author: '', format: 'epub', fileName: `${id}.epub`, size: 1, addedAt: 1, ...extra };
}

function fakePlatform(over: Partial<Platform> = {}): Platform {
  const noop = async (): Promise<void> => {};
  return {
    kind: 'web',
    listBooks: async () => [],
    importFiles: async () => [],
    readBookFile: async () => new File([], 'x'),
    updateBook: noop,
    removeBook: noop,
    saveCover: async () => 'blob:x',
    loadAnnotations: async () => ({ bookmarks: [], highlights: [] }),
    saveAnnotations: noop,
    loadSettings: async () => DEFAULT_SETTINGS,
    saveSettings: noop,
    openReader: noop,
    onOpenFiles: () => () => {},
    pickFiles: async () => [],
    listFonts: async () => [],
    importFonts: async () => [],
    removeFont: noop,
    fontFaceCss: async () => '',
    window: { minimize() {}, toggleMaximize() {}, close() {}, isMaximized: async () => false, setTitle() {} },
    ...over,
  };
}

describe('useLibrary', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useLibrary.setState({ books: [], loaded: false, importing: 0, notices: [] });
  });
  afterEach(() => {
    vi.useRealTimers();
    setPlatform(null);
  });

  it('load：读出书并标记已加载', async () => {
    setPlatform(fakePlatform({ listBooks: async () => [book('a'), book('b')] }));
    await useLibrary.getState().load();
    expect(useLibrary.getState().books.map((b) => b.id)).toEqual(['a', 'b']);
    expect(useLibrary.getState().loaded).toBe(true);
  });

  it('importFiles：成功后重新读书库；重复的提示“已在书库中”；失败的给出错误通知', async () => {
    const results: ImportResult[] = [
      { ok: true, book: book('a'), duplicate: false },
      { ok: true, book: book('b'), duplicate: true },
      { ok: false, name: 'x.pdf', error: '不支持的格式：x.pdf' },
    ];
    const importFiles = vi.fn(async () => results);
    setPlatform(fakePlatform({ importFiles, listBooks: async () => [book('a'), book('b')] }));
    const r = await useLibrary.getState().importFiles([new File([], 'a.epub'), new File([], 'b.epub'), new File([], 'x.pdf')]);
    expect(r).toBe(results);
    const s = useLibrary.getState();
    expect(s.books).toHaveLength(2);
    expect(s.importing).toBe(0);
    const texts = s.notices.map((n) => n.text);
    expect(texts).toContain('1 本已在书库中');
    expect(texts).toContain('x.pdf：不支持的格式：x.pdf');
    expect(texts).toContain('已添加 1 本');
    expect(s.notices.find((n) => n.text.startsWith('x.pdf'))?.kind).toBe('error');
  });

  it('importFiles：导入过程中 importing 计数大于 0；平台整体抛错也不会卡住计数', async () => {
    let seen = -1;
    setPlatform(
      fakePlatform({
        importFiles: async () => {
          seen = useLibrary.getState().importing;
          throw new Error('磁盘满了');
        },
      }),
    );
    await useLibrary.getState().importFiles([new File([], 'a.epub')]);
    expect(seen).toBe(1);
    expect(useLibrary.getState().importing).toBe(0);
    expect(useLibrary.getState().notices[0]).toMatchObject({ kind: 'error', text: '磁盘满了' });
  });

  it('空文件列表什么也不做', async () => {
    const importFiles = vi.fn(async () => []);
    setPlatform(fakePlatform({ importFiles }));
    expect(await useLibrary.getState().importFiles([])).toEqual([]);
    expect(importFiles).not.toHaveBeenCalled();
  });

  it('通知到时间自动消失（错误停留更久）', async () => {
    setPlatform(fakePlatform({ importFiles: async () => [{ ok: false, name: 'x', error: 'e' }, { ok: true, book: book('a'), duplicate: true }] }));
    await useLibrary.getState().importFiles([new File([], 'x'), new File([], 'a.epub')]);
    expect(useLibrary.getState().notices).toHaveLength(2);
    vi.advanceTimersByTime(4000);
    expect(useLibrary.getState().notices.map((n) => n.kind)).toEqual(['error']);
    vi.advanceTimersByTime(5000);
    expect(useLibrary.getState().notices).toEqual([]);
  });

  it('remove 与 setDisplay：调用平台，并更新本地状态', async () => {
    const removeBook = vi.fn(async () => {});
    const updateBook = vi.fn(async () => {});
    setPlatform(fakePlatform({ removeBook, updateBook }));
    useLibrary.setState({ books: [book('a'), book('b')] });
    await useLibrary.getState().setDisplay('a', 'original');
    expect(updateBook).toHaveBeenCalledWith('a', { display: 'original' });
    expect(useLibrary.getState().books.find((b) => b.id === 'a')?.display).toBe('original');
    await useLibrary.getState().remove('b');
    expect(removeBook).toHaveBeenCalledWith('b');
    expect(useLibrary.getState().books.map((b) => b.id)).toEqual(['a']);
  });
});
