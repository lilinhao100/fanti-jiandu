// Tauri 实现。见 docs/ARCHITECTURE.md 3.3。
// 存储目录 appDataDir()/：
//   books/<id>.<ext>      原书文件（txt 导入时转成 epub，存为 <id>.epub）
//   covers/<id>.jpg       封面
//   library.json          { version: 1, books: BookRecord[] }
//   annotations/<id>.json
//   settings.json
// JSON 一律原子写：先写 .tmp 再重命名。多个窗口（书库、各阅读窗口）共用这些文件，
// 读改写用 Web Locks 串行（同源的所有 WebView 共享），改动后用事件通知其他窗口刷新。
import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { appDataDir, join } from '@tauri-apps/api/path';
import { getAllWindows, getCurrentWindow } from '@tauri-apps/api/window';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { exists, mkdir, readDir, readFile, readTextFile, remove, rename, writeFile, writeTextFile } from '@tauri-apps/plugin-fs';
import {
  mergeSettings,
  type BookAnnotations,
  type BookRecord,
  type FontInfo,
  type ImportResult,
  type Settings,
} from '../model';
import { fontFaceRule, type FontFileFormat } from '../fonts/css';
import { IMPORT_EXTS, prepareFontFile } from '../fonts/importer';
import type { Platform } from './types';
import { currentOs } from './os';
import { browserDecompressors } from './webFonts';

export const OPEN_FILES_EVENT = 'fjd://open-files';
export const LIBRARY_CHANGED_EVENT = 'fjd://library-changed';
export const SETTINGS_CHANGED_EVENT = 'fjd://settings-changed';
export const FONTS_CHANGED_EVENT = 'fjd://fonts-changed';

const BOOK_EXTENSIONS = ['epub', 'mobi', 'azw3', 'azw', 'fb2', 'txt'];

/** Rust 命令 import_files 的返回项（字段名见 src-tauri/src/lib.rs） */
interface ImportedFile {
  path: string;
  name: string;
  ext: string;
  size: number;
  id: string | null;
  storedPath: string | null;
  existed: boolean;
  error: string | null;
}

interface LibraryFile {
  version: 1;
  books: BookRecord[];
}

/** Rust 命令 list_system_fonts 的返回项（fontdb 枚举，字段名见 src-tauri/src/lib.rs） */
interface SystemFont {
  family: string;
  displayName: string;
  hasCjk: boolean;
}

/** fonts.json 里的一项：一个导入的字体文件（和 Electron 版同一格式） */
interface ImportedFontFile {
  id: string;
  family: string;
  displayName: string;
  hasCJK: boolean;
  file: string;
  format: FontFileFormat;
  weight: number;
  italic: boolean;
}

const emptyAnnotations = (): BookAnnotations => ({ bookmarks: [], highlights: [] });

/** 书文件在 books 目录里的文件名。txt 导入时已拼成 epub，所以是 <id>.epub */
export function storedBookName(rec: Pick<BookRecord, 'id' | 'format' | 'fileName'>): string {
  if (rec.format === 'txt') return `${rec.id}.epub`;
  const i = rec.fileName.lastIndexOf('.');
  const ext = i < 0 ? rec.format : rec.fileName.slice(i + 1).toLowerCase();
  return `${rec.id}.${ext}`;
}

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

export function createTauriPlatform(): Platform {
  const label = getCurrentWindow().label;

  // ---------------------------------------------------------------- 路径与文件
  let rootPromise: Promise<string> | null = null;
  const root = (): Promise<string> => {
    rootPromise ??= (async () => {
      const dir = await appDataDir();
      for (const sub of ['books', 'covers', 'annotations', 'fonts']) {
        await mkdir(await join(dir, sub), { recursive: true });
      }
      return dir;
    })();
    return rootPromise;
  };
  const pathIn = async (...parts: string[]): Promise<string> => join(await root(), ...parts);

  /** 进行中的写入。关闭窗口前要等它们落盘 */
  const inflight = new Set<Promise<unknown>>();
  const track = <T>(p: Promise<T>): Promise<T> => {
    inflight.add(p);
    const done = (): void => void inflight.delete(p);
    p.then(done, done);
    return p;
  };

  async function readJson<T>(path: string): Promise<T | undefined> {
    if (!(await exists(path))) return undefined;
    const text = await readTextFile(path);
    try {
      return JSON.parse(text) as T;
    } catch (e) {
      // 文件坏了：留一份备份再当作没有，别让整个书库打不开
      console.error(`无法解析 ${path}`, e);
      await rename(path, `${path}.corrupt-${Date.now()}`).catch(() => {});
      return undefined;
    }
  }

  /** 原子写：先写 .tmp 再重命名（Windows 上 rename 会覆盖已有文件） */
  async function writeJson(path: string, data: unknown): Promise<void> {
    const tmp = `${path}.tmp`;
    await writeTextFile(tmp, JSON.stringify(data));
    await rename(tmp, path);
  }

  const readLibrary = async (): Promise<BookRecord[]> => {
    const lib = await readJson<LibraryFile>(await pathIn('library.json'));
    return Array.isArray(lib?.books) ? lib.books : [];
  };
  const writeLibrary = async (books: BookRecord[]): Promise<void> => {
    const lib: LibraryFile = { version: 1, books: books.map(({ coverUrl: _c, ...rest }) => (void _c, rest)) };
    await writeJson(await pathIn('library.json'), lib);
  };
  /** 读改写 library.json（跨窗口串行） */
  const mutateLibrary = <T>(fn: (books: BookRecord[]) => { books: BookRecord[]; result: T }): Promise<T> =>
    track(
      withLock('fjd-library', async () => {
        const { books, result } = fn(await readLibrary());
        await writeLibrary(books);
        return result;
      }),
    ).then(async (r) => {
      void emit(LIBRARY_CHANGED_EVENT, { source: label }).catch(() => {});
      return r;
    });

  const coverPath = (id: string): Promise<string> => pathIn('covers', `${id}.jpg`);
  const coverUrlOf = async (id: string, bust?: number): Promise<string> => {
    const url = convertFileSrc(await coverPath(id));
    return bust ? `${url}?v=${bust}` : url;
  };

  // ---------------------------------------------------------------- 字体（M2d）
  // 系统字体由 Rust 端用 fontdb 枚举；导入的字体复制到 appData/fonts/，登记在 fonts.json，
  // 通过 asset 协议（convertFileSrc，和书、封面一样）加载。字体文件的解析是共用的纯 TS（TTC 先拆开）。
  const readFontRegistry = async (): Promise<ImportedFontFile[]> => {
    const r = await readJson<{ fonts?: ImportedFontFile[] }>(await pathIn('fonts.json'));
    return Array.isArray(r?.fonts) ? r.fonts : [];
  };
  const writeFontRegistry = async (fonts: ImportedFontFile[]): Promise<void> => {
    await writeJson(await pathIn('fonts.json'), { version: 1, fonts });
  };

  async function importFontPaths(paths: string[]): Promise<FontInfo[]> {
    return track(
      withLock('fjd-fonts', async () => {
        const registry = await readFontRegistry();
        const touched = new Map<string, FontInfo>();
        const errors: string[] = [];
        for (const p of paths) {
          const name = p.replace(/^.*[\\/]/, '');
          try {
            const bytes = await readFile(p);
            for (const face of await prepareFontFile(name, bytes, browserDecompressors)) {
              const { bookIdOf } = await import('../lib/hash');
              const file = `${await bookIdOf(face.data)}.${face.format}`;
              const id = `imp:${face.family}`;
              if (registry.some((r) => r.file === file || (r.id === id && r.weight === face.weight && r.italic === face.italic))) continue;
              await writeFile(await pathIn('fonts', file), face.data);
              registry.push({ id, family: face.family, displayName: face.displayName, hasCJK: face.hasCJK, file, format: face.format, weight: face.weight, italic: face.italic });
              touched.set(id, { id, family: face.family, displayName: face.displayName, source: 'imported', hasCJK: face.hasCJK });
            }
          } catch (e) {
            errors.push(e instanceof Error ? e.message : String(e));
          }
        }
        if (touched.size === 0 && errors.length > 0) throw new Error(errors.join('；'));
        if (touched.size > 0) await writeFontRegistry(registry);
        return [...touched.values()];
      }),
    ).then((r) => {
      if (r.length > 0) void emit(FONTS_CHANGED_EVENT, { source: label }).catch(() => {});
      return r;
    });
  }

  // ---------------------------------------------------------------- 导入
  /** 书已经躺在 books/ 里了：读元数据、封面，登记进 library.json */
  async function ingest(stored: string, name: string, id: string, freshlyCreated: boolean): Promise<ImportResult> {
    const wrap = (e: unknown): ImportResult => ({ ok: false, name, error: e instanceof Error ? e.message : String(e) });
    try {
      const bytes = await readFile(stored);
      // 懒加载：导入流程依赖 foliate（只能在 WebView 里跑）
      const { prepareBook } = await import('../import/prepare');
      const prepared = await prepareBook(new File([bytes.slice()], name));
      if (prepared.record.id !== id) throw new Error('文件校验不一致，请重试');
      const finalPath = await pathIn('books', storedBookName(prepared.record));
      if (finalPath !== stored) {
        // txt：存拼好的 epub，丢掉原始 txt 副本
        await writeFile(finalPath, new Uint8Array(await prepared.file.arrayBuffer()));
        await remove(stored).catch(() => {});
      }
      if (prepared.cover) {
        await writeFile(await coverPath(id), new Uint8Array(await prepared.cover.arrayBuffer()));
      }
      const added = await mutateLibrary((books) => {
        if (books.some((b) => b.id === id)) return { books, result: false };
        return { books: [...books, prepared.record], result: true };
      });
      const coverUrl = prepared.cover ? await coverUrlOf(id) : undefined;
      return { ok: true, book: { ...prepared.record, coverUrl }, duplicate: !added };
    } catch (e) {
      if (freshlyCreated) await remove(stored).catch(() => {});
      return wrap(e);
    }
  }

  async function importPaths(paths: string[]): Promise<ImportResult[]> {
    const imported = await invoke<ImportedFile[]>('import_files', { paths });
    const library = await readLibrary();
    const out: ImportResult[] = [];
    for (const r of imported) {
      if (r.error || !r.id || !r.storedPath) {
        out.push({ ok: false, name: r.name, error: r.error ?? '导入失败' });
        continue;
      }
      const have = library.find((b) => b.id === r.id);
      if (have) {
        const hasCover = await exists(await coverPath(have.id));
        out.push({ ok: true, book: { ...have, coverUrl: hasCover ? await coverUrlOf(have.id) : undefined }, duplicate: true });
        continue;
      }
      out.push(await ingest(r.storedPath, r.name, r.id, !r.existed));
    }
    return out;
  }

  /** 拖放进窗口的 File 对象（没有路径）：自己算 id，写进 books/ 再走同一条流程 */
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
          const hasCover = await exists(await coverPath(id));
          out.push({ ok: true, book: { ...have, coverUrl: hasCover ? await coverUrlOf(id) : undefined }, duplicate: true });
          continue;
        }
        const dot = file.name.lastIndexOf('.');
        const ext = dot < 0 ? '' : file.name.slice(dot + 1).toLowerCase();
        if (!BOOK_EXTENSIONS.includes(ext) && !['prc', 'kf8'].includes(ext)) throw new Error(`不支持的格式：${file.name}`);
        const stored = await pathIn('books', `${id}.${ext}`);
        await writeFile(stored, bytes);
        out.push(await ingest(stored, file.name, id, true));
      } catch (e) {
        out.push({ ok: false, name: file.name, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- 窗口生命周期
  /** 关闭前：让阅读器把进度写盘（它监听 pagehide），再等所有进行中的写入完成 */
  async function flushBeforeClose(): Promise<void> {
    window.dispatchEvent(new Event('pagehide'));
    await sleep(0);
    const wait = Promise.allSettled([...inflight]);
    await Promise.race([wait, sleep(3000)]);
  }

  async function closeOtherWindows(): Promise<void> {
    const others = (await getAllWindows()).filter((w) => w.label !== label);
    await Promise.allSettled(others.map((w) => w.close()));
    for (let i = 0; i < 30; i++) {
      if ((await getAllWindows()).every((w) => w.label === label)) return;
      await sleep(100);
    }
  }

  void getCurrentWindow().onCloseRequested(async (ev) => {
    ev.preventDefault();
    try {
      await flushBeforeClose();
      // 书库是主窗口：它关闭就是退出，先让阅读窗口各自保存进度再关
      if (label === 'main') await closeOtherWindows();
    } finally {
      await getCurrentWindow().destroy();
    }
  });

  // ---------------------------------------------------------------- Platform
  const platform: Platform = {
    kind: 'tauri',
    os: currentOs(),

    async listBooks() {
      const books = await readLibrary();
      const dir = await pathIn('covers');
      const have = new Set((await readDir(dir)).map((e) => e.name));
      const out: BookRecord[] = [];
      for (const b of books) {
        out.push({ ...b, coverUrl: have.has(`${b.id}.jpg`) ? await coverUrlOf(b.id) : undefined });
      }
      return out;
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
      const bytes = await readFile(await pathIn('books', stored));
      // foliate 靠文件名的扩展名认 fb2；txt 已拼成 epub
      const name = rec.format === 'txt' ? stored : rec.fileName;
      return new File([bytes.slice()], name, { type: mimeOfBookFile(stored) });
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
      const files = [await coverPath(id), await pathIn('annotations', `${id}.json`)];
      if (rec) files.push(await pathIn('books', storedBookName(rec)));
      for (const f of files) await remove(f).catch(() => {});
    },

    async saveCover(id, blob) {
      await writeFile(await coverPath(id), new Uint8Array(await blob.arrayBuffer()));
      void emit(LIBRARY_CHANGED_EVENT, { source: label }).catch(() => {});
      return coverUrlOf(id, Date.now());
    },

    async loadAnnotations(id) {
      return (await readJson<BookAnnotations>(await pathIn('annotations', `${id}.json`))) ?? emptyAnnotations();
    },

    async saveAnnotations(id, a) {
      const path = await pathIn('annotations', `${id}.json`);
      await track(withLock(`fjd-annotations-${id}`, () => writeJson(path, a)));
    },

    async loadSettings() {
      return mergeSettings(await readJson<Partial<Settings>>(await pathIn('settings.json')));
    },

    async saveSettings(s) {
      const path = await pathIn('settings.json');
      await track(withLock('fjd-settings', () => writeJson(path, s)));
      void emit(SETTINGS_CHANGED_EVENT, { source: label }).catch(() => {});
    },

    async openReader(id) {
      await invoke('open_reader', { id });
    },

    onOpenFiles(cb) {
      let stopped = false;
      let unlisten: UnlistenFn | undefined;
      const drain = async (): Promise<void> => {
        const paths = await invoke<string[]>('take_pending_open_files');
        if (paths.length > 0 && !stopped) cb(paths);
      };
      void listen(OPEN_FILES_EVENT, () => void drain()).then((u) => {
        if (stopped) u();
        else unlisten = u;
      });
      void drain().catch((e) => console.warn('读取待打开文件失败', e));
      return () => {
        stopped = true;
        unlisten?.();
      };
    },

    onDataChanged(cb) {
      let stopped = false;
      const unlistens: UnlistenFn[] = [];
      const sub = (event: string, kind: 'library' | 'settings' | 'fonts'): void => {
        void listen<{ source?: string }>(event, (e) => {
          if (e.payload?.source !== label) cb(kind);
        }).then((u) => (stopped ? u() : unlistens.push(u)));
      };
      sub(LIBRARY_CHANGED_EVENT, 'library');
      sub(SETTINGS_CHANGED_EVENT, 'settings');
      sub(FONTS_CHANGED_EVENT, 'fonts');
      return () => {
        stopped = true;
        unlistens.forEach((u) => u());
      };
    },

    async listFonts() {
      const [system, files] = await Promise.all([invoke<SystemFont[]>('list_system_fonts'), readFontRegistry()]);
      const imported = new Map<string, FontInfo>();
      for (const f of files) {
        const have = imported.get(f.id);
        if (have) have.hasCJK ||= f.hasCJK;
        else imported.set(f.id, { id: f.id, family: f.family, displayName: f.displayName, source: 'imported', hasCJK: f.hasCJK });
      }
      return [
        ...imported.values(),
        ...system.map((f): FontInfo => ({ id: `sys:${f.family}`, family: f.family, displayName: f.displayName, source: 'system', hasCJK: f.hasCjk })),
      ];
    },

    async importFonts() {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: '导入字体',
        filters: [{ name: '字体文件', extensions: IMPORT_EXTS }],
      });
      if (!picked) return [];
      return importFontPaths(Array.isArray(picked) ? picked : [picked]);
    },

    async removeFont(id) {
      if (!id.startsWith('imp:')) throw new Error('只能删除导入的字体');
      await track(
        withLock('fjd-fonts', async () => {
          const registry = await readFontRegistry();
          const gone = registry.filter((f) => f.id === id);
          await writeFontRegistry(registry.filter((f) => f.id !== id));
          for (const f of gone) await remove(await pathIn('fonts', f.file.replace(/^.*[\\/]/, ''))).catch(() => {});
        }),
      );
      void emit(FONTS_CHANGED_EVENT, { source: label }).catch(() => {});
    },

    async fontFaceCss() {
      const files = await readFontRegistry();
      const rules: string[] = [];
      for (const f of files) {
        const full = await pathIn('fonts', f.file.replace(/^.*[\\/]/, ''));
        rules.push(fontFaceRule({ family: f.family, url: convertFileSrc(full), format: f.format, weight: f.weight, italic: f.italic }));
      }
      return rules.join('\n');
    },

    async pickFiles() {
      const picked = await openDialog({
        multiple: true,
        directory: false,
        title: '添加图书',
        filters: [{ name: '电子书', extensions: BOOK_EXTENSIONS }],
      });
      if (!picked) return [];
      return Array.isArray(picked) ? picked : [picked];
    },

    window: {
      minimize() {
        void getCurrentWindow().minimize();
      },
      toggleMaximize() {
        void getCurrentWindow().toggleMaximize();
      },
      close() {
        // 走 onCloseRequested：先保存进度再销毁
        void getCurrentWindow().close();
      },
      isMaximized: () => getCurrentWindow().isMaximized(),
      setTitle(t) {
        document.title = t;
        void getCurrentWindow().setTitle(t);
      },
    },
  };
  return platform;
}
