// foliate-js 是无类型的纯 JS。这里只声明我们用到的那部分形状。
// 每一项的出处见 docs/notes/foliate-hooks.md。

export interface TocItem {
  label: string;
  href: string;
  subitems?: TocItem[] | null;
  /** TOCProgress.init 会就地加上（progress.js:1-10） */
  id?: number;
}

export interface FoliateSection {
  id: string | number;
  load(): string | Promise<string>;
  unload?(): void;
  createDocument?(): Document | Promise<Document>;
  size: number;
  linear?: string;
  cfi?: string;
}

export interface FoliateBook {
  sections: FoliateSection[];
  toc?: TocItem[];
  metadata?: {
    title?: unknown;
    author?: unknown;
    language?: unknown;
    [k: string]: unknown;
  };
  dir?: 'ltr' | 'rtl';
  rendition?: { layout?: string };
  /**
   * 注意：EPUB、MOBI6、KF8 三个类都有 loadText，但参数不同（epub 是包内路径，mobi 是章节对象）。
   * 区分 epub 要看 resources（只有 EPUB.init 会设置它），见 transforms.ts 的 kindOf。
   */
  loadText?(arg: never): Promise<string | null>;
  /** 只有 EPUB 有：manifest 项的 href 是包内完整路径 */
  resources?: { manifest: { id?: string; href: string; mediaType?: string }[] };
  /** 只有 EPUB 有：按包内路径取二进制（epub.js:974） */
  loadBlob?(path: string): Promise<Blob | null | undefined>;
  transformTarget?: EventTarget;
  getCover?(): Promise<Blob | null | undefined> | Blob | null | undefined;
  destroy?(): void;
  resolveHref?(href: string): unknown;
}

export interface RelocateDetail {
  cfi: string;
  fraction: number;
  location?: { current: number; next: number; total: number };
  section?: { current: number; total: number };
  tocItem?: TocItem | null;
  range?: Range;
}

/** foliate 的 Overlayer（overlayer.js）：每个章节一个，画在 iframe 上方的 SVG 层 */
export interface OverlayerLike {
  readonly element: SVGSVGElement;
  add(key: string, range: Range | { getClientRects(): Iterable<DOMRect> }, draw: (rects: Iterable<DOMRect>, options?: unknown) => Element, options?: unknown): void;
  remove(key: string): void;
  redraw(): void;
  hitTest(e: { x: number; y: number }): [string, Range] | [];
}

export interface FoliateRenderer extends HTMLElement {
  setStyles(css: string | [string, string]): void;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  nextSection(): Promise<void>;
  prevSection(): Promise<void>;
  firstSection(): Promise<void>;
  lastSection(): Promise<void>;
  goTo(target: unknown): Promise<void>;
  getContents(): { index: number; doc: Document; overlayer?: OverlayerLike }[];
  readonly page: number;
  readonly pages: number;
  readonly atStart: boolean;
  readonly atEnd: boolean;
}

export interface SearchOptions {
  query: string;
  index?: number;
  matchCase?: boolean;
  matchWholeWords?: boolean;
  matchDiacritics?: boolean;
  /** 命中标记的画法（默认红色描边）；drawOptions 原样传给它 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  draw?: (rects: Iterable<DOMRect>, options?: any) => Element;
  drawOptions?: unknown;
}

export interface FoliateView extends HTMLElement {
  book: FoliateBook;
  renderer: FoliateRenderer;
  lastLocation: RelocateDetail | null;
  history: EventTarget & { back(): void; forward(): void; canGoBack: boolean; canGoForward: boolean };
  open(book: FoliateBook | File | string): Promise<void>;
  close(): void;
  init(opts: { lastLocation?: string | { fraction: number } | null; showTextStart?: boolean }): Promise<void>;
  goTo(target: string | number | { fraction: number }): Promise<unknown>;
  goToFraction(fraction: number): Promise<void>;
  next(distance?: number): Promise<void>;
  prev(distance?: number): Promise<void>;
  goLeft(): Promise<void>;
  goRight(): Promise<void>;
  getCFI(index: number, range?: Range): string;
  /** 注意 epub 的实现每次都重新解析；index 为 -1 表示找不到这一章 */
  resolveCFI(cfi: string): { index: number; anchor: (doc: Document) => Range };
  resolveNavigation(target: unknown): { index: number; anchor?: unknown } | undefined;
  search(opts: SearchOptions): AsyncGenerator<unknown>;
  clearSearch(): void;
  addAnnotation(annotation: { value: string }, remove?: boolean): Promise<unknown>;
  deleteAnnotation(annotation: { value: string }): Promise<unknown>;
}
