// 推荐字体按平台分开，写在这一张表里（M4）。
// 每一项：id（存进设置里的稳定标识）、显示名、写进 CSS 的主家族、font-family 栈。
// 设置里存的是 id；换到另一个系统（比如把存档拷到 Mac 上），同一个 id 会解析成那个系统的对应字体：
//   songti → 宋体 / 宋体-简，yahei → 微软雅黑 / 苹方，kaiti → 楷体 / 楷体-简；dengxian、yuanti、dongqing 只在各自的系统里有，
//   在别的系统上找不到时，栈退回该系统的宋体。
// 中文字体前面先放一个西文字体（DESIGN 0.1），避免英文和数字落到宋体、楷体自带的等宽西文字形上。
import type { FontId, FontInfo } from '../model';
import { currentOs, type OsKind } from '../platform/os';

export interface PresetFont {
  id: FontId;
  label: string;
  /** 写进 CSS 的主家族；原始没有（不覆盖书里的 font-family） */
  family: string;
  /** font-family 栈；原始为 null */
  stack: string | null;
  /** 系统里没有这个字体就不显示在推荐里（只在系统字体列表已知时判断；默认字体、原始永远显示） */
  hideIfMissing?: boolean;
}

export const PRESETS: Record<OsKind, PresetFont[]> = {
  windows: [
    { id: 'default', label: '原始', family: '', stack: null },
    { id: 'songti', label: '宋体', family: 'SimSun', stack: '"Georgia", "SimSun", serif' },
    { id: 'yahei', label: '微软雅黑', family: 'Microsoft YaHei', stack: '"Segoe UI", "Microsoft YaHei", sans-serif' },
    { id: 'kaiti', label: '楷体', family: 'KaiTi', stack: '"Georgia", "KaiTi", serif' },
    { id: 'dengxian', label: '等线', family: 'DengXian', stack: '"Segoe UI", "DengXian", sans-serif' },
  ],
  mac: [
    { id: 'default', label: '原始', family: '', stack: null },
    // 默认字体：Songti SC
    { id: 'songti', label: '宋体-简', family: 'Songti SC', stack: '"Georgia", "Songti SC", "STSong", serif' },
    { id: 'yahei', label: '苹方', family: 'PingFang SC', stack: '"PingFang SC", "Helvetica Neue", sans-serif', hideIfMissing: true },
    { id: 'kaiti', label: '楷体-简', family: 'Kaiti SC', stack: '"Georgia", "Kaiti SC", "STKaiti", serif', hideIfMissing: true },
    { id: 'yuanti', label: '圆体-简', family: 'Yuanti SC', stack: '"Yuanti SC", "PingFang SC", sans-serif', hideIfMissing: true },
    { id: 'dongqing', label: '冬青黑体', family: 'Hiragino Sans GB', stack: '"Hiragino Sans GB", "PingFang SC", sans-serif', hideIfMissing: true },
  ],
};

/** 所有平台上出现过的推荐字体 id（存档里可能是别的系统存下来的） */
export const ALL_PRESET_IDS: readonly FontId[] = [...new Set(Object.values(PRESETS).flat().map((p) => p.id))];

export const presetsFor = (os: OsKind = currentOs()): PresetFont[] => PRESETS[os];

/** 一个 id 在某个系统上对应的推荐字体；这个系统没有它就退回那个系统的宋体 */
export function presetOf(id: FontId, os: OsKind = currentOs()): PresetFont {
  const table = PRESETS[os];
  return table.find((p) => p.id === id) ?? table.find((p) => p.id === 'songti')!;
}

/** 这个 id 的栈；原始返回 null */
export function stackOf(id: FontId, os: OsKind = currentOs()): string | null {
  return id === 'default' ? null : presetOf(id, os).stack;
}

/** 完整的 id → 栈（不含原始），缺的 id 取该系统宋体的栈 */
export function stackTable(os: OsKind = currentOs()): Record<Exclude<FontId, 'default'>, string> {
  const out = {} as Record<Exclude<FontId, 'default'>, string>;
  for (const id of ALL_PRESET_IDS) if (id !== 'default') out[id] = presetOf(id, os).stack!;
  return out;
}

/**
 * 推荐字体里实际显示哪些。mac 上标了 hideIfMissing 的字体，系统里没装就不显示。
 * 判断靠系统字体列表（按英文家族名或中文名匹配）；列表是空的、或者小得不像一次成功的扫描时不判断，全部显示，免得误伤。
 */
export function availablePresets(os: OsKind, list: FontInfo[]): PresetFont[] {
  const system = list.filter((f) => f.source === 'system');
  const known = system.length >= 20;
  const have = new Set<string>();
  for (const f of system) {
    have.add(f.family.toLowerCase());
    have.add(f.displayName.toLowerCase());
  }
  return PRESETS[os].filter((p) => !p.hideIfMissing || !known || have.has(p.family.toLowerCase()) || have.has(p.label.toLowerCase()));
}
