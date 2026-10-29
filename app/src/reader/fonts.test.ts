import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, presetRef, type FontInfo, type FontRef } from '../model';
import { bodyFontFamily, buildPickerRows, canStepFont, checkFonts, clampFontSize, fontStack, matchesQuery, needsGeorgia, nearestStep, quoteFamily, sortFonts, stepFontSize } from './fonts';
import { buildReaderStyles } from './styles';

const sys = (family: string, displayName: string, hasCJK: boolean): FontInfo => ({ id: `sys:${family}`, family, displayName, source: 'system', hasCJK });
const imp = (family: string, displayName = family): FontInfo => ({ id: `imp:${family}`, family, displayName, source: 'imported', hasCJK: true });

const LIST: FontInfo[] = [
  sys('Arial', 'Arial', false),
  sys('Microsoft YaHei', '微软雅黑', true),
  sys('SimSun', '宋体', true),
  sys('KaiTi', '楷体', true),
  sys('SimHei', '黑体', true),
  sys('FangSong', '仿宋', true),
  sys('Segoe UI', 'Segoe UI', false),
  sys('Consolas', 'Consolas', false),
  sys('Noto Sans SC', 'Noto Sans SC', true),
  sys('STKaiti', '华文楷体', true),
  imp('Zcool Kuaile', '站酷快乐体'),
  imp('Alpha'),
];

const fonts = (rows: ReturnType<typeof buildPickerRows>) => rows.filter((r) => r.kind === 'font').map((r) => (r.kind === 'font' ? r.font.label : ''));
const headers = (rows: ReturnType<typeof buildPickerRows>) => rows.filter((r) => r.kind === 'header').map((r) => (r.kind === 'header' ? r.label : ''));

describe('字体列表：分组与排序', () => {
  it('三组依次是 推荐 / 我导入的 / 系统字体；推荐 = 原始 + 宋体 微软雅黑 楷体 等线', () => {
    const rows = buildPickerRows(LIST, '');
    expect(headers(rows)).toEqual(['推荐', '我导入的', '系统字体']);
    expect(fonts(rows).slice(0, 5)).toEqual(['原始', '宋体', '微软雅黑', '楷体', '等线']);
    // 分组标题的位置：每组的第一行
    expect(rows[0]).toMatchObject({ kind: 'header', label: '推荐' });
    expect(rows[6]).toMatchObject({ kind: 'header', label: '我导入的' });
  });

  it('系统字体：中文字体在前，之后按名称排序；推荐里已有的（宋体、微软雅黑、楷体）不再重复', () => {
    const rows = buildPickerRows(LIST, '');
    const sysRows = rows.slice(rows.findIndex((r) => r.kind === 'header' && r.label === '系统字体') + 1);
    const names = sysRows.map((r) => (r.kind === 'font' ? r.font.label : '?'));
    // 中文字体（有“简”）：仿宋、黑体、华文楷体、Noto Sans SC；然后是无中文的 Arial、Consolas、Segoe UI
    expect(names.slice(0, 4).sort()).toEqual(['Noto Sans SC', '华文楷体', '仿宋', '黑体'].sort());
    expect(names.slice(4)).toEqual(['Arial', 'Consolas', 'Segoe UI']);
    expect(sysRows.slice(0, 4).every((r) => r.kind === 'font' && !r.font.noCJK)).toBe(true);
    // “无中文”只标在系统字体里没有汉字的
    expect(sysRows.slice(4).every((r) => r.kind === 'font' && r.font.noCJK)).toBe(true);
    expect(names).not.toContain('宋体');
    expect(names).not.toContain('微软雅黑');
  });

  it('sortFonts：中文在前；同类按名称（中文按拼音）', () => {
    const out = sortFonts([sys('B', 'B', false), sys('a', 'a', false), sys('X', '黑体', true), sys('Y', '宋体', true), sys('Z', '仿宋', true)]).map((f) => f.displayName);
    expect(out).toEqual(['仿宋', '黑体', '宋体', 'a', 'B']);
  });

  it('我导入的：可删除；显示名是中文名时副标题是英文名', () => {
    const rows = buildPickerRows(LIST, '');
    const zc = rows.find((r) => r.kind === 'font' && r.font.ref.id === 'imp:Zcool Kuaile');
    expect(zc).toMatchObject({ font: { label: '站酷快乐体', sub: 'Zcool Kuaile', removable: true, group: 'imported' } });
    expect(rows.filter((r) => r.kind === 'font' && r.font.group === 'imported').every((r) => r.kind === 'font' && r.font.removable)).toBe(true);
  });

  it('空组不出现；没有导入时没有“我导入的”', () => {
    expect(headers(buildPickerRows([sys('Arial', 'Arial', false)], ''))).toEqual(['推荐', '系统字体']);
    expect(headers(buildPickerRows([], ''))).toEqual(['推荐']);
  });

  it('西文字体页：最前面是“跟随中文字体”，没有“原始”', () => {
    const rows = buildPickerRows(LIST, '', { west: true });
    expect(fonts(rows).slice(0, 5)).toEqual(['跟随中文字体', '宋体', '微软雅黑', '楷体', '等线']);
    expect(fonts(rows)).not.toContain('原始');
  });
});

describe('字体列表：搜索过滤', () => {
  it('中文名、英文名都能搜，不分大小写、不管空格', () => {
    expect(fonts(buildPickerRows(LIST, '楷'))).toEqual(['楷体', '华文楷体']);
    expect(fonts(buildPickerRows(LIST, 'yahei'))).toEqual(['微软雅黑']);
    expect(fonts(buildPickerRows(LIST, 'MICROSOFT yahei'))).toEqual(['微软雅黑']);
    expect(fonts(buildPickerRows(LIST, 'noto'))).toEqual(['Noto Sans SC']);
    expect(fonts(buildPickerRows(LIST, '快乐'))).toEqual(['站酷快乐体']);
    expect(fonts(buildPickerRows(LIST, 'kuaile'))).toEqual(['站酷快乐体']);
  });
  it('搜“楷”：推荐里的楷体 + 系统里的华文楷体（楷体本身在推荐里，不重复）；没匹配的组整组隐藏', () => {
    const rows = buildPickerRows(LIST, '楷');
    expect(headers(rows)).toEqual(['推荐', '系统字体']);
    expect(fonts(rows)).toEqual(['楷体', '华文楷体']);
  });
  it('什么也没搜到：没有任何行', () => {
    expect(buildPickerRows(LIST, '不存在的字体')).toEqual([]);
  });
  it('matchesQuery：空查询全部通过', () => {
    expect(matchesQuery(['x'], '')).toBe(true);
    expect(matchesQuery(['x'], '   ')).toBe(true);
    expect(matchesQuery(['微软雅黑', 'Microsoft YaHei'], '雅黑')).toBe(true);
    expect(matchesQuery(['微软雅黑'], '宋')).toBe(false);
  });
});

describe('字体不可用时退回宋体', () => {
  const base = DEFAULT_SETTINGS.appearance;
  const withFont = (font: FontRef, extra: object = {}) => ({ ...base, font, fontPinned: true, ...extra });

  it('导入的字体被删掉：退回宋体，给出“字体 X 不可用，已改用宋体”', () => {
    const r = checkFonts(withFont({ id: 'imp:Gone', family: 'Gone' }), LIST);
    expect(r.patch).toEqual({ font: presetRef('songti'), fontPinned: true });
    expect(r.notices).toEqual(['字体 Gone 不可用，已改用宋体']);
  });
  it('系统字体被卸载：同样退回宋体，提示里用显示名', () => {
    const r = checkFonts(withFont({ id: 'sys:Missing Font', family: 'Missing Font' }), LIST);
    expect(r.patch?.font).toEqual(presetRef('songti'));
    expect(r.notices[0]).toBe('字体 Missing Font 不可用，已改用宋体');
  });
  it('还在的字体、推荐字体不动', () => {
    expect(checkFonts(withFont({ id: 'imp:Alpha', family: 'Alpha' }), LIST).patch).toBeNull();
    expect(checkFonts(withFont({ id: 'sys:Arial', family: 'Arial' }), LIST).patch).toBeNull();
    for (const id of ['default', 'songti', 'yahei', 'kaiti', 'dengxian'] as const) expect(checkFonts(withFont(presetRef(id)), []).patch).toBeNull();
  });
  it('平台没能列出系统字体（web 没授权）时不判断系统字体，免得误伤；导入的字体照常判断', () => {
    const noSystem: FontInfo[] = [imp('Alpha')];
    expect(checkFonts(withFont({ id: 'sys:Arial', family: 'Arial' }), noSystem).patch).toBeNull();
    expect(checkFonts(withFont({ id: 'imp:Gone', family: 'Gone' }), noSystem).patch?.font).toEqual(presetRef('songti'));
  });
  it('西文字体不可用：改回“跟随中文字体”，中文字体不动', () => {
    const r = checkFonts(withFont(presetRef('songti'), { fontWest: { id: 'imp:Gone', family: 'Gone' } }), LIST);
    expect(r.patch).toEqual({ fontWest: null });
    expect(r.notices).toEqual(['字体 Gone 不可用，西文已改为跟随中文字体']);
  });
  it('两个都不可用：两条提示', () => {
    const r = checkFonts(withFont({ id: 'imp:A1', family: 'A1' }, { fontWest: { id: 'imp:B1', family: 'B1' } }), LIST);
    expect(r.notices).toHaveLength(2);
    expect(r.patch).toMatchObject({ font: presetRef('songti'), fontWest: null });
  });
});

describe('font-family 串：西文搭配', () => {
  it('推荐字体：沿用 M2a 的栈（中文字体前先放西文字体）', () => {
    expect(fontStack(presetRef('songti'))).toBe('"Georgia", "SimSun", serif');
    expect(fontStack(presetRef('yahei'))).toBe('"Segoe UI", "Microsoft YaHei", sans-serif');
    expect(fontStack(presetRef('kaiti'))).toBe('"Georgia", "KaiTi", serif');
    expect(fontStack(presetRef('dengxian'))).toBe('"Segoe UI", "DengXian", sans-serif');
    expect(fontStack(presetRef('default'))).toBeNull();
  });
  it('自己选的中文字体，“跟随”：宋体、楷体、仿宋一类前面自动加 Georgia，其他字体不加', () => {
    expect(bodyFontFamily({ id: 'sys:SimSun', family: 'SimSun' }, null)).toBe('"Georgia", "SimSun", "SimSun", serif');
    expect(bodyFontFamily({ id: 'sys:FangSong', family: 'FangSong' }, null)).toBe('"Georgia", "FangSong", "SimSun", serif');
    expect(bodyFontFamily({ id: 'sys:STKaiti', family: 'STKaiti' }, null)).toBe('"Georgia", "STKaiti", "SimSun", serif');
    expect(bodyFontFamily({ id: 'sys:SimHei', family: 'SimHei' }, null)).toBe('"SimHei", "SimSun", serif');
    expect(bodyFontFamily({ id: 'imp:Zcool', family: 'Zcool' }, null)).toBe('"Zcool", "SimSun", serif');
    expect(needsGeorgia('SimSun')).toBe(true);
    expect(needsGeorgia('Microsoft YaHei')).toBe(false);
    expect(needsGeorgia('Songti SC')).toBe(true);
  });
  it('单独指定西文字体：放在最前面，后面是中文字体的栈', () => {
    const west = { id: 'sys:Consolas', family: 'Consolas' };
    expect(bodyFontFamily(presetRef('songti'), west)).toBe('"Consolas", "Georgia", "SimSun", serif');
    expect(bodyFontFamily({ id: 'sys:SimHei', family: 'SimHei' }, west)).toBe('"Consolas", "SimHei", "SimSun", serif');
    // 原始（不覆盖书里的字体）时，西文字体后面用宋体兜底
    expect(bodyFontFamily(presetRef('default'), west)).toBe('"Consolas", "Georgia", "SimSun", serif');
    // west 的 id 是 default 视同跟随
    expect(bodyFontFamily(presetRef('yahei'), presetRef('default'))).toBe('"Segoe UI", "Microsoft YaHei", sans-serif');
  });
  it('家族名转义：引号、反斜杠、换行不会跑出字符串', () => {
    expect(quoteFamily('A"B\\C\nD')).toBe('"A\\"B\\\\C D"');
    const css = bodyFontFamily({ id: 'imp:x', family: 'x"; } body { display:none } /*' }, null)!;
    expect(css.startsWith('"x\\"; } body { display:none } /*"')).toBe(true);
  });
});

describe('生成的样式', () => {
  const base = DEFAULT_SETTINGS.appearance;
  it('导入字体的 @font-face 和正文样式一起注入；字体名加引号', () => {
    const face = '@font-face { font-family: "My Font"; src: url("fjd://data/fonts/a.ttf"); }';
    const [, after] = buildReaderStyles({
      appearance: { ...base, font: { id: 'imp:My Font', family: 'My Font' }, fontPinned: true },
      horizontal: true,
      fontFaceCss: face,
    });
    expect(after).toContain(face);
    expect(after).toContain('font-family: "My Font", "SimSun", serif !important');
    // @font-face 在 body 的规则之前
    expect(after.indexOf('@font-face')).toBeLessThan(after.indexOf('font-family: "My Font"', after.indexOf('@font-face') + 1));
  });
  it('西文字体设置体现在 body 的 font-family 上', () => {
    const [, after] = buildReaderStyles({ appearance: { ...base, fontWest: { id: 'sys:Consolas', family: 'Consolas' } }, horizontal: true });
    expect(after).toContain('font-family: "Consolas", "Georgia", "SimSun", serif !important');
  });
  it('没有导入字体时不多出任何 @font-face', () => {
    expect(buildReaderStyles({ appearance: base, horizontal: true })[1]).not.toContain('@font-face');
  });
});

describe('字号', () => {
  it('档位上：小A/大A 跳相邻档位（DESIGN 2.7：14, 15, 16, 18, 20, 22, 24, 27, 30, 34, 38）', () => {
    expect(stepFontSize(18, 1)).toBe(20);
    expect(stepFontSize(18, -1)).toBe(16);
    expect(stepFontSize(14, -1)).toBe(14);
    expect(stepFontSize(38, 1)).toBe(38);
    expect(canStepFont(14, -1)).toBe(false);
    expect(canStepFont(38, 1)).toBe(false);
    expect(canStepFont(18, 1)).toBe(true);
  });
  it('不在档位上（滑块调出来的）：从最接近的档位继续跳', () => {
    expect(nearestStep(25)).toBe(6); // 24
    expect(stepFontSize(25, 1)).toBe(27);
    expect(stepFontSize(25, -1)).toBe(22);
    expect(stepFontSize(29, 1)).toBe(34); // 最近是 30
    expect(stepFontSize(29, -1)).toBe(27);
    expect(stepFontSize(12, 1)).toBe(15); // 12 最接近 14
    expect(stepFontSize(48, -1)).toBe(34); // 48 最接近 38
    expect(stepFontSize(17, 1)).toBe(18); // 17 离 16 和 18 一样近，取小的 16
  });
  it('clampFontSize：12–48，整数', () => {
    expect(clampFontSize(5)).toBe(12);
    expect(clampFontSize(100)).toBe(48);
    expect(clampFontSize(18.6)).toBe(19);
    expect(clampFontSize(Number.NaN)).toBe(18);
  });
});

describe('设置的存取：{ id, family }，兼容旧存档', () => {
  it('默认值：宋体、字号 18、西文跟随', () => {
    expect(DEFAULT_SETTINGS.appearance.font).toEqual({ id: 'songti', family: 'SimSun' });
    expect(DEFAULT_SETTINGS.appearance.fontSize).toBe(18);
    expect(DEFAULT_SETTINGS.appearance.fontWest).toBeNull();
  });
  it('旧存档：font 是字符串、字号是档位 fontStep → 转成 { id, family } 和 px', () => {
    const { fontSize: _drop, ...legacy } = DEFAULT_SETTINGS.appearance;
    void _drop;
    const old = { appearance: { ...legacy, font: 'kaiti', fontStep: 5 } } as unknown as Parameters<typeof mergeSettings>[0];
    const s = mergeSettings(old);
    expect(s.appearance.font).toEqual({ id: 'kaiti', family: 'KaiTi' });
    expect(s.appearance.fontSize).toBe(22);
    expect('fontStep' in s.appearance).toBe(false);
  });
  it('新存档原样读回；坏的字体引用退回默认；字号夹紧到 12–48', () => {
    const font = { id: 'imp:Zcool', family: 'Zcool' };
    const s = mergeSettings({ appearance: { ...DEFAULT_SETTINGS.appearance, font, fontWest: { id: 'sys:Arial', family: 'Arial' }, fontSize: 31 } });
    expect(s.appearance).toMatchObject({ font, fontWest: { id: 'sys:Arial', family: 'Arial' }, fontSize: 31 });
    const bad = mergeSettings({ appearance: { ...DEFAULT_SETTINGS.appearance, font: 42 as never, fontSize: 500 } });
    expect(bad.appearance.font).toEqual(DEFAULT_SETTINGS.appearance.font);
    expect(bad.appearance.fontSize).toBe(48);
    expect(mergeSettings(null).appearance.fontSize).toBe(18);
  });
});
