// web 实现：IndexedDB（库名 fjd）。开发和验收都用它。见 docs/ARCHITECTURE.md 3.3。
import {
  mergeSettings,
  type BookAnnotations,
  type BookRecord,
  type FontInfo,
  type ImportResult,
  type Settings,
} from '../model';
import { fontFaceRule, type FontFileFormat } from '../fonts/css';
import { prepareFontFile } from '../fonts/importer';
import { Idb, openDb } from './idb';
import type { DataChangeKind, Platform } from './types';
import { currentOs } from './os';
import { browserDecompressors, listLocalFonts } from './webFonts';

const ACCEPT = '.epub,.mobi,.azw3,.azw,.fb2,.txt';

export interface WebPlatformOptions {
  /** 测试里注入 fake-indexeddb */
  indexedDB?: IDBFactory;
}

const emptyAnnotations = (): BookAnnotations => ({ bookmarks: [], highlights: [] });

/** 导入的字体文件（IndexedDB 的 fonts 仓库，键是内容哈希） */
interface StoredFont {
  id: string;
  family: string;
  displayName: string;
  hasCJK: boolean;
  weight: number;
  italic: boolean;
  format: FontFileFormat;
  blob: Blob;
}

const FONT_ACCEPT = '.ttf,.otf,.ttc,.woff,.woff2';
const CHANNEL = 'fjd-data-changed';

async function hashHex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return Array.from(new Uint8Array(d).slice(0, 6), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** 弹出文件选择框（用户点“导入字体…”触发） */
function pickFontFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = FONT_ACCEPT;
    input.style.display = 'none';
    const finish = (files: File[]): void => {
      resolve(files);
      setTimeout(() => input.remove(), 0);
    };
    input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => finish([]), { once: true });
    document.body.append(input);
    input.click();
  });
}

export function createWebPlatform(opts: WebPlatformOptions = {}): Platform {
  let dbPromise: Promise<Idb> | null = null;
  const db = (): Promise<Idb> => {
    dbPromise ??= openDb(opts.indexedDB ?? indexedDB).then((d) => new Idb(d));
    return dbPromise;
  };

  // 封面 blob URL 缓存：每本书只建一次，换封面或删书时回收
  const coverUrls = new Map<string, string>();
  const setCoverUrl = (id: string, blob: Blob): string => {
    const old = coverUrls.get(id);
    if (old) URL.revokeObjectURL(old);
    const url = URL.createObjectURL(blob);
    coverUrls.set(id, url);
    return url;
  };

  // 同一个浏览器的其他标签页：设置、导入的字体变了，用 BroadcastChannel 通知（不会通知自己）
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(CHANNEL) : null;
  const notify = (kind: DataChangeKind): void => {
    try {
      channel?.postMessage(kind);
    } catch {
      /* 通道已关闭：忽略 */
    }
  };

  // 导入字体的 blob URL：每个文件只建一次
  const fontUrls = new Map<string, string>();
  const fontUrl = (key: string, blob: Blob): string => {
    let url = fontUrls.get(key);
    if (!url) {
      url = URL.createObjectURL(blob);
      fontUrls.set(key, url);
    }
    return url;
  };
  const storedFonts = async (): Promise<{ key: string; font: StoredFont }[]> => {
    const d = await db();
    return (await d.getAllEntries<StoredFont>('fonts')).map((e) => ({ key: e.key, font: e.value }));
  };

  /** 把一批字体文件存进 IndexedDB；返回这次新增的家族。全部失败时抛错 */
  async function importFontFiles(files: File[]): Promise<FontInfo[]> {
    const d = await db();
    const existing = await storedFonts();
    const touched = new Map<string, FontInfo>();
    const errors: string[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        for (const face of await prepareFontFile(file.name, bytes, browserDecompressors)) {
          const key = await hashHex(face.data);
          const id = `imp:${face.family}`;
          if (existing.some((e) => e.key === key || (e.font.id === id && e.font.weight === face.weight && e.font.italic === face.italic))) continue;
          const font: StoredFont = {
            id,
            family: face.family,
            displayName: face.displayName,
            hasCJK: face.hasCJK,
            weight: face.weight,
            italic: face.italic,
            format: face.format,
            blob: new Blob([face.data.slice().buffer], { type: `font/${face.format}` }),
          };
          await d.put('fonts', font, key);
          existing.push({ key, font });
          touched.set(id, { id, family: face.family, displayName: face.displayName, source: 'imported', hasCJK: face.hasCJK });
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (touched.size === 0 && errors.length > 0) throw new Error(errors.join('；'));
    if (touched.size > 0) notify('fonts');
    return [...touched.values()];
  }

  const platform: Platform = {
    kind: 'web',
    os: currentOs(),

    async listBooks() {
      const d = await db();
      const books = await d.getAll<BookRecord>('books');
      const out: BookRecord[] = [];
      for (const b of books) {
        let url = coverUrls.get(b.id);
        if (!url) {
          const blob = await d.get<Blob>('covers', b.id);
          if (blob) url = setCoverUrl(b.id, blob);
        }
        out.push({ ...b, coverUrl: url });
      }
      return out;
    },

    async importFiles(input) {
      const files = input.filter((x): x is File => typeof x !== 'string');
      if (files.length !== input.length) throw new Error('web 平台只接受 File 对象');
      // 懒加载：导入流程依赖 foliate（只能在浏览器里跑），单元测试不需要它
      const { prepareBook } = await import('../import/prepare');
      const d = await db();
      const results: ImportResult[] = [];
      for (const file of files) {
        try {
          const prepared = await prepareBook(file);
          const existing = await d.get<BookRecord>('books', prepared.record.id);
          if (existing) {
            results.push({ ok: true, book: { ...existing, coverUrl: coverUrls.get(existing.id) }, duplicate: true });
            continue;
          }
          const items: { store: 'books' | 'files' | 'covers'; value: unknown; key?: string }[] = [
            { store: 'books', value: prepared.record },
            { store: 'files', value: prepared.file, key: prepared.record.id },
          ];
          if (prepared.cover) items.push({ store: 'covers', value: prepared.cover, key: prepared.record.id });
          await d.putMany(items);
          const coverUrl = prepared.cover ? setCoverUrl(prepared.record.id, prepared.cover) : undefined;
          results.push({ ok: true, book: { ...prepared.record, coverUrl }, duplicate: false });
        } catch (e) {
          results.push({ ok: false, name: file.name, error: e instanceof Error ? e.message : String(e) });
        }
      }
      return results;
    },

    async readBookFile(id) {
      const d = await db();
      const [rec, blob] = await Promise.all([d.get<BookRecord>('books', id), d.get<Blob>('files', id)]);
      if (!rec || !blob) throw new Error(`找不到书：${id}`);
      // txt 导入时已拼成 epub，存为 <id>.epub
      const name = rec.format === 'txt' ? `${rec.id}.epub` : rec.fileName;
      return new File([blob], name, { type: blob.type });
    },

    async updateBook(id, patch) {
      const d = await db();
      // coverUrl 是 listBooks 时派生的，不持久化
      const { coverUrl: _derived, ...rest } = patch;
      void _derived;
      await d.update<BookRecord>('books', id, (old) => ({ ...old, ...rest, id: old.id }));
    },

    async removeBook(id) {
      const d = await db();
      await d.deleteMany([
        { store: 'books', key: id },
        { store: 'files', key: id },
        { store: 'covers', key: id },
        { store: 'kv', key: `annotations:${id}` },
      ]);
      const url = coverUrls.get(id);
      if (url) URL.revokeObjectURL(url);
      coverUrls.delete(id);
    },

    async saveCover(id, blob) {
      const d = await db();
      await d.put('covers', blob, id);
      return setCoverUrl(id, blob);
    },

    async loadAnnotations(id) {
      const d = await db();
      return (await d.get<BookAnnotations>('kv', `annotations:${id}`)) ?? emptyAnnotations();
    },

    async saveAnnotations(id, a) {
      const d = await db();
      await d.put('kv', a, `annotations:${id}`);
    },

    async loadSettings() {
      const d = await db();
      return mergeSettings(await d.get<Partial<Settings>>('kv', 'settings'));
    },

    async saveSettings(s) {
      const d = await db();
      await d.put('kv', s, 'settings');
      notify('settings');
    },

    async openReader(id) {
      // 浏览器开发模式：阅读窗口就在当前页面里切换路由（ARCHITECTURE 3.2）
      location.hash = `#/reader/${id}`;
    },

    onOpenFiles() {
      return () => {};
    },

    onDataChanged(cb) {
      if (!channel) return () => {};
      const on = (e: MessageEvent): void => {
        if (e.data === 'library' || e.data === 'settings' || e.data === 'fonts') cb(e.data);
      };
      channel.addEventListener('message', on);
      return () => channel.removeEventListener('message', on);
    },

    pickFiles() {
      return new Promise<File[]>((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = ACCEPT;
        input.style.display = 'none';
        const finish = (files: File[]): void => {
          resolve(files);
          setTimeout(() => input.remove(), 0);
        };
        input.addEventListener('change', () => finish(Array.from(input.files ?? [])), { once: true });
        input.addEventListener('cancel', () => finish([]), { once: true });
        document.body.append(input);
        input.click();
      });
    },

    async listFonts() {
      const imported = new Map<string, FontInfo>();
      for (const { font } of await storedFonts()) {
        const have = imported.get(font.id);
        if (have) have.hasCJK ||= font.hasCJK;
        else imported.set(font.id, { id: font.id, family: font.family, displayName: font.displayName, source: 'imported', hasCJK: font.hasCJK });
      }
      return [...imported.values(), ...(await listLocalFonts())];
    },

    async importFonts() {
      return importFontFiles(await pickFontFiles());
    },

    async removeFont(id) {
      if (!id.startsWith('imp:')) throw new Error('只能删除导入的字体');
      const d = await db();
      const gone = (await storedFonts()).filter((e) => e.font.id === id);
      await d.deleteMany(gone.map((e) => ({ store: 'fonts' as const, key: e.key })));
      for (const e of gone) {
        const url = fontUrls.get(e.key);
        if (url) URL.revokeObjectURL(url);
        fontUrls.delete(e.key);
      }
      notify('fonts');
    },

    async fontFaceCss() {
      return (await storedFonts())
        .map(({ key, font }) => fontFaceRule({ family: font.family, url: fontUrl(key, font.blob), format: font.format, weight: font.weight, italic: font.italic }))
        .join('\n');
    },

    window: {
      minimize() {},
      toggleMaximize() {},
      close() {
        // 浏览器里“关闭阅读窗口”等于回到书库
        location.hash = '#/library';
      },
      isMaximized: async () => false,
      setTitle(t) {
        document.title = t;
      },
    },
  };
  return platform;
}
