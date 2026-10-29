import { create } from 'zustand';
import type { BookRecord, ImportResult } from '../model';
import { getPlatform } from '../platform';

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

interface LibraryState {
  books: BookRecord[];
  loaded: boolean;
  importing: number;
  notices: Notice[];
  load(): Promise<void>;
  /** 桌面版的文件选择框给的是路径，web 版给的是 File，两种都收 */
  importFiles(files: File[] | string[]): Promise<ImportResult[]>;
  remove(id: string): Promise<void>;
  setDisplay(id: string, display: 'converted' | 'original'): Promise<void>;
  dismiss(id: number): void;
}

let noticeSeq = 0;

export const useLibrary = create<LibraryState>((set, get) => {
  const notify = (kind: Notice['kind'], text: string): void => {
    const id = ++noticeSeq;
    set((s) => ({ notices: [...s.notices, { id, kind, text }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 3500);
  };

  return {
    books: [],
    loaded: false,
    importing: 0,
    notices: [],

    async load() {
      const books = await getPlatform().listBooks();
      set({ books, loaded: true });
    },

    async importFiles(files) {
      if (files.length === 0) return [];
      set((s) => ({ importing: s.importing + files.length }));
      try {
        const results = await getPlatform().importFiles(files);
        await get().load();
        const added = results.filter((r) => r.ok && !r.duplicate).length;
        const dup = results.filter((r) => r.ok && r.duplicate).length;
        for (const r of results) if (!r.ok) notify('error', `${r.name}：${r.error}`);
        if (dup > 0) notify('info', `${dup} 本已在书库中`);
        if (added > 0 && results.length > 1) notify('info', `已添加 ${added} 本`);
        return results;
      } catch (e) {
        notify('error', e instanceof Error ? e.message : String(e));
        return [];
      } finally {
        set((s) => ({ importing: Math.max(0, s.importing - files.length) }));
      }
    },

    async remove(id) {
      await getPlatform().removeBook(id);
      set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
    },

    async setDisplay(id, display) {
      await getPlatform().updateBook(id, { display });
      set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, display } : b)) }));
    },

    dismiss(id) {
      set((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
    },
  };
});
