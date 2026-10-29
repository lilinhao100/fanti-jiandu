import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, presetRef } from '../model';
import { buildReaderStyles, FONT_STACK, fontSizePx, resolvePalette, THEMES, themeSwatch } from './styles';

describe('buildReaderStyles', () => {
  const [before, after] = buildReaderStyles({ appearance: DEFAULT_SETTINGS.appearance, horizontal: true });

  it('默认：原始主题，18px，默认字体宋体', () => {
    expect(fontSizePx(DEFAULT_SETTINGS.appearance.fontSize)).toBe(18);
    expect(after).toContain('font-size: 18px !important');
    expect(after).toContain('"SimSun"');
    expect(after).toContain('background: #FFFFFF !important');
    expect(after).toContain('color: #000000 !important');
  });

  it('主题自带字体与字重（DESIGN 2.6）：安静=宋体，粗体=微软雅黑+700；自选字体覆盖主题字体', () => {
    const base = DEFAULT_SETTINGS.appearance;
    const quiet = buildReaderStyles({ appearance: { ...base, theme: 'quiet' }, horizontal: true })[1];
    expect(quiet).toContain(`font-family: ${FONT_STACK.songti} !important`);
    expect(quiet).toContain('background: #4A4A4D !important');
    const bold = buildReaderStyles({ appearance: { ...base, theme: 'bold' }, horizontal: true })[1];
    expect(bold).toContain(`font-family: ${FONT_STACK.yahei} !important`);
    expect(bold).toContain('font-weight: 700 !important');
    const kai = buildReaderStyles({ appearance: { ...base, theme: 'bold', font: presetRef('kaiti'), fontPinned: true }, horizontal: true })[1];
    expect(kai).toContain(`font-family: ${FONT_STACK.kaiti} !important`);
    // 没“选”过（fontPinned 为假）时，设置里的 font 不盖过主题自带的字体
    const unpinned = buildReaderStyles({ appearance: { ...base, theme: 'bold', font: presetRef('kaiti') }, horizontal: true })[1];
    expect(unpinned).toContain(`font-family: ${FONT_STACK.yahei} !important`);
    // 选“原始”（default）：不覆盖书里的字体，即使主题自带字体
    const orig = buildReaderStyles({ appearance: { ...base, theme: 'quiet', font: presetRef('default'), fontPinned: true }, horizontal: true })[1];
    expect(orig).not.toContain('font-family');
    // 原始主题没有自带字体，用设置里的默认字体
    const kaiOrig = buildReaderStyles({ appearance: { ...base, font: presetRef('kaiti') }, horizontal: true })[1];
    expect(kaiOrig).toContain(`font-family: ${FONT_STACK.kaiti} !important`);
    // 粗体文本开关
    const b = buildReaderStyles({ appearance: { ...base, bold: true }, horizontal: true })[1];
    expect(b).toContain('font-weight: 700 !important');
  });

  it('主题方块：浅色配色，Aa 用主题字体', () => {
    expect(THEMES.map((t) => t.name)).toEqual(['原始', '安静', '纸张', '粗体', '平静', '专注']);
    expect(themeSwatch('calm').bg).toBe('#F0E2C9');
    expect(themeSwatch('bold')).toMatchObject({ fontWeight: 700 });
    expect(themeSwatch('quiet').fontFamily).toBe(FONT_STACK.songti);
    expect(themeSwatch('bold').fontFamily).toBe(FONT_STACK.yahei);
  });

  it('横排开：注入 writing-mode 与 direction（setStyles 发生在方向检测之前）', () => {
    expect(after).toContain('writing-mode: horizontal-tb !important');
    expect(after).toContain('direction: ltr !important');
    const off = buildReaderStyles({ appearance: DEFAULT_SETTINGS.appearance, horizontal: false })[1];
    expect(off).not.toContain('writing-mode');
  });

  it('不碰 paginator 占用的属性', () => {
    for (const prop of ['column-width', 'column-gap', 'overflow:', 'padding:']) expect(after).not.toContain(prop);
  });

  it('前置样式只放可被书覆盖的兜底：书里没写字体按宋体、中文段落首行缩进 2em', () => {
    expect(before).toContain('"SimSun"');
    expect(before).toContain('text-indent: 2em');
    expect(before).not.toContain('!important');
  });

  it('字号：设置里存 px（12–48），越界时夹紧，小数四舍五入', () => {
    expect(fontSizePx(-3)).toBe(12);
    expect(fontSizePx(99)).toBe(48);
    expect(fontSizePx(25.4)).toBe(25);
    expect(buildReaderStyles({ appearance: { ...DEFAULT_SETTINGS.appearance, fontSize: 31 }, horizontal: true })[1]).toContain('font-size: 31px !important');
  });

  it('深色模式取深色配色，auto 跟随系统', () => {
    const base = DEFAULT_SETTINGS.appearance;
    expect(resolvePalette({ ...base, mode: 'dark' })).toMatchObject({ bg: '#000000', dark: true });
    expect(resolvePalette({ ...base, mode: 'auto' }, true).dark).toBe(true);
    expect(resolvePalette({ ...base, mode: 'auto' }, false).dark).toBe(false);
  });

  it('自定义关闭时忽略行距等自定义值', () => {
    const a = { ...DEFAULT_SETTINGS.appearance, lineHeight: 2.4, custom: false };
    expect(buildReaderStyles({ appearance: a, horizontal: true })[1]).toContain('line-height: 1.8 !important');
    expect(buildReaderStyles({ appearance: { ...a, custom: true }, horizontal: true })[1]).toContain('line-height: 2.4 !important');
  });

  it('西文字形：中文字体前面先放西文字体（DESIGN 0.1），避免英文和数字落到宋体自带的等宽西文字形上', () => {
    expect(FONT_STACK.songti).toBe('"Georgia", "SimSun", serif');
    expect(FONT_STACK.kaiti).toBe('"Georgia", "KaiTi", serif');
    expect(FONT_STACK.yahei).toBe('"Segoe UI", "Microsoft YaHei", sans-serif');
    expect(FONT_STACK.dengxian).toBe('"Segoe UI", "DengXian", sans-serif');
    // 默认（宋体）：正文和“书里没写字体时的兜底”都用这个栈
    expect(after).toContain(`font-family: ${FONT_STACK.songti} !important`);
    expect(before).toContain(`font-family: ${FONT_STACK.songti}`);
    const kai = buildReaderStyles({ appearance: { ...DEFAULT_SETTINGS.appearance, font: presetRef('kaiti') }, horizontal: true })[1];
    expect(kai).toContain('"Georgia", "KaiTi", serif');
  });
});
