// Electron 实现。见 docs/ARCHITECTURE.md 3.3。
// 存储目录是 app.getPath('userData')（%APPDATA%\繁体简读），结构与 Tauri 版一致：
//   books/<id>.<ext>  covers/<id>.jpg  library.json  annotations/<id>.json  settings.json  fonts/
// 文件读写、导入、窗口都走 preload 暴露的 window.fjdElectron（主进程里有路径校验）。
// 书、封面通过自定义协议 fjd://data/ 取得；JSON 由主进程原子写（先写 .tmp 再重命名）。
// 多个窗口（书库、各阅读窗口）共用这些文件，读改写用 Web Locks 串行（同源的所有窗口共享），改动后由主进程通知其他窗口刷新。
import {
  mergeSettings,
  type BookAnnotations,
  type BookRecord,
  type ImportResult,
  type Settings,
} from '../model';
import type { FjdElectronApi } from '../../electron/api';
import type { Platform } from './types';
import { currentOs } from './os';
import { storedBookName } from './tauri';

/** fjd://data/<子目录>/<文件名>：主进程只提供 books、covers、fonts 三个目录 */
export const DATA_URL = 'fjd://data';

const BOOK_EXTENSIONS = ['epub', 'mobi', 'azw3', 'azw', 'fb2', 'txt'];

interface LibraryFile {
  version: 1;
  books: BookRecord[];
}

const emptyAnnotations = (): BookAnnotations => ({ bookmarks: [], highlights: [] });

const mimeOfBookFile = (name: string): string => (name.endsWith('.epub') ? 'application/epub+zip' : '');

/** 同源的所有窗口共享的互斥锁；没有 Web Locks 时退回进程内串行 */
const localChains = new Map<string, Promise<unknown>>();
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(name, fn) as Promise<T>;
  }
  const prev = localChains.get(name) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  localChains.set(name, next.catch(() => {}));
  return next;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 无边框窗口的拖动区：沿用界面里现有的 [data-tauri-drag-region] 标记，按钮、输入框等排除在外 */
const DRAG_CSS = `
[data-tauri-drag-region]:not(.toolbar), .toolbar.visible[data-tauri-drag-region] { -webkit-app-region: drag; }
[data-tauri-drag-region] button, [data-tauri-drag-region] a, [data-tauri-drag-region] input,
[data-tauri-drag-region] select, [data-tauri-drag-region] textarea, [data-tauri-drag-region] [role="button"],
.window-controls, .fjd-no-drag { -webkit-app-region: no-drag; }
`;

function installDragCss(): void {
  const style = document.createElement('style');
  style.id = 'fjd-electron-drag';
  style.textContent = DRAG_CSS;
  document.head.append(style);
}

export function createElectronPlatform(api: FjdElectronApi = window.fjdElectron!): Platform {
  if (typeof document !== 'undefined') installDragCss();

  const coverUrlOf = (id: string, bust?: number): string => `${DATA_URL}/covers/${id}.jpg${bust ? `?v=${bust}` : ''}`;
  const bookRel = (rec: Pick<BookRecord, 'id' | 'format' | 'fileName'>): string => `books/${storedBookName(rec)}`;

  /** 进行中的写入。关闭窗口前要等它们落盘 */
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight.add(p);
    const done = (): void => void inflight.delete(p);
    p.then(done, done);
    return p;
  };

  const readLibrary = async (): Promise<BookRecord[]> => {
    const lib = (await api.readJson('library.json')) as LibraryFile | undefined;
    return Array.isArray(lib?.books) ? lib.books : [];
  };
  const writeLibrary = async (books: BookRecord[]): Promise<void> => {
    const lib: LibraryFile = { version: 1, books: books.map(({ coverUrl: _c, ...rest }) => (void _c, rest)) };
    await api.writeJson('library.json', lib);
  };
  /** 读改写 library.json（跨窗口串行） */
  const mutateLibrary = <T>(fn: (books: BookRecord[]) => { books: BookRecord[]; result: T }): Promise<T> =>
    track(
      withLock('fjd-library', async () => {
        const { books, result } = fn(await readLibrary());
        await writeLibrary(books);
        return result;
      }),
    ).then((r) => {
      api.notifyChanged('library');
      return r;
    });

  // ---------------------------------------------------------------- 导入
  /** 书已经躺在 books/ 里了：读元数据、封面，登记进 library.json */
  async function ingest(storedName: string, name: string, id: string, freshlyCreated: boolean): Promise<ImportResult> {
    const wrap = (e: unknown): ImportResult => ({ ok: false, name, error: e instanceof Error ? e.message : String(e) });
    try {
      const bytes = await api.readFile(`books/${storedName}`);
      // 懒加载：导入流程依赖 foliate（只能在渲染进程里跑）
      const { prepareBook } = await import('../import/prepare');
      const prepared = await prepareBook(new File([bytes.slice()], name));
      if (prepared.record.id !== id) throw new Error('文件校验不一致，请重试');
      const finalName = storedBookName(prepared.record);
      if (finalName !== storedName) {
        // txt：存拼好的 epub，丢掉原始 txt 副本
        await api.writeFile(`books/${finalName}`, new Uint8Array(await prepared.file.arrayBuffer()));
        await api.remove([`books/${storedName}`]).catch(() => {});
      }
      if (prepared.cover) {
        await api.writeFile(`covers/${id}.jpg`, new Uint8Array(await prepared.cover.arrayBuffer()));
      }
      const added = await mutateLibrary((books) => {
        if (books.some((b) => b.id === id)) return { books, result: false };
        return { books: [...books, prepared.record], result: true };
      });
      const coverUrl = prepared.cover ? coverUrlOf(id) : undefined;
      return { ok: true, book: { ...prepared.record, coverUrl }, duplicate: !added };
    } catch (e) {
      if (freshlyCreated) await api.remove([`books/${storedName}`]).catch(() => {});
      return wrap(e);
    }
  }

  async function importPaths(paths: string[]): Promise<ImportResult[]> {
    const imported = await api.importPaths(paths);
    const library = await readLibrary();
    const out: ImportResult[] = [];
    for (const r of imported) {
      if (r.error || !r.id || !r.storedPath) {
        out.push({ ok: false, name: r.name, error: r.error ?? '导入失败' });
        continue;
      }
      const have = library.find((b) => b.id === r.id);
      if (have) {
        const hasCover = await api.exists(`covers/${have.id}.jpg`);
        out.push({ ok: true, book: { ...have, coverUrl: hasCover ? coverUrlOf(have.id) : undefined }, duplicate: true });
        continue;
      }
      out.push(await ingest(`${r.id}.${r.ext}`, r.name, r.id, !r.existed));
    }
    return out;
  }

  /** 拖放进窗口的 File 对象（没有可用的路径）：自己算 id，写进 books/ 再走同一条流程 */
  async function importBlobs(files: File[]): Promise<ImportResult[]> {
    const { bookIdOf } = await import('../lib/hash');
    const out: ImportResult[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (bytes.length === 0) throw new Error(`文件是空的：${file.name}`);
        const id = await bookIdOf(bytes);
        const library = await readLibrary();
        const have = library.find((b) => b.id === id);
        if (have) {
          const hasCover = await api.exists(`covers/${id}.jpg`);
          out.push({ ok: true, book: { ...have, coverUrl: hasCover ? coverUrlOf(id) : undefined }, duplicate: true });
          continue;
        }
        const dot = file.name.lastIndexOf('.');
        const ext = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
        if (!BOOK_EXTENSIONS.includes(ext) && !['prc', 'kf8'].includes(ext)) throw new Error(`不支持的格式：${file.name}`);
        const storedName = `${id}.${ext}`;
        await api.writeFile(`books/${storedName}`, bytes);
        out.push(await ingest(storedName, file.name, id, true));
      } catch (e) {
        out.push({ ok: false, name: file.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 窗口生命周期
  /** 关闭前：让阅读器把进度写盘（它监听 pagehide），再等所有进行中的写入完成。主进程等这个函数结束才真正关窗口 */
  api.onBeforeClose(async () => {
    window.dispatchEvent(new Event('pagehide'));
    await sleep(0);
    await Promise.race([Promise.allSettled([...inflight]), sleep(3000)]);
  });

  // ---------------------------------------------------------------- Platform
  const platform: Platform = {
    kind: 'electron',
    os: currentOs(),

    async listBooks() {
      const books = await readLibrary();
      const have = new Set(await api.listDir('covers'));
      return books.map((b) => ({ ...b, coverUrl: have.has(`${b.id}.jpg`) ? coverUrlOf(b.id) : undefined }));
    },

    async importFiles(input) {
      if (input.length === 0) return [];
      const paths = input.filter((x): x is string => typeof x === 'string');
      const files = input.filter((x): x is File => typeof x !== 'string');
      const results: ImportResult[] = [];
      if (paths.length > 0) results.push(...(await importPaths(paths)));
      if (files.length > 0) results.push(...(await importBlobs(files)));
      return results;
    },

    async readBookFile(id) {
      const rec = (await readLibrary()).find((b) => b.id === id);
      if (!rec) throw new Error(`找不到书：${id}`);
      const stored = storedBookName(rec);
      const res = await fetch(`${DATA_URL}/${bookRel(rec)}`);
      if (!res.ok) throw new Error(`读取书文件失败（${res.status}）：${stored}`);
      const blob = await res.blob();
      // foliate 靠文件名的扩展名认 fb2；txt 已拼成 epub
      const name = rec.format === 'txt' ? stored : rec.fileName;
      return new File([blob], name, { type: mimeOfBookFile(stored) });
    },

    async updateBook(id, patch) {
      // coverUrl 是 listBooks 时派生的，不持久化
      const { coverUrl: _derived, ...rest } = patch;
      void _derived;
      await mutateLibrary((books) => ({
        books: books.map((b) => (b.id === id ? { ...b, ...rest, id: b.id } : b)),
        result: undefined,
      }));
    },

    async removeBook(id) {
      const rec = (await readLibrary()).find((b) => b.id === id);
      await mutateLibrary((books) => ({ books: books.filter((b) => b.id !== id), result: undefined }));
      const files = [`covers/${id}.jpg`, `annotations/${id}.json`];
      if (rec) files.push(bookRel(rec));
      await api.remove(files).catch(() => {});
    },

    async saveCover(id, blob) {
      await api.writeFile(`covers/${id}.jpg`, new Uint8Array(await blob.arrayBuffer()));
      api.notifyChanged('library');
      return coverUrlOf(id, Date.now());
    },

    async loadAnnotations(id) {
      return ((await api.readJson(`annotations/${id}.json`)) as BookAnnotations | undefined) ?? emptyAnnotations();
    },

    async saveAnnotations(id, a) {
      await track(withLock(`fjd-annotations-${id}`, () => api.writeJson(`annotations/${id}.json`, a)));
    },

    async loadSettings() {
      return mergeSettings((await api.readJson('settings.json')) as Partial<Settings> | undefined);
    },

    async saveSettings(s) {
      await track(withLock('fjd-settings', () => api.writeJson('settings.json', s)));
      api.notifyChanged('settings');
    },

    async openReader(id) {
      await api.openReader(id);
    },

    onOpenFiles(cb) {
      let stopped = false;
      const drain = async (): Promise<void> => {
        const paths = await api.takePendingOpenFiles();
        if (paths.length > 0 && !stopped) cb(paths);
      };
      const off = api.onOpenFiles(() => void drain());
      void drain().catch((e) => console.warn('读取待打开文件失败', e));
      return () => {
        stopped = true;
        off();
      };
    },

    onDataChanged(cb) {
      return api.onDataChanged(cb);
    },

    pickFiles() {
      return api.pickFiles();
    },

    listFonts: () => api.fonts.list(),
    importFonts: () => api.fonts.import(),
    removeFont: (id) => api.fonts.remove(id),
    fontFaceCss: () => api.fonts.css(),

    desktop: api.desktop,

    onMenuCommand: (cb) => api.onMenuCommand(cb),

    window: {
      minimize: () => api.window.minimize(),
      toggleMaximize: () => api.window.toggleMaximize(),
      // 走主进程的 close 事件：先等界面保存进度，再销毁窗口
      close: () => api.window.close(),
      isMaximized: () => api.window.isMaximized(),
      setTitle(t) {
        document.title = t;
        api.window.setTitle(t);
      },
      setButtonsVisible: (visible) => api.window.setButtonsVisible(visible),
    },
  };
  return platform;
}
