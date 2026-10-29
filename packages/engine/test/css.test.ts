import { describe, expect, it } from 'vitest';
import { transformCss } from '../src/index';
import { opts } from './env';

const h = opts({ horizontal: true });
const v = opts({ horizontal: false });

describe('transformCss', () => {
  it('writing-mode: vertical-rl → horizontal-tb', () => {
    expect(transformCss('html { writing-mode: vertical-rl; }', h)).toBe('html { writing-mode: horizontal-tb; }');
  });

  it('vertical-lr', () => {
    expect(transformCss('p{writing-mode:vertical-lr}', h)).toBe('p{writing-mode:horizontal-tb}');
  });

  it('-epub-writing-mode 和 -webkit-writing-mode', () => {
    const css = 'body { -epub-writing-mode: vertical-rl; -webkit-writing-mode: vertical-rl; writing-mode: vertical-rl; }';
    expect(transformCss(css, h)).toBe(
      'body { -epub-writing-mode: horizontal-tb; -webkit-writing-mode: horizontal-tb; writing-mode: horizontal-tb; }',
    );
  });

  it('旧写法 tb-rl / tb-lr', () => {
    expect(transformCss('div{-epub-writing-mode:tb-rl}', h)).toBe('div{-epub-writing-mode:horizontal-tb}');
    expect(transformCss('div{writing-mode:tb-lr}', h)).toBe('div{writing-mode:horizontal-tb}');
  });

  it('保留 !important、大小写不敏感', () => {
    expect(transformCss('p{WRITING-MODE: Vertical-RL !important}', h)).toBe('p{WRITING-MODE: horizontal-tb !important}');
  });

  it('多处出现全部替换', () => {
    const css = 'a{writing-mode:vertical-rl}\nb{writing-mode:vertical-rl}\n';
    expect(transformCss(css, h)).toBe('a{writing-mode:horizontal-tb}\nb{writing-mode:horizontal-tb}\n');
  });

  it('horizontal 关掉：原样', () => {
    const css = 'html { writing-mode: vertical-rl; }';
    expect(transformCss(css, v)).toBe(css);
  });

  it('已经是横排、别的属性、别的取值：不动', () => {
    const css = 'p { writing-mode: horizontal-tb; text-orientation: upright; direction: rtl; color: red; }';
    expect(transformCss(css, h)).toBe(css);
  });

  it('名字里带 writing-mode 的别的东西：不动', () => {
    const css = '.vertical-rl { color: red } /* writing-mode is vertical-rl here */';
    expect(transformCss(css, h)).toBe(css);
  });

  it('空串', () => {
    expect(transformCss('', h)).toBe('');
  });
});
