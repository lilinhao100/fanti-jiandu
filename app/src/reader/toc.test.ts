import { DEFAULT_OPTIONS } from '@fjd/engine';
import { describe, expect, it } from 'vitest';
import { convertToc, stripHanSpaces } from './toc';

describe('stripHanSpaces（目录标签里的 PDF 空格）', () => {
  it('删汉字之间的空格（1 到 3 个，含 NBSP）', () => {
    expect(stripHanSpaces('山城 岁 月')).toBe('山城岁月');
    expect(stripHanSpaces('目 录')).toBe('目录');
    expect(stripHanSpaces('目  录')).toBe('目录');
    expect(stripHanSpaces('目   录')).toBe('目录');
  });
  it('汉字与英文、数字之间的空格保留', () => {
    expect(stripHanSpaces('灯塔启用， 2017 年 7 月 14 日 12 点')).toBe('灯塔启用， 2017 年 7 月 14 日 12 点');
    expect(stripHanSpaces('Linux 内核')).toBe('Linux 内核');
    expect(stripHanSpaces('Hello World')).toBe('Hello World');
  });
  it('全角空格保留；四个以上的空格不动（宁可漏修）', () => {
    expect(stripHanSpaces('第一章　緣起')).toBe('第一章　緣起');
    expect(stripHanSpaces('甲    乙')).toBe('甲    乙');
  });
});

describe('convertToc', () => {
  const toc = [
    { label: ' 第一章 緣起 ', href: 'a', subitems: [{ label: '軟體 與 網路', href: 'a#1' }] },
    { label: '', href: 'b' },
  ];
  const text = { ...DEFAULT_OPTIONS };

  it('转换标签，保留层级和 href，不改原对象（foliate 会给它加 id）', () => {
    const snapshot = JSON.stringify(toc);
    const out = convertToc(toc, { text, stripSpaces: false });
    expect(out[0]).toMatchObject({ label: '第一章 缘起', href: 'a' });
    expect(out[0]!.subitems![0]).toMatchObject({ label: '软件 与 网络', href: 'a#1' });
    expect(JSON.stringify(toc)).toBe(snapshot);
  });

  it('空标签给占位文字；PDF 转制书去掉汉字间空格', () => {
    const out = convertToc(toc, { text, stripSpaces: true });
    expect(out[1]!.label).toBe('（无标题）');
    expect(out[0]!.subitems![0]!.label).toBe('软件与网络');
  });

  it('没有目录就是空数组', () => {
    expect(convertToc(undefined, { text, stripSpaces: true })).toEqual([]);
  });
});
