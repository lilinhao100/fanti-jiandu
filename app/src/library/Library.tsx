import { Books, DotsThree, Plus } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { BookRecord, Settings } from '../model';
import { commandOfKey, onCommand, shortcutText } from '../lib/shortcuts';
import { getPlatform } from '../platform';
import { useLibrary } from '../store/library';
import { useSettings } from '../store/settings';
import { useUi } from '../store/ui';
import { MenuButton, type MenuEntry } from '../ui/Menu';
import { WindowControls } from '../ui/WindowControls';
import { BookCard } from './BookCard';
import { BookRow } from './BookRow';
import { useGridColumns } from './grid';
import { Home } from './Home';
import { Sidebar, type LibraryView } from './Sidebar';
import { sortBooks } from './text';

const SORTS: { id: Settings['library']['sort']; label: string }[] = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
  { id: 'added', label: '添加时间' },
];

const VIEW_TITLE: Record<LibraryView, string> = { home: '主页', all: '全部' };

function CoverGrid({ books, onRemove }: { books: BookRecord[]; onRemove(b: BookRecord): void }) {
  const { ref, cols } = useGridColumns<HTMLDivElement>();
  return (
    <div className="grid" ref={ref} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="book-grid">
      {books.map((b) => (
        <BookCard key={b.id} book={b} onRemove={() => onRemove(b)} />
      ))}
    </div>
  );
}

function BookList({ books, onRemove }: { books: BookRecord[]; onRemove(b: BookRecord): void }) {
  return (
    <div className="list" data-testid="book-list">
      {books.map((b) => (
        <BookRow key={b.id} book={b} onRemove={() => onRemove(b)} />
      ))}
    </div>
  );
}

function EmptyLibrary({ onAdd }: { onAdd(): void }) {
  return (
    <div className="empty" data-testid="empty-library">
      <Books size={64} weight="regular" />
      <h2>把繁体书拖到这里</h2>
      <p>支持 epub、mobi、azw3、fb2、txt</p>
      <button className="btn primary" onClick={onAdd}>
        <Plus size={14} weight="bold" />
        添加图书
      </button>
    </div>
  );
}


export function Library() {
  const books = useLibrary((s) => s.books);
  const loaded = useLibrary((s) => s.loaded);
  const importing = useLibrary((s) => s.importing);
  const settings = useSettings((s) => s.settings);
  const updateSettings = useSettings((s) => s.update);
  const setSettingsOpen = useUi((s) => s.setSettingsOpen);
  const [view, setView] = useState<LibraryView>('all');
  const [dragging, setDragging] = useState(false);
  const [pendingRemove, setPendingRemove] = useState<BookRecord | null>(null);
  const dragDepth = useRef(0);

  const addBooks = useCallback(async () => {
    // 桌面版（Electron/Tauri）返回的是路径，web 版返回 File；不能只留 File，否则桌面版选完没有反应
    const picked = await getPlatform().pickFiles();
    if (picked.length > 0) await useLibrary.getState().importFiles(picked);
  }, []);

  // 拖入文件：整个页面都是投放区
  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current++;
      setDragging(true);
    };
    const onOver = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };
    const onLeave = (): void => {
      // dragleave 不一定带 dataTransfer 的类型信息，所以只看计数
      if (dragDepth.current === 0) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length > 0) void useLibrary.getState().importFiles(files);
    };
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  // 快捷键：添加图书（Ctrl/⌘+O）；设置（Ctrl/⌘+,）在 App 里，书库和阅读页都能用（书库没有搜索）
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cmd = commandOfKey(e);
      if (cmd === 'add-books') {
        e.preventDefault();
        void addBooks();
      }
    };
    window.addEventListener('keydown', onKey);
    // macOS 菜单栏的“添加图书…”等走同一条路
    const off = onCommand((cmd) => {
      if (cmd === 'add-books') void addBooks();
    });
    return () => {
      window.removeEventListener('keydown', onKey);
      off();
    };
  }, [addBooks]);

  // 移除确认框：Esc 取消
  useEffect(() => {
    if (!pendingRemove) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPendingRemove(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingRemove]);

  const sorted = useMemo(() => sortBooks(books, settings.library.sort), [books, settings.library.sort]);
  const requestRemove = useCallback((b: BookRecord) => setPendingRemove(b), []);

  const setLibrary = (patch: Partial<Settings['library']>): void =>
    void updateSettings((st) => ({ ...st, library: { ...st.library, ...patch } }));

  const moreEntries: MenuEntry[] = [
    { label: '添加图书…', shortcut: shortcutText('add-books'), onSelect: () => void addBooks() },
    { kind: 'sep' },
    { label: '网格', checked: settings.library.view === 'grid', onSelect: () => setLibrary({ view: 'grid' }) },
    { label: '列表', checked: settings.library.view === 'list', onSelect: () => setLibrary({ view: 'list' }) },
    { kind: 'sep' },
    { kind: 'label', text: '排序方式' },
    ...SORTS.map(
      (s): MenuEntry => ({ label: s.label, checked: settings.library.sort === s.id, onSelect: () => setLibrary({ sort: s.id }) }),
    ),
  ];

  const isEmpty = loaded && books.length === 0 && importing === 0;
  const listView = settings.library.view === 'list';

  let body;
  if (isEmpty) {
    body = <EmptyLibrary onAdd={() => void addBooks()} />;
  } else if (view === 'home') {
    body = <Home books={books} onRemove={requestRemove} />;
  } else {
    body = listView ? <BookList books={sorted} onRemove={requestRemove} /> : <CoverGrid books={sorted} onRemove={requestRemove} />;
  }

  return (
    <div className="library" data-testid="library" data-view={view}>
      <div className="titlebar" data-tauri-drag-region />
      <WindowControls />

      <Sidebar view={view} onView={setView} onSettings={() => setSettingsOpen(true)} />

      <MenuButton className="icon-btn glass more-fab" label="更多" entries={moreEntries} testId="more-button">
        <DotsThree size={20} weight="bold" />
      </MenuButton>

      <main className="content" data-testid="library-content">
        <header className="content-header">
          <h1>{VIEW_TITLE[view]}</h1>
        </header>
        <div className="content-body">
          {importing > 0 && (
            <div className="importing" role="status">
              正在导入 {importing} 本…
            </div>
          )}
          {body}
        </div>
      </main>

      {dragging && <div className="drop-overlay" data-testid="drop-overlay" />}

      {pendingRemove && (
        <div className="dialog-backdrop" onClick={() => setPendingRemove(null)}>
          <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="remove-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="remove-title">从书库移除？</h2>
            <p>只会从书库里移除，不会删除你电脑上的原文件。阅读进度和标注也会一并清除。</p>
            <div className="actions">
              <button className="btn" autoFocus onClick={() => setPendingRemove(null)}>
                取消
              </button>
              <button
                className="btn danger"
                onClick={() => {
                  const id = pendingRemove.id;
                  setPendingRemove(null);
                  void useLibrary.getState().remove(id);
                }}
              >
                移除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
