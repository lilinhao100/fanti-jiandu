// 数据模型。以 docs/ARCHITECTURE.md 3.4 为准。
import type { ScriptInfo } from '@fjd/engine';
import { ALL_PRESET_IDS, presetOf, presetsFor } from './fonts/presets';

export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'fb2' | 'txt';

export interface BookProgress {
  cfi: string;
  fraction: number;
  updatedAt: number;
}

export interface BookRecord {
  /** 文件内容 sha256 的前 16 位十六进制；同一本书重复导入会去重 */
  id: string;
  /** 原始元数据（不转换；显示时再按设置转换） */
  title: string;
  author: string;
  format: BookFormat;
  fileName: string;
  size: number;
  /** 没有封面就显示生成的封面。由平台在 listBooks 时填入，不持久化 */
  coverUrl?: string;
  addedAt: number;
  lastOpenedAt?: number;
  progress?: BookProgress;
  /** 首次打开时检测并缓存 */
  script?: ScriptInfo;
  pdfReflow?: boolean;
  /** 繁/简按钮的状态，按书记住 */
  display?: 'converted' | 'original';
}

export interface Bookmark {
  id: string;
  /** 加书签时当前页的 CFI（范围 CFI，取其起点定位） */
  cfi: string;
  /** 页面开头的一段文字（片段） */
  label: string;
  createdAt: number;
  /** 所在章节名（M2b 追加的可选字段，书签面板显示用） */
  chapter?: string;
}

export interface Highlight {
  id: string;
  cfi: string;
  text: string;
  prefix: string;
  suffix: string;
  style: 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'underline';
  note?: string;
  createdAt: number;
  updatedAt: number;
  anchor: { mode: 'converted' | 'original'; engine: number; optsKey: string };
}

export interface BookAnnotations {
  bookmarks: Bookmark[];
  highlights: Highlight[];
  history?: string[];
}

export type ThemeId = 'original' | 'quiet' | 'paper' | 'bold' | 'calm' | 'focus';
/** 推荐字体的 id。default = 原始：用书里指定的字体（DESIGN 0.1）。yuanti、dongqing 只在 macOS 的推荐表里（fonts/presets.ts） */
export type FontId = 'default' | 'songti' | 'yahei' | 'kaiti' | 'dengxian' | 'yuanti' | 'dongqing';

/**
 * 设置里存的字体：{ id, family }，不存下标（M2d）。
 * id：推荐字体是 FontId；系统字体是 `sys:<family>`；导入的字体是 `imp:<family>`。family 是写进 CSS 的家族名（英文名）。
 */
export interface FontRef {
  id: string;
  family: string;
}

/** 平台列出来的一个字体家族（M2d）。同一个家族的 Regular、Bold 等只算一项 */
export interface FontInfo {
  id: string;
  /** 写进 CSS 的家族名（英文名），导入的字体是文件里读出来的 */
  family: string;
  /** 显示名：优先简体中文的本地化名（“微软雅黑”“宋体”），没有就用英文名 */
  displayName: string;
  source: 'system' | 'imported';
  /** 字体里有“简”字（U+7B80） */
  hasCJK: boolean;
}

/**
 * 推荐字体（当前系统的那一张表，见 fonts/presets.ts：Windows 是 DESIGN 0.1 的 5 项，macOS 另有一套）。
 * family 是写进 CSS 的主家族；原始没有（不覆盖书里的 font-family）。模块加载时按当前系统取一次，窗口生命周期内不会变。
 */
export const PRESET_FONTS: { id: FontId; label: string; family: string }[] = presetsFor().map(({ id, label, family }) => ({ id, label, family }));

/** 任何系统上的推荐字体 id 都认（存档可能是在别的系统上存下来的） */
export const isPresetFontId = (id: string): id is FontId => (ALL_PRESET_IDS as readonly string[]).includes(id);

export function presetRef(id: FontId): FontRef {
  const p = presetOf(id);
  // 当前系统没有这个 id 时（例如 Mac 上读到 Windows 存档里的 dengxian），presetOf 退回宋体，id 仍保留，栈按宋体解析
  return { id, family: p.family };
}

export type ColumnsChoice = 'auto' | 'one' | 'two';
export const COLUMNS_CHOICES: readonly ColumnsChoice[] = ['auto', 'one', 'two'];

export interface Settings {
  appearance: {
    theme: ThemeId;
    mode: 'light' | 'dark' | 'auto';
    /** 正文字号（px），12–48。“小A/大A”按 FONT_SIZES 的档位跳，滑块可以细调到任意整数（M2d，取代 fontStep） */
    fontSize: number;
    /** 中文字体（M2d：存 { id, family }） */
    font: FontRef;
    /** 西文字体。null = 跟随中文字体（宋体、楷体前面自动加 Georgia） */
    fontWest: FontRef | null;
    /**
     * 字体是不是用户自己选的（外观面板的自定义页、设置里的“默认字体”）。选了就覆盖主题自带的字体（DESIGN 2.6）；
     * 没选时，粗体主题用微软雅黑、安静等主题用宋体，原始主题用 font（默认宋体）。ARCHITECTURE 3.4 没有这个字段，M2b 追加
     */
    fontPinned: boolean;
    bold: boolean;
    /** 栏数（M5）：auto = 按窗口宽度，one = 一律单栏，two = 能双栏就双栏 */
    columns: ColumnsChoice;
    lineHeight: number;
    letterSpacing: number;
    wordSpacing: number;
    margin: number;
    justify: boolean;
  };
  conversion: { vocabulary: boolean; quotes: boolean; cleanup: boolean; horizontal: boolean };
  /** DESIGN 第 4 节“阅读”：翻页动画开关（默认字体用 appearance.font） */
  reading: { animated: boolean };
  library: { view: 'grid' | 'list'; sort: 'recent' | 'title' | 'author' | 'added' };
}

/** DESIGN.md 2.7：字号档位（px），默认 18 */
export const FONT_SIZES = [14, 15, 16, 18, 20, 22, 24, 27, 30, 34, 38] as const;
export const DEFAULT_FONT_SIZE = 18;
/** 字号滑块的范围（M2d） */
export const FONT_SIZE_RANGE = { min: 12, max: 48, step: 1 } as const;

export const DEFAULT_SETTINGS: Settings = {
  appearance: {
    theme: 'original',
    mode: 'auto',
    fontSize: DEFAULT_FONT_SIZE,
    font: presetRef('songti'),
    fontWest: null,
    fontPinned: false,
    bold: false,
    columns: 'auto',
    lineHeight: 1.8,
    letterSpacing: 0.02,
    wordSpacing: 0,
    margin: 1,
    justify: true,
  },
  conversion: { vocabulary: true, quotes: true, cleanup: true, horizontal: true },
  reading: { animated: true },
  library: { view: 'grid', sort: 'recent' },
};

/** DESIGN.md 2.7：自定义滑块的范围与步长 */
export const APPEARANCE_RANGES = {
  lineHeight: { min: 1.3, max: 2.4, step: 0.05 },
  letterSpacing: { min: 0, max: 0.15, step: 0.01 },
  wordSpacing: { min: 0, max: 0.5, step: 0.05 },
  margin: { min: 0.5, max: 1.8, step: 0.05 },
} as const;

/** 存档里的字体可能是旧版的字符串（预设 id），也可能缺失或损坏 */
function normalizeFont(v: unknown, fallback: FontRef): FontRef {
  if (typeof v === 'string') return isPresetFontId(v) ? presetRef(v) : fallback;
  if (v && typeof v === 'object') {
    const { id, family } = v as Partial<FontRef>;
    if (typeof id === 'string' && typeof family === 'string' && id) {
      // 推荐字体的 family 以代码里的为准（以后改了名字，旧存档跟着变）
      return isPresetFontId(id) ? presetRef(id) : { id, family };
    }
  }
  return fallback;
}

/** 合并存档与默认值（存档可能缺少新增字段，或是旧版格式：font 是字符串、字号存的是档位 fontStep） */
export function mergeSettings(saved: Partial<Settings> | undefined | null): Settings {
  const old = (saved?.appearance ?? {}) as Partial<Settings['appearance']> & { fontStep?: number; custom?: boolean };
  const appearance = { ...DEFAULT_SETTINGS.appearance, ...saved?.appearance } as Settings['appearance'] & { fontStep?: number; custom?: boolean };
  let size = old.fontSize;
  if (typeof size !== 'number' && typeof old.fontStep === 'number') size = FONT_SIZES[Math.max(0, Math.min(FONT_SIZES.length - 1, Math.round(old.fontStep)))];
  appearance.fontSize = Math.max(FONT_SIZE_RANGE.min, Math.min(FONT_SIZE_RANGE.max, Math.round(typeof size === 'number' && Number.isFinite(size) ? size : DEFAULT_FONT_SIZE)));
  appearance.font = normalizeFont(old.font, DEFAULT_SETTINGS.appearance.font);
  appearance.fontWest = old.fontWest == null ? null : normalizeFont(old.fontWest, DEFAULT_SETTINGS.appearance.font);
  delete appearance.fontStep;
  // M5：去掉“自定义”开关。开关是关的，说明版式那几项一直没生效，重置回默认，老用户升级后版面不变
  if (old.custom === false) {
    const d = DEFAULT_SETTINGS.appearance;
    Object.assign(appearance, { lineHeight: d.lineHeight, letterSpacing: d.letterSpacing, wordSpacing: d.wordSpacing, margin: d.margin, justify: d.justify });
  }
  delete appearance.custom;
  if (!(COLUMNS_CHOICES as readonly unknown[]).includes(appearance.columns)) appearance.columns = DEFAULT_SETTINGS.appearance.columns;
  return {
    appearance,
    conversion: { ...DEFAULT_SETTINGS.conversion, ...saved?.conversion },
    reading: { ...DEFAULT_SETTINGS.reading, ...saved?.reading },
    library: { ...DEFAULT_SETTINGS.library, ...saved?.library },
  };
}

export const EMPTY_ANNOTATIONS: BookAnnotations = { bookmarks: [], highlights: [] };

export type ImportResult =
  | { ok: true; book: BookRecord; duplicate: boolean }
  | { ok: false; name: string; error: string };
