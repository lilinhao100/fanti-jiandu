import { decodeText, splitChapters } from '@fjd/engine';
import { strFromU8, unzipSync } from 'fflate';
import { DOMParser } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { buildTxtEpub, escapeXml } from './txtEpub';

const parse = (s: string): Document => new DOMParser().parseFromString(s, 'text/xml') as unknown as Document;

describe('escapeXml', () => {
  it('转义五个特殊字符，丢掉 XML 不允许的控制字符', () => {
    expect(escapeXml(`a&b<c>"d"'e'`)).toBe('a&amp;b&lt;c&gt;&quot;d&quot;&apos;e&apos;');
    expect(escapeXml('a\u0000b\u0008c\u000bd')).toBe('abcd');
    expect(escapeXml('保留\t换行\n和中文')).toBe('保留\t换行\n和中文');
  });
});

describe('buildTxtEpub', () => {
  const chapters = [
    { title: '第一章 開始', paragraphs: ['這是第一段。', '這是 <第二段> & "引號"。'] },
    { title: '第二章 結束', paragraphs: ['最後一段。'] },
  ];
  const zip = buildTxtEpub({ id: 'abc', title: '測試書 & 友', author: '作者', language: 'zh-TW', chapters });
  const files = unzipSync(zip);

  it('mimetype 是第一个条目且不压缩（EPUB OCF 要求）', () => {
    expect(Object.keys(files)[0]).toBe('mimetype');
    expect(strFromU8(files['mimetype']!)).toBe('application/epub+zip');
    // 本地文件头：偏移 8 是压缩方式，0 = 仅存储
    expect(zip[8]).toBe(0);
    expect(zip[9]).toBe(0);
    // 本地文件头里的文件名紧跟在 30 字节固定头之后
    expect(strFromU8(zip.subarray(30, 38))).toBe('mimetype');
  });

  it('container.xml 指向 OPF，OPF 的 manifest 与 spine 一一对应', () => {
    const container = parse(strFromU8(files['META-INF/container.xml']!));
    expect(container.querySelector('rootfile')?.getAttribute('full-path')).toBe('OEBPS/content.opf');
    const opf = parse(strFromU8(files['OEBPS/content.opf']!));
    expect(opf.getElementsByTagName('dc:title')[0]?.textContent).toBe('測試書 & 友');
    expect(opf.getElementsByTagName('dc:creator')[0]?.textContent).toBe('作者');
    expect(opf.getElementsByTagName('dc:language')[0]?.textContent).toBe('zh-TW');
    const items = [...opf.querySelectorAll('manifest > item')].map((i) => i.getAttribute('href'));
    expect(items).toContain('nav.xhtml');
    expect(items).toContain('ch0001.xhtml');
    expect(items).toContain('ch0002.xhtml');
    expect([...opf.querySelectorAll('spine > itemref')].map((i) => i.getAttribute('idref'))).toEqual(['c1', 'c2']);
    for (const href of items) expect(files[`OEBPS/${href}`], href!).toBeTruthy();
  });

  it('每章一个 xhtml，正文按段落转义', () => {
    const ch2 = parse(strFromU8(files['OEBPS/ch0001.xhtml']!));
    expect(ch2.querySelector('h2')?.textContent).toBe('第一章 開始');
    const ps = [...ch2.querySelectorAll('p')].map((p) => p.textContent);
    expect(ps).toEqual(['這是第一段。', '這是 <第二段> & "引號"。']);
  });

  it('nav 目录列出每一章', () => {
    const nav = parse(strFromU8(files['OEBPS/nav.xhtml']!));
    expect([...nav.querySelectorAll('a')].map((a) => [a.getAttribute('href'), a.textContent])).toEqual([
      ['ch0001.xhtml', '第一章 開始'],
      ['ch0002.xhtml', '第二章 結束'],
    ]);
  });

  it('没有作者就不写 creator；没有章节也能生成一本能打开的书', () => {
    const z = unzipSync(buildTxtEpub({ id: 'x', title: '空', language: 'zh', chapters: [] }));
    const opf = strFromU8(z['OEBPS/content.opf']!);
    expect(opf).not.toContain('creator');
    expect(z['OEBPS/ch0001.xhtml']).toBeTruthy();
  });

  it('章节标题为空时用“第N部分”', () => {
    const z = unzipSync(buildTxtEpub({ id: 'x', title: '书', language: 'zh', chapters: [{ title: '', paragraphs: ['甲'] }] }));
    expect(strFromU8(z['OEBPS/nav.xhtml']!)).toContain('第1部分');
  });

  it('与引擎的 decodeText/splitChapters 串起来：Big5 txt → epub', () => {
    // “第一章 開始” + 一段正文，Big5 编码
    const big5 = new Uint8Array([
      0xb2, 0xc4, 0xa4, 0x40, 0xb3, 0xb9, 0x20, 0xb6, 0x7d, 0xa9, 0x6c, 0x0a, // 第一章 開始
      0xb3, 0x6f, 0xac, 0x4f, 0xa4, 0x40, 0xac, 0x71, 0xa5, 0xbf, 0xa4, 0xe5, 0xa1, 0x43, 0x0a, // 這是一段正文。
    ]);
    const { text, encoding } = decodeText(big5);
    expect(encoding).toBe('big5');
    const chs = splitChapters(text);
    expect(chs[0]?.title).toBe('第一章 開始');
    const z = unzipSync(buildTxtEpub({ id: 'b', title: 'b5', language: 'zh-TW', chapters: chs }));
    expect(strFromU8(z['OEBPS/ch0001.xhtml']!)).toContain('這是一段正文。');
  });
});
