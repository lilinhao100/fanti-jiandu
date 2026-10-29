import { create } from 'zustand';
import type { Bookmark, Highlight } from '../model';

export interface TocEntry {
  label: string;
  href: string;
  subitems?: TocEntry[];
}

/** 搜索面板的状态放在这里，关掉面板再打开时还能看到上次的结果 */
export interface SearchState {
  query: string;
  hits: { label: string; cfi: string; excerpt: { pre: string; match: string; post: string } }[];
  /** 正在搜 */
  busy: boolean;
  /** 搜完了（区分“还没搜”和“没有结果”） */
  done: boolean;
  truncated: boolean;
}

export const EMPTY_SEARCH: SearchState = { query: '', hits: [], busy: false, done: false, truncated: false };

/** 一条高亮现在在书里的情况（每次打开、换繁/简、改了高亮之后重新算） */
export interface HighlightInfo {
  /** 所在章节的序号；找不到章节时为 -1 */
  index: number;
  /** 在章节全文里的 [start, end)，start 用来排序 */
  start: number;
  end: number;
  /** false：重新定位失败，放进“无法定位” */
  located: boolean;
  chapter: string;
  /** 当前显示的文字（定位上了就是页面上的原文；定位不上时是存档文字按当前模式转一下） */
  text: string;
}

/** 选区菜单（视口坐标）。hid 有值表示点在已有高亮上 */
export interface SelMenuState {
  x: number;
  y: number;
  /** 菜单放在 y 的下方（选区靠近窗口顶部时） */
  below: boolean;
  hid: string | null;
  style: Highlight['style'] | null;
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 笔记弹窗：围着 rect 放；from 为 panel 时放在 rect 的右边（要点精选里编辑） */
export interface NoteEditorState {
  id: string;
  rect: Box;
  from: 'page' | 'panel';
}

export interface ReaderState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error?: string;
  bookId?: string;
  /** 已按显示模式转换后的书名 */
  title: string;
  toc: TocEntry[];
  currentHref?: string;
  /** 书是不是繁体（决定繁/简按钮是否可用） */
  traditional: boolean;
  display: 'converted' | 'original';
  /** 切换繁/简期间 */
  switching: boolean;
  location: { current: number; total: number } | null;
  pagesLeft: number | null;
  fraction: number;
  /** 跳转后左下角的“返回”按钮：跳转前的页码 */
  backPage: number | null;
  canGoBack: boolean;
  /** 书签（按加入时间排序）；bookmarked = 当前页有书签 */
  bookmarks: Bookmark[];
  bookmarked: boolean;
  highlights: Highlight[];
  hlInfo: Record<string, HighlightInfo>;
  menu: SelMenuState | null;
  noteEditor: NoteEditorState | null;
  search: SearchState;
  set(patch: Partial<ReaderState>): void;
  reset(): void;
}

const initial = {
  status: 'idle' as const,
  error: undefined,
  bookId: undefined,
  title: '',
  toc: [] as TocEntry[],
  currentHref: undefined,
  traditional: false,
  display: 'converted' as const,
  switching: false,
  location: null,
  pagesLeft: null,
  fraction: 0,
  backPage: null,
  canGoBack: false,
  bookmarks: [] as Bookmark[],
  bookmarked: false,
  highlights: [] as Highlight[],
  hlInfo: {} as Record<string, HighlightInfo>,
  menu: null,
  noteEditor: null,
  search: EMPTY_SEARCH,
};

export const useReaderStore = create<ReaderState>((set) => ({
  ...initial,
  set: (patch) => set(patch),
  reset: () => set({ ...initial }),
}));
