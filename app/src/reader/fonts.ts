// 字体的纯逻辑（M2d）：font-family 串怎么拼、字号档位怎么跳、列表怎么分组排序过滤、字体不可用时怎么退回。
// 没有 DOM、没有平台依赖，单元测试见 fonts.test.ts。
import {
  FONT_SIZES,
  FONT_SIZE_RANGE,
  isPresetFontId,
  presetRef,
  type FontId,
  type FontInfo,
  type FontRef,
  type Settings,
} from '../model';
import { quoteFamily } from '../fonts/css';
import { availablePresets, PRESETS, presetsFor, stackTable } from '../fonts/presets';
import { currentOs, type OsKind } from '../platform/os';

export { quoteFamily };

type Appearance = Settings['appearance'];

// ---------------------------------------------------------------- font-family

/**
 * 推荐字体的 font-family（当前系统的那一张表，见 fonts/presets.ts；这个系统没有的 id 取宋体的栈）。
 * 中文字体前面先放一个西文字体（DESIGN 0.1），避免英文和数字落到宋体、楷体自带的等宽西文字形上。
 * 同样的栈在 tokens.css 里叫 --font-read-*，封面和设置页用。
 */
export const FONT_STACK: Record<Exclude<FontId, 'default'>, string> = stackTable();

/** 书里没写字体时的兜底（DESIGN 0.1：原始 = 不覆盖书里的 font-family；书里没写的，按宋体） */
export const FALLBACK_STACK = FONT_STACK.songti;

/** 选了一个自己的字体，字形不全（比如没有汉字）时依次退到宋体、衬线 */
const TAIL = '"SimSun", serif';

/**
 * 西文字形很难看的中文字体：宋体、楷体、仿宋、明体一类。“跟随”时在前面自动加 Georgia（沿用 M2a 的规则）。
 * 按英文家族名判断（设置里存的就是英文名）。
 */
const UGLY_LATIN = /^(n?simsun|simkai|simfang|kaiti|fangsong|stsong|stkaiti|stfangsong|stxinwei|dfkai|mingliu|pmingliu|hmingliu|songti|ar pl|fz(shusong|kai|fangsong))/i;

export const needsGeorgia = (family: string): boolean => UGLY_LATIN.test(family.trim());

/** 一个字体引用本身的栈（不含西文搭配）。原始返回 null：不覆盖 */
export function fontStack(ref: FontRef): string | null {
  if (ref.id === 'default') return null;
  if (isPresetFontId(ref.id)) return FONT_STACK[ref.id as Exclude<FontId, 'default'>];
  const f = quoteFamily(ref.family);
  return `${needsGeorgia(ref.family) ? '"Georgia", ' : ''}${f}, ${TAIL}`;
}

/**
 * 正文的 font-family：
 * - 西文字体为“跟随”（null）：就是中文字体自己的栈，宋体、楷体前面有 Georgia；
 * - 单独指定了西文字体：西文字体放最前面，后面是中文字体的栈。原始（不覆盖）时，后面是宋体兜底。
 * 返回 null 表示不覆盖书里的字体。
 */
export function bodyFontFamily(zh: FontRef, west: FontRef | null): string | null {
  const base = fontStack(zh);
  if (!west || west.id === 'default') return base;
  const w = quoteFamily(west.family);
  return `${w}, ${base ?? FALLBACK_STACK}`;
}

/** 列表里每一项“用自己的字体”显示名字时的 font-family */
export function sampleFamily(ref: FontRef): string {
  return fontStack(ref) ?? 'var(--font-ui)';
}

// ---------------------------------------------------------------- 字号

export const clampFontSize = (px: number): number =>
  Math.max(FONT_SIZE_RANGE.min, Math.min(FONT_SIZE_RANGE.max, Math.round(Number.isFinite(px) ? px : 18)));

/** 离 px 最近的档位序号；一样近时取小的 */
export function nearestStep(px: number): number {
  let best = 0;
  for (let i = 1; i < FONT_SIZES.length; i++) {
    if (Math.abs(FONT_SIZES[i]! - px) < Math.abs(FONT_SIZES[best]! - px)) best = i;
  }
  return best;
}

/** “小A/大A”和 Ctrl+-/= 的跳法：落在档位上就跳到相邻档位；不在档位上，从最接近的档位继续跳 */
export function stepFontSize(px: number, delta: number): number {
  const i = Math.max(0, Math.min(FONT_SIZES.length - 1, nearestStep(px) + delta));
  return FONT_SIZES[i]!;
}

/** 按钮是不是已经跳到头了 */
export function canStepFont(px: number, delta: number): boolean {
  const i = nearestStep(px) + delta;
  return i >= 0 && i < FONT_SIZES.length;
}

// ---------------------------------------------------------------- 列表

export type PickerFont = {
  /** 设置里存的引用 */
  ref: FontRef;
  label: string;
  /** 次要信息：英文名（显示名是中文时） */
  sub?: string;
  group: 'recommended' | 'imported' | 'system' | 'follow';
  /** 无中文：系统字体里没有“简”字的 */
  noCJK?: boolean;
  /** 导入的字体可以删除 */
  removable?: boolean;
};

export type PickerRow =
  | { kind: 'header'; key: string; label: string }
  | { kind: 'font'; key: string; font: PickerFont };

const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' });

/** 推荐字体的 ref 按 family 对应到系统字体，避免系统字体里再出现一遍 */
const presetFamiliesOf = (os: OsKind): Set<string> => new Set(presetsFor(os).filter((p) => p.family).map((p) => p.family.toLowerCase()));

/** 系统字体的顺序：中文字体在前，然后按显示名排序（中文按拼音，英文按字母） */
export function sortFonts(list: FontInfo[]): FontInfo[] {
  return [...list].sort((a, b) => {
    if (a.hasCJK !== b.hasCJK) return a.hasCJK ? -1 : 1;
    return collator.compare(a.displayName, b.displayName) || collator.compare(a.family, b.family);
  });
}

/** 搜索：中文名、英文名都可以，不分大小写，空格不敏感 */
export function matchesQuery(parts: string[], query: string): boolean {
  const q = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!q) return true;
  return parts.some((p) => p.toLowerCase().replace(/\s+/g, '').includes(q));
}

/**
 * 字体页的行：推荐 / 我导入的 / 系统字体 三组，空组不出现。
 * west：选西文字体时，推荐组最前面多一项“跟随中文字体”，没有“原始”。
 */
export function buildPickerRows(list: FontInfo[], query: string, opts: { west?: boolean; os?: OsKind } = {}): PickerRow[] {
  const os = opts.os ?? currentOs();
  const rows: PickerRow[] = [];
  const add = (key: string, label: string, fonts: PickerFont[]): void => {
    if (fonts.length === 0) return;
    rows.push({ kind: 'header', key: `h:${key}`, label });
    for (const font of fonts) rows.push({ kind: 'font', key: `${key}:${font.ref.id}`, font });
  };

  const recommended: PickerFont[] = [];
  if (opts.west) {
    const follow = '跟随中文字体';
    if (matchesQuery([follow, '跟随'], query)) {
      recommended.push({ ref: { id: 'follow', family: '' }, label: follow, group: 'follow' });
    }
  }
  // macOS：Apple 自带的字体里，系统里没装的不显示
  for (const p of availablePresets(os, list)) {
    if (opts.west && p.id === 'default') continue;
    if (matchesQuery([p.label, p.family], query)) {
      recommended.push({ ref: presetRef(p.id), label: p.label, sub: p.family || undefined, group: 'recommended' });
    }
  }
  add('recommended', '推荐', recommended);

  const imported = list.filter((f) => f.source === 'imported' && matchesQuery([f.displayName, f.family], query));
  add(
    'imported',
    '我导入的',
    sortFonts(imported).map((f) => ({
      ref: { id: f.id, family: f.family },
      label: f.displayName,
      sub: f.displayName !== f.family ? f.family : undefined,
      group: 'imported',
      removable: true,
    })),
  );

  const system = list.filter(
    (f) => f.source === 'system' && !presetFamiliesOf(os).has(f.family.toLowerCase()) && matchesQuery([f.displayName, f.family], query),
  );
  add(
    'system',
    '系统字体',
    sortFonts(system).map((f) => ({
      ref: { id: f.id, family: f.family },
      label: f.displayName,
      sub: f.displayName !== f.family ? f.family : undefined,
      group: 'system',
      noCJK: !f.hasCJK,
    })),
  );
  return rows;
}

// ---------------------------------------------------------------- 字体不可用时退回宋体

export interface FontCheck {
  patch: Partial<Appearance> | null;
  /** “字体 X 不可用，已改用宋体”一类的提示，每个失效的字体一条 */
  notices: string[];
}

/**
 * 设置里选的字体还在不在：推荐字体永远算在；导入的字体看列表；系统字体看列表，
 * 但平台没能列出系统字体时（web 没有授权）不判断，免得误伤。
 * 中文字体失效 → 退回宋体；西文字体失效 → 改回“跟随中文字体”。
 */
export function checkFonts(a: Appearance, list: FontInfo[]): FontCheck {
  const hasSystem = list.some((f) => f.source === 'system');
  const have = (ref: FontRef): boolean => {
    if (isPresetFontId(ref.id)) return true;
    if (ref.id.startsWith('sys:') && !hasSystem) return true;
    return list.some((f) => f.id === ref.id);
  };
  const patch: Partial<Appearance> = {};
  const notices: string[] = [];
  if (!have(a.font)) {
    patch.font = presetRef('songti');
    patch.fontPinned = true;
    notices.push(`字体 ${displayNameOf(a.font, list)} 不可用，已改用宋体`);
  }
  if (a.fontWest && !have(a.fontWest)) {
    patch.fontWest = null;
    notices.push(`字体 ${displayNameOf(a.fontWest, list)} 不可用，西文已改为跟随中文字体`);
  }
  return { patch: notices.length > 0 ? patch : null, notices };
}

export function displayNameOf(ref: FontRef, list: FontInfo[]): string {
  // 当前系统的推荐表里找；没有（别的系统存下来的 id）就在所有系统的表里找
  const preset = presetsFor().find((p) => p.id === ref.id) ?? Object.values(PRESETS).flat().find((p) => p.id === ref.id);
  if (preset) return preset.label;
  return list.find((f) => f.id === ref.id)?.displayName ?? ref.family;
}
