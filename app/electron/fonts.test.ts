import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFont, buildTtc, buildWoff, buildWoff2 } from '../src/fonts/testing';
import { defaultSystemFontDirs, FontService, mergeFaces, scanSystemFonts } from './fonts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-fonts-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, data: Uint8Array): string => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
  return f;
};

const SIMSUN = { names: [{ id: 1, value: 'SimSun' }, { id: 1, value: '宋体', lang: 0x0804 }], chars: 'Aa简' };
const BOLD = { names: [{ id: 1, value: 'Foo Bold' }, { id: 16, value: 'Foo' }, { id: 16, value: '福', lang: 0x0804 }], chars: 'A', weight: 700 };
const REG = { names: [{ id: 1, value: 'Foo' }, { id: 16, value: 'Foo' }], chars: 'A', weight: 400 };

describe('系统字体扫描（合成字体）', () => {
  it('按家族去重，显示名取简体中文名；没有字母也没有汉字的图标字体不列', async () => {
    write('sys/simsun.ttf', buildFont(SIMSUN));
    write('sys/foo-bold.ttf', buildFont(BOLD));
    write('sys/foo-reg.ttf', buildFont(REG));
    write('sys/icons.ttf', buildFont({ names: [{ id: 1, value: 'Icons' }], chars: '' }));
    write('sys/readme.txt', new TextEncoder().encode('x'));
    write('sys/broken.ttf', new TextEncoder().encode('not a font at all'));
    const { fonts, cached } = await scanSystemFonts([path.join(dir, 'sys'), path.join(dir, 'missing')]);
    expect(cached).toBe(false);
    expect(fonts.sort((a, b) => a.family.localeCompare(b.family))).toEqual([
      { id: 'sys:Foo', family: 'Foo', displayName: '福', source: 'system', hasCJK: false },
      { id: 'sys:SimSun', family: 'SimSun', displayName: '宋体', source: 'system', hasCJK: true },
    ]);
  });

  it('缓存：目录没变就直接用缓存；加了文件（目录修改时间、文件数变了）就重新扫描', async () => {
    write('sys/simsun.ttf', buildFont(SIMSUN));
    const cache = path.join(dir, 'font-cache.json');
    const first = await scanSystemFonts([path.join(dir, 'sys')], cache);
    expect(first.cached).toBe(false);
    expect(fs.existsSync(cache)).toBe(true);
    const second = await scanSystemFonts([path.join(dir, 'sys')], cache);
    expect(second.cached).toBe(true);
    expect(second.fonts).toEqual(first.fonts);
    write('sys/foo.ttf', buildFont(REG));
    const third = await scanSystemFonts([path.join(dir, 'sys')], cache);
    expect(third.cached).toBe(false);
    expect(third.fonts.map((f) => f.family).sort()).toEqual(['Foo', 'SimSun']);
    // 缓存坏了也不影响
    fs.writeFileSync(cache, '{坏');
    expect((await scanSystemFonts([path.join(dir, 'sys')], cache)).cached).toBe(false);
  });

  it('mergeFaces：后出现的中文名补到已有家族上，hasCJK 取并集', () => {
    const base = { index: 0, weight: 400, italic: false, hasLatin: true };
    const out = mergeFaces(
      [
        { ...base, family: 'A', zhName: null, hasCJK: false },
        { ...base, family: 'a', zhName: '甲', hasCJK: true },
      ],
      'system',
    );
    expect(out).toEqual([{ id: 'sys:A', family: 'A', displayName: '甲', source: 'system', hasCJK: true }]);
  });
});

// 真实的 Windows 字体目录：能找到“微软雅黑”和“宋体”，中文本地化名正确
describe.skipIf(process.platform !== 'win32')('系统字体扫描（本机 Windows 字体目录）', () => {
  it('找得到 Microsoft YaHei=微软雅黑、SimSun=宋体、KaiTi=楷体，数量远大于 20，第二次走缓存', async () => {
    const cache = path.join(dir, 'font-cache.json');
    const t0 = Date.now();
    const { fonts } = await scanSystemFonts(defaultSystemFontDirs(), cache);
    const first = Date.now() - t0;
    const by = (family: string) => fonts.find((f) => f.family === family);
    expect(fonts.length).toBeGreaterThan(20);
    expect(by('Microsoft YaHei')).toMatchObject({ displayName: '微软雅黑', hasCJK: true, source: 'system', id: 'sys:Microsoft YaHei' });
    expect(by('SimSun')).toMatchObject({ displayName: '宋体', hasCJK: true });
    expect(by('KaiTi')).toMatchObject({ displayName: '楷体', hasCJK: true });
    // 没有汉字的字体标出来
    expect(by('Arial')).toMatchObject({ hasCJK: false });
    // 同一个家族只出现一次
    expect(new Set(fonts.map((f) => f.family.toLowerCase())).size).toBe(fonts.length);
    const t1 = Date.now();
    const again = await scanSystemFonts(defaultSystemFontDirs(), cache);
    expect(again.cached).toBe(true);
    expect(again.fonts).toEqual(fonts);
    console.log(`扫描 ${fonts.length} 个家族：首次 ${first}ms，缓存 ${Date.now() - t1}ms`);
  });
});

describe('导入字体', () => {
  it('ttf / woff / woff2 / ttc 都能导入，TTC 拆成单个字体，登记表和 @font-face 对得上', async () => {
    const svc = new FontService(dir, { systemDirs: [] });
    const a = write('in/a.ttf', buildFont(SIMSUN));
    const b = write('in/b.woff', buildWoff({ names: [{ id: 1, value: 'Wof' }], chars: 'A' }));
    const c = write('in/c.woff2', buildWoff2({ names: [{ id: 1, value: 'Wof2' }], chars: 'A' }));
    const d = write(
      'in/d.ttc',
      buildTtc([
        { names: [{ id: 1, value: 'T0' }], chars: 'A' },
        { names: [{ id: 1, value: 'T1' }, { id: 1, value: '壹', lang: 0x0804 }], chars: 'A简' },
      ]),
    );
    const added = await svc.importFiles([a, b, c, d]);
    expect(added.map((f) => f.family).sort()).toEqual(['SimSun', 'T0', 'T1', 'Wof', 'Wof2']);
    const list = await svc.listImported();
    expect(list.find((f) => f.family === 'SimSun')).toMatchObject({ id: 'imp:SimSun', displayName: '宋体', source: 'imported', hasCJK: true });
    expect(list.find((f) => f.family === 'T1')).toMatchObject({ displayName: '壹', hasCJK: true });
    const files = fs.readdirSync(path.join(dir, 'fonts')).sort();
    expect(files).toHaveLength(5);
    expect(files.some((f) => f.endsWith('.ttf'))).toBe(true);
    expect(files.some((f) => f.endsWith('.woff'))).toBe(true);
    expect(files.some((f) => f.endsWith('.woff2'))).toBe(true);
    expect(files.some((f) => f.endsWith('.ttc'))).toBe(false);
    const css = await svc.faceCss();
    expect(css.match(/@font-face/g)).toHaveLength(5);
    expect(css).toContain('font-family: "SimSun"');
    expect(css).toMatch(/url\("fjd:\/\/data\/fonts\/[0-9a-f]{12}\.ttf"\)/);
    expect(css).toContain('format("woff2")');
    // 重复导入同一个文件：什么也不新增
    expect(await svc.importFiles([a])).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'fonts'))).toHaveLength(5);
  });

  it('同一个家族的不同字重共用一项；删除时整个家族一起删，文件也删', async () => {
    const svc = new FontService(dir, { systemDirs: [] });
    await svc.importFiles([write('in/r.ttf', buildFont(REG)), write('in/b.ttf', buildFont(BOLD))]);
    expect(await svc.listImported()).toHaveLength(1);
    expect((await svc.faceCss()).match(/@font-face/g)).toHaveLength(2);
    expect(await svc.faceCss()).toContain('font-weight: 700');
    await svc.remove('imp:Foo');
    expect(await svc.listImported()).toEqual([]);
    expect(fs.readdirSync(path.join(dir, 'fonts'))).toEqual([]);
    expect(await svc.faceCss()).toBe('');
  });

  it('只能删导入的字体；坏文件、不支持的格式报错；部分失败时导入成功的', async () => {
    const svc = new FontService(dir, { systemDirs: [] });
    await expect(svc.remove('sys:SimSun')).rejects.toThrow('只能删除导入的字体');
    await expect(svc.remove('songti')).rejects.toThrow();
    await expect(svc.importFiles([write('in/x.ttf', new TextEncoder().encode('nope'))])).rejects.toThrow(/不是有效的字体|读不出/);
    await expect(svc.importFiles([write('in/y.pdf', new Uint8Array([1, 2, 3]))])).rejects.toThrow('不支持');
    const good = write('in/g.ttf', buildFont(SIMSUN));
    const added = await svc.importFiles([write('in/z.ttf', new TextEncoder().encode('nope')), good]);
    expect(added.map((f) => f.family)).toEqual(['SimSun']);
  });

  it('fonts.json 被改过：删除时只取文件名，不会带出 fonts 目录', async () => {
    const svc = new FontService(dir, { systemDirs: [] });
    await svc.importFiles([write('in/a.ttf', buildFont(SIMSUN))]);
    const victim = write('victim.txt', new Uint8Array([1]));
    const reg = JSON.parse(fs.readFileSync(path.join(dir, 'fonts.json'), 'utf8'));
    reg.fonts[0].file = '..\\victim.txt';
    fs.writeFileSync(path.join(dir, 'fonts.json'), JSON.stringify(reg));
    await svc.remove('imp:SimSun');
    expect(fs.existsSync(victim)).toBe(true);
  });
});
