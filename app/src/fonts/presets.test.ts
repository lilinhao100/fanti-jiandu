import { describe, expect, it } from 'vitest';
import type { FontInfo } from '../model';
import { buildPickerRows, bodyFontFamily, fontStack, displayNameOf, FONT_STACK } from '../reader/fonts';
import { detectOs } from '../platform/os';
import { ALL_PRESET_IDS, availablePresets, presetOf, presetsFor, stackOf, stackTable } from './presets';

const sys = (family: string, displayName = family, hasCJK = true): FontInfo => ({ id: `sys:${family}`, family, displayName, source: 'system', hasCJK });
/** 一份像样的 mac 系统字体列表：推荐的 5 个 + 凑够“扫描成功”的数量 */
const macList = (without: string[] = []): FontInfo[] => {
  const base = ['Songti SC', 'PingFang SC', 'Kaiti SC', 'Yuanti SC', 'Hiragino Sans GB', ...Array.from({ length: 30 }, (_, i) => `Filler ${i}`)];
  return base.filter((f) => !without.includes(f)).map((f) => sys(f));
};

describe('detectOs（渲染进程判断系统）', () => {
  it('注入的 __FJD_OS__ 优先；Electron 的 platform=darwin 是 mac；其他都是 windows', () => {
    expect(detectOs({ __FJD_OS__: 'mac' })).toBe('mac');
    expect(detectOs({ __FJD_OS__: 'windows', fjdElectron: { platform: 'darwin' } })).toBe('windows');
    expect(detectOs({ fjdElectron: { platform: 'darwin' } })).toBe('mac');
    expect(detectOs({ fjdElectron: { platform: 'win32' } })).toBe('windows');
    expect(detectOs({ fjdElectron: { platform: 'linux' } })).toBe('windows');
    expect(detectOs({})).toBe('windows');
    expect(detectOs({ __FJD_OS__: 'bogus' })).toBe('windows');
    expect(detectOs(undefined)).toBe('windows');
  });
});

describe('推荐字体：按平台分开', () => {
  it('Windows：原始、宋体、微软雅黑、楷体、等线', () => {
    expect(presetsFor('windows').map((p) => [p.id, p.label, p.family])).toEqual([
      ['default', '原始', ''],
      ['songti', '宋体', 'SimSun'],
      ['yahei', '微软雅黑', 'Microsoft YaHei'],
      ['kaiti', '楷体', 'KaiTi'],
      ['dengxian', '等线', 'DengXian'],
    ]);
  });
  it('macOS：宋体-简、苹方、楷体-简、圆体-简、冬青黑体；默认字体是 Songti SC', () => {
    expect(presetsFor('mac').map((p) => [p.id, p.label, p.family])).toEqual([
      ['default', '原始', ''],
      ['songti', '宋体-简', 'Songti SC'],
      ['yahei', '苹方', 'PingFang SC'],
      ['kaiti', '楷体-简', 'Kaiti SC'],
      ['yuanti', '圆体-简', 'Yuanti SC'],
      ['dongqing', '冬青黑体', 'Hiragino Sans GB'],
    ]);
    expect(presetOf('songti', 'mac').family).toBe('Songti SC');
    expect(stackOf('songti', 'mac')).toBe('"Georgia", "Songti SC", "STSong", serif');
    expect(stackOf('default', 'mac')).toBeNull();
  });
  it('Windows 的栈和改动前完全一致（回归）', () => {
    expect(stackOf('songti', 'windows')).toBe('"Georgia", "SimSun", serif');
    expect(stackOf('yahei', 'windows')).toBe('"Segoe UI", "Microsoft YaHei", sans-serif');
    expect(stackOf('kaiti', 'windows')).toBe('"Georgia", "KaiTi", serif');
    expect(stackOf('dengxian', 'windows')).toBe('"Segoe UI", "DengXian", sans-serif');
  });
  it('跨系统的存档：别的系统才有的 id 退回本系统的宋体，不会没有字体', () => {
    expect(stackOf('dengxian', 'mac')).toBe(stackOf('songti', 'mac'));
    expect(stackOf('yuanti', 'windows')).toBe(stackOf('songti', 'windows'));
    expect(presetOf('dongqing', 'windows').id).toBe('songti');
    const t = stackTable('mac');
    for (const id of ALL_PRESET_IDS) if (id !== 'default') expect(t[id]).toBeTruthy();
    expect(Object.keys(FONT_STACK).sort()).toEqual([...ALL_PRESET_IDS].filter((i) => i !== 'default').sort());
  });
  it('mac 的栈里没有 Windows 字体，Windows 的栈里没有 mac 字体', () => {
    for (const id of ALL_PRESET_IDS) {
      if (id === 'default') continue;
      expect(stackOf(id, 'mac')).not.toMatch(/SimSun|YaHei|KaiTi|DengXian|Segoe/);
      expect(stackOf(id, 'windows')).not.toMatch(/SC"|PingFang|Hiragino|STSong/);
    }
  });
});

describe('没装的不显示', () => {
  it('mac：系统里有的都显示', () => {
    expect(availablePresets('mac', macList()).map((p) => p.id)).toEqual(['default', 'songti', 'yahei', 'kaiti', 'yuanti', 'dongqing']);
  });
  it('mac：没装的（圆体、冬青黑体）不显示；宋体-简和原始永远显示', () => {
    expect(availablePresets('mac', macList(['Yuanti SC', 'Hiragino Sans GB'])).map((p) => p.id)).toEqual(['default', 'songti', 'yahei', 'kaiti']);
    expect(availablePresets('mac', macList(['Songti SC'])).map((p) => p.id)).toContain('songti');
  });
  it('按中文显示名也能认（系统给的家族名可能不是英文名）', () => {
    const list = [...macList(['Yuanti SC']), sys('SomeInternalName', '圆体-简')];
    expect(availablePresets('mac', list).map((p) => p.id)).toContain('yuanti');
  });
  it('系统字体列表为空或小得不像一次成功的扫描（web 没授权、扫描失败）时不判断，全部显示', () => {
    expect(availablePresets('mac', []).map((p) => p.id)).toHaveLength(6);
    expect(availablePresets('mac', [sys('Only One')]).map((p) => p.id)).toHaveLength(6);
  });
  it('Windows 的 5 项永远全部显示', () => {
    expect(availablePresets('windows', macList()).map((p) => p.id)).toHaveLength(5);
  });
});

describe('字体页的 mac 推荐列表', () => {
  it('推荐组：原始 + mac 的 5 个；系统字体里不再重复出现推荐过的家族', () => {
    const rows = buildPickerRows(macList(), '', { os: 'mac' });
    expect(rows[0]).toMatchObject({ kind: 'header', label: '推荐' });
    const rec = rows.slice(1, 7).map((r) => (r.kind === 'font' ? r.font.label : '?'));
    expect(rec).toEqual(['原始', '宋体-简', '苹方', '楷体-简', '圆体-简', '冬青黑体']);
    const sysRows = rows.filter((r) => r.kind === 'font' && r.font.group === 'system').map((r) => (r.kind === 'font' ? r.font.ref.family : ''));
    for (const f of ['Songti SC', 'PingFang SC', 'Kaiti SC', 'Yuanti SC', 'Hiragino Sans GB']) expect(sysRows).not.toContain(f);
    expect(sysRows).toHaveLength(30);
  });
  it('列表里缺的字体不出现在推荐组', () => {
    const rows = buildPickerRows(macList(['Kaiti SC']), '', { os: 'mac' });
    const rec = rows.filter((r) => r.kind === 'font' && r.font.group === 'recommended').map((r) => (r.kind === 'font' ? r.font.label : ''));
    expect(rec).toEqual(['原始', '宋体-简', '苹方', '圆体-简', '冬青黑体']);
  });
  it('选西文字体时：多“跟随中文字体”，没有“原始”', () => {
    const rows = buildPickerRows(macList(), '', { os: 'mac', west: true });
    const rec = rows.filter((r) => r.kind === 'font' && (r.font.group === 'recommended' || r.font.group === 'follow')).map((r) => (r.kind === 'font' ? r.font.label : ''));
    expect(rec[0]).toBe('跟随中文字体');
    expect(rec).not.toContain('原始');
    expect(rec).toContain('苹方');
  });
  it('搜索“苹方”或 PingFang 都能找到', () => {
    for (const q of ['苹方', 'pingfang', 'Ping Fang']) {
      const rows = buildPickerRows(macList(), q, { os: 'mac' });
      expect(rows.some((r) => r.kind === 'font' && r.font.label === '苹方'), q).toBe(true);
    }
  });
});

describe('当前系统（单元测试里是 windows）下的字体函数没有变', () => {
  it('fontStack / bodyFontFamily / displayNameOf', () => {
    expect(fontStack({ id: 'songti', family: 'SimSun' })).toBe('"Georgia", "SimSun", serif');
    expect(bodyFontFamily({ id: 'default', family: '' }, null)).toBeNull();
    expect(displayNameOf({ id: 'yahei', family: 'x' }, [])).toBe('微软雅黑');
    // 别的系统存下来的 id 也能显示名字
    expect(displayNameOf({ id: 'dongqing', family: 'x' }, [])).toBe('冬青黑体');
  });
  it('mac 的系统字体（Songti SC、Kaiti SC）选作中文字体时，前面自动加 Georgia（西文字形难看）', () => {
    expect(fontStack({ id: 'sys:Songti SC', family: 'Songti SC' })).toMatch(/^"Georgia", "Songti SC"/);
    expect(fontStack({ id: 'sys:Kaiti SC', family: 'Kaiti SC' })).toMatch(/^"Georgia", "Kaiti SC"/);
    expect(fontStack({ id: 'sys:PingFang SC', family: 'PingFang SC' })).toMatch(/^"PingFang SC"/);
  });
});
