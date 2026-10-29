import { describe, expect, it } from 'vitest';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { fontFaceRule, quoteFamily } from './css';
import { bytesSource, extractTtcFace, pickFamilyNames, parseNameTable, readFaces, sniffFormat, type Decompressors } from './sfnt';
import { buildFont, buildTtc, buildWoff, buildWoff2, nameTable } from './testing';

const dec: Decompressors = {
  inflate: async (d) => new Uint8Array(await promisify(zlib.inflate)(d)),
  brotli: async (d) => new Uint8Array(await promisify(zlib.brotliDecompress)(d)),
};

const YAHEI = {
  names: [
    { id: 1, value: 'Microsoft YaHei UI Light' },
    { id: 16, value: 'Microsoft YaHei UI' },
    { id: 16, value: '微软雅黑 UI', lang: 0x0804 },
    { id: 16, value: '微軟雅黑 UI', lang: 0x0404 },
    { id: 17, value: 'Light' },
  ],
  chars: 'Aa简',
  weight: 300,
};

describe('sfnt 解析', () => {
  it('家族名取排版家族名（16），简体中文名取 0x0804，繁体名不用', async () => {
    const [f] = await readFaces(bytesSource(buildFont(YAHEI)));
    expect(f).toMatchObject({ family: 'Microsoft YaHei UI', zhName: '微软雅黑 UI', weight: 300, italic: false, hasCJK: true, hasLatin: true });
  });

  it('没有 ID 16 时用 ID 1；没有简体中文名时 zhName 为 null；Mac 平台的英文名也认', async () => {
    const [a] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'Georgia' }], chars: 'Aa' })));
    expect(a).toMatchObject({ family: 'Georgia', zhName: null, hasCJK: false, hasLatin: true });
    const [m] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'MacOnly', platform: 1 }], chars: 'a' })));
    expect(m!.family).toBe('MacOnly');
  });

  it('Mac 平台的简体中文名（GB2312，语言 33）也认；Windows 平台有的话优先用 Windows 的', async () => {
    // “宋体-简”的 GB2312 字节
    const gb = [0xcb, 0xce, 0xcc, 0xe5, 0x2d, 0xbc, 0xf2];
    const [a] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'Songti SC', platform: 1 }, { id: 1, value: '', platform: 1, encoding: 25, lang: 33, bytes: gb }], chars: 'Aa简' })));
    expect(a).toMatchObject({ family: 'Songti SC', zhName: '宋体-简', hasCJK: true });
    const [b] = await readFaces(
      bytesSource(buildFont({ names: [{ id: 1, value: 'Songti SC' }, { id: 1, value: '宋体-简（Windows）', lang: 0x0804 }, { id: 1, value: '', platform: 1, encoding: 25, lang: 33, bytes: gb }], chars: 'Aa简' })),
    );
    expect(b!.zhName).toBe('宋体-简（Windows）');
  });

  it('cmap：有“简”才算有中文；既没有字母也没有汉字（图标字体）两项都为假；BMP 外的码位走 format 12', async () => {
    const [sym] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'Icons' }], chars: '' })));
    expect(sym).toMatchObject({ hasCJK: false, hasLatin: false });
    const [han] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'Han' }], chars: '简\u{20000}' })));
    expect(han).toMatchObject({ hasCJK: true, hasLatin: false });
    const [ext] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'Ext' }], chars: 'A\u{20000}' })));
    expect(ext).toMatchObject({ hasCJK: false, hasLatin: true });
  });

  it('字重与斜体来自 OS/2', async () => {
    const [f] = await readFaces(bytesSource(buildFont({ names: [{ id: 1, value: 'X' }], weight: 700, italic: true })));
    expect(f).toMatchObject({ weight: 700, italic: true });
  });

  it('TTC：每个字体各读一遍；拆出来的单个字体和原来的内容一致', async () => {
    const ttc = buildTtc([
      { names: [{ id: 1, value: 'SimSun' }, { id: 1, value: '宋体', lang: 0x0804 }], chars: 'A简' },
      { names: [{ id: 1, value: 'NSimSun' }, { id: 1, value: '新宋体', lang: 0x0804 }], chars: 'A简' },
    ]);
    const faces = await readFaces(bytesSource(ttc));
    expect(faces.map((f) => [f.index, f.family, f.zhName])).toEqual([
      [0, 'SimSun', '宋体'],
      [1, 'NSimSun', '新宋体'],
    ]);
    expect(sniffFormat(ttc)).toBe('ttc');
    const second = extractTtcFace(ttc, 1);
    expect(sniffFormat(second)).toBe('ttf');
    const [f] = await readFaces(bytesSource(second));
    expect(f).toMatchObject({ family: 'NSimSun', zhName: '新宋体', hasCJK: true });
    expect(() => extractTtcFace(ttc, 2)).toThrow();
  });

  it('WOFF（zlib）和 WOFF2（brotli）', async () => {
    const [w1] = await readFaces(bytesSource(buildWoff(YAHEI)), dec);
    expect(w1).toMatchObject({ family: 'Microsoft YaHei UI', zhName: '微软雅黑 UI', hasCJK: true });
    const [w2] = await readFaces(bytesSource(buildWoff2(YAHEI)), dec);
    expect(w2).toMatchObject({ family: 'Microsoft YaHei UI', zhName: '微软雅黑 UI', hasCJK: true });
    // 运行环境不给解压器时读不了压缩的表：不抛错，返回空
    expect(await readFaces(bytesSource(buildWoff2(YAHEI)))).toEqual([]);
  });

  it('坏文件、截断的文件、不是字体的文件：返回空数组而不是抛错', async () => {
    expect(await readFaces(bytesSource(new Uint8Array(0)))).toEqual([]);
    expect(await readFaces(bytesSource(new TextEncoder().encode('hello world, not a font')))).toEqual([]);
    const f = buildFont(YAHEI);
    expect(await readFaces(bytesSource(f.subarray(0, 40)))).toEqual([]);
    const lie = new Uint8Array(f);
    new DataView(lie.buffer).setUint16(4, 9999, false); // 表数量说谎
    expect(await readFaces(bytesSource(lie))).toEqual([]);
  });

  it('name 表里越界的记录被跳过', () => {
    const t = new Uint8Array(nameTable([{ id: 1, value: 'Abc' }]));
    new DataView(t.buffer).setUint16(6 + 10, 500, false); // 字符串偏移越界
    expect(parseNameTable(t)).toEqual([]);
    expect(pickFamilyNames([])).toEqual({ family: '', zhName: null });
  });
});

describe('CSS 转义', () => {
  it('家族名：加引号，转义双引号与反斜杠，控制字符换成空格', () => {
    expect(quoteFamily('Microsoft YaHei')).toBe('"Microsoft YaHei"');
    expect(quoteFamily('A"B')).toBe('"A\\"B"');
    expect(quoteFamily('A\\B')).toBe('"A\\\\B"');
    expect(quoteFamily('A\nB;}body{x:y')).toBe('"A B;}body{x:y"');
    expect(quoteFamily('宋体')).toBe('"宋体"');
  });
  it('@font-face：url 里的引号被转义，字重限制在 1–1000', () => {
    const css = fontFaceRule({ family: 'My "Font"', url: 'fjd://data/fonts/a".ttf', format: 'ttf', weight: 5000, italic: true });
    expect(css).toContain('font-family: "My \\"Font\\""');
    expect(css).toContain('url("fjd://data/fonts/a\\".ttf")');
    expect(css).toContain('format("truetype")');
    expect(css).toContain('font-weight: 1000');
    expect(css).toContain('font-style: italic');
  });
});
