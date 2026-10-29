// macOS 字体目录的扫描：在临时目录里搭一棵和真 Mac 同结构的树（Fonts/Supplemental、AssetsV2/…/AssetData、~/Library/Fonts），
// 验证目录展开、include 过滤、缓存、Mac 平台的中文名。真机上的 /System/Library/Fonts 只能在 Mac 上验证。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildFont, buildTtc } from '../src/fonts/testing';
import { defaultSystemFontRoots, expandFontRoots, FontService, type FontRoot } from './fonts';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-macfonts-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const write = (rel: string, data: Uint8Array): void => {
  const f = path.join(dir, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, data);
};

/** 用默认的 mac 根目录配置，把绝对路径挪到临时目录下 */
const rebased = (): FontRoot[] => defaultSystemFontRoots({}, 'darwin', '/Users/me').map((r) => ({ ...r, dir: path.join(dir, r.dir) }));

const GB_SONGTI = [0xcb, 0xce, 0xcc, 0xe5, 0x2d, 0xbc, 0xf2]; // “宋体-简”
const face = (family: string, zhBytes?: number[]) => ({
  names: [{ id: 1, value: family, platform: 1 }, ...(zhBytes ? [{ id: 1, value: '', platform: 1, encoding: 25, lang: 33, bytes: zhBytes }] : [])],
  chars: 'Aa简',
});

describe('defaultSystemFontRoots', () => {
  it('macOS：四个根目录，AssetsV2 只进 com_apple_MobileAsset_Font*', () => {
    const roots = defaultSystemFontRoots({}, 'darwin', '/Users/me');
    expect(roots.map((r) => r.dir.replace(/\\/g, '/'))).toEqual(['/System/Library/Fonts', '/Library/Fonts', '/Users/me/Library/Fonts', '/System/Library/AssetsV2']);
    const assets = roots[3]!;
    expect(assets.include?.test('com_apple_MobileAsset_Font7')).toBe(true);
    expect(assets.include?.test('com_apple_MobileAsset_Font')).toBe(true);
    expect(assets.include?.test('com_apple_MobileAsset_FontXYZ')).toBe(false);
    expect(assets.include?.test('com_apple_MobileAsset_VoiceServices')).toBe(false);
  });
  it('Windows：只有两个字体目录，不进子目录', () => {
    const roots = defaultSystemFontRoots({ SystemRoot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local' }, 'win32');
    expect(roots).toHaveLength(2);
    expect(roots.every((r) => r.depth === 0 && r.include === undefined)).toBe(true);
  });
});

describe('expandFontRoots + FontService（合成的 mac 目录树）', () => {
  function build(): void {
    write('System/Library/Fonts/PingFang.ttc', buildTtc([face('PingFang SC'), face('PingFang TC')]));
    write('System/Library/Fonts/Supplemental/Kaiti.ttc', buildTtc([face('Kaiti SC'), face('Kaiti TC')]));
    write('System/Library/Fonts/Supplemental/Yuanti.ttc', buildTtc([face('Yuanti SC')]));
    write('Library/Fonts/Custom.otf', buildFont(face('Custom Sans')));
    write('Users/me/Library/Fonts/Mine/deep/Mine.ttf', buildFont(face('Mine')));
    write('Users/me/Library/Fonts/x/y/z/TooDeep.ttf', buildFont(face('Too Deep')));
    write('System/Library/AssetsV2/com_apple_MobileAsset_Font7/abc123.asset/AssetData/Songti.ttc', buildTtc([face('Songti SC', GB_SONGTI)]));
    write('System/Library/AssetsV2/com_apple_MobileAsset_VoiceServices/def.asset/AssetData/NotAFont.ttf', buildFont(face('Should Not Appear')));
    write('System/Library/Fonts/readme.txt', new Uint8Array([1]));
  }

  it('目录展开：进 Supplemental、进已下载的字体资源，不进无关的资源目录，不进太深的目录', async () => {
    build();
    const dirs = (await expandFontRoots(rebased())).map((d) => path.relative(dir, d).replace(/\\/g, '/'));
    expect(dirs).toContain('System/Library/Fonts');
    expect(dirs).toContain('System/Library/Fonts/Supplemental');
    expect(dirs).toContain('System/Library/AssetsV2/com_apple_MobileAsset_Font7/abc123.asset/AssetData');
    expect(dirs.some((d) => d.includes('VoiceServices'))).toBe(false);
    expect(dirs).toContain('Users/me/Library/Fonts/Mine/deep'); // ~/Library/Fonts 进两层
    expect(dirs.some((d) => d.endsWith('x/y/z'))).toBe(false); // 第三层不进
  });

  it('扫出 PingFang、Kaiti、Yuanti、Songti（含 Mac 平台的中文名）、自装字体；缓存第二次命中', async () => {
    build();
    fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
    const svc = () => new FontService(path.join(dir, 'data'), { systemRoots: rebased() });
    const fonts = await svc().listSystem();
    const by = new Map(fonts.map((f) => [f.family, f]));
    for (const fam of ['PingFang SC', 'PingFang TC', 'Kaiti SC', 'Kaiti TC', 'Yuanti SC', 'Songti SC', 'Custom Sans']) expect(by.has(fam), fam).toBe(true);
    expect(by.get('Songti SC')).toMatchObject({ displayName: '宋体-简', hasCJK: true, source: 'system' });
    expect(by.has('Should Not Appear')).toBe(false);
    expect(by.has('Mine')).toBe(true);
    expect(by.has('Too Deep')).toBe(false); // 在第三层子目录里，超出深度
    // 缓存文件写出来了，再来一遍内容相同
    expect(fs.existsSync(path.join(dir, 'data', 'font-cache.json'))).toBe(true);
    const again = await svc().listSystem();
    expect(again).toEqual(fonts);
    // 往 Supplemental 里加一个字体，缓存失效、重新扫描后出现
    write('System/Library/Fonts/Supplemental/Hei.ttf', buildFont(face('Hiragino Sans GB')));
    expect((await svc().listSystem()).some((f) => f.family === 'Hiragino Sans GB')).toBe(true);
  });

  it('根目录不存在（比如没有下载任何字体资源）不报错', async () => {
    const fonts = await new FontService(path.join(dir, 'data'), { systemRoots: rebased() }).listSystem();
    expect(fonts).toEqual([]);
  });
});
