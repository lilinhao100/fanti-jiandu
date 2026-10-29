// mac 打包的单元测试：用一个小的合成 zip（带符号链接、可执行位、Mach-O 魔数）跑完“组装 → 自检”，
// 再故意做坏几处，确认自检会报错。合成的“官方 zip”用 fflate 写（和我们自己的 ZipWriter 是两套独立实现），
// 读回用 yauzl，所以读写两边的约定（权限位、符号链接写法）是互相印证的。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipSync, type Zippable } from 'fflate';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assembleMacZip, mapName, NEW_APP, OFFICIAL_APP, PLAN } from './assemble';
import { parseShasums } from './download';
import { buildIcns, ICNS_TYPES, parseIcns, pngSize } from './icns';
import { checkInfoPlist, DOCUMENT_TYPES, parseInfoPlist, rewriteInfoPlist, transformInfo } from './info-plist';
import { firstOpenText, minOsText } from './readme';
import { verifyMacZip } from './verify';
import { isExecutable, isSymlink, modeOf, S_IFLNK, S_IFMT, ZipSource, ZipWriter } from './zip';

let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fjd-mac-test-'));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const OFFICIAL_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>CFBundleDisplayName</key>
	<string>Electron</string>
	<key>CFBundleExecutable</key>
	<string>Electron</string>
	<key>CFBundleIconFile</key>
	<string>electron.icns</string>
	<key>CFBundleIdentifier</key>
	<string>com.github.Electron</string>
	<key>CFBundleName</key>
	<string>Electron</string>
	<key>CFBundlePackageType</key>
	<string>APPL</string>
	<key>CFBundleShortVersionString</key>
	<string>45.1.0</string>
	<key>CFBundleVersion</key>
	<string>45.1.0</string>
	<key>ElectronAsarIntegrity</key>
	<dict>
		<key>Resources/default_app.asar</key>
		<dict>
			<key>algorithm</key>
			<string>SHA256</string>
			<key>hash</key>
			<string>abc</string>
		</dict>
	</dict>
	<key>LSApplicationCategoryType</key>
	<string>public.app-category.developer-tools</string>
	<key>LSMinimumSystemVersion</key>
	<string>13.0</string>
	<key>NSHighResolutionCapable</key>
	<true/>
</dict>
</plist>
`;

const MACHO = Buffer.concat([Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), Buffer.from('machine code '.repeat(200))]);
const ASAR = Buffer.from('fake asar '.repeat(500));

function png(px: number): Buffer {
  const b = Buffer.alloc(33 + 12);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(px, 16);
  b.writeUInt32BE(px, 20);
  b.write('IEND', 37, 'latin1');
  return b;
}
const allPngs = (): Map<number, Buffer> => new Map([...new Set(ICNS_TYPES.map((t) => t.px))].map((px) => [px, png(px)]));

/** 官方包的缩影：.app 目录、主可执行文件、一个 framework（Versions/Current → A，顶层符号链接）、Info.plist、default_app.asar、图标、许可证 */
function officialEntries(): Zippable {
  const dirMode = (0o40755 << 16) | 0x10;
  type F = [Uint8Array, { os: number; attrs: number; level: 0 | 6; mtime: Date }];
  const file = (data: Uint8Array | string, mode: number, level: 0 | 6 = 6): F => [
    typeof data === 'string' ? new Uint8Array(Buffer.from(data)) : new Uint8Array(data),
    { os: 3, attrs: (mode << 16) >>> 0, level, mtime: new Date(2025, 5, 1) },
  ];
  const d = (): F => [new Uint8Array(0), { os: 3, attrs: dirMode >>> 0, level: 0, mtime: new Date(2025, 5, 1) }];
  const fw = `${OFFICIAL_APP}/Contents/Frameworks/Electron Framework.framework`;
  return {
    'LICENSE': file('license text', 0o100644),
    [`${OFFICIAL_APP}/`]: d(),
    [`${OFFICIAL_APP}/Contents/`]: d(),
    [`${OFFICIAL_APP}/Contents/MacOS/`]: d(),
    [`${OFFICIAL_APP}/Contents/MacOS/Electron`]: file(MACHO, 0o100755),
    [`${OFFICIAL_APP}/Contents/Info.plist`]: file(OFFICIAL_PLIST, 0o100644),
    [`${OFFICIAL_APP}/Contents/Resources/`]: d(),
    [`${OFFICIAL_APP}/Contents/Resources/electron.icns`]: file('old icon', 0o100644),
    [`${OFFICIAL_APP}/Contents/Resources/default_app.asar`]: file('default app', 0o100644),
    [`${fw}/`]: d(),
    [`${fw}/Versions/`]: d(),
    [`${fw}/Versions/A/`]: d(),
    [`${fw}/Versions/A/Electron Framework`]: file(MACHO, 0o100755),
    [`${fw}/Versions/A/Resources/`]: d(),
    [`${fw}/Versions/A/Resources/en.lproj/`]: d(),
    [`${fw}/Versions/A/Resources/en.lproj/Localizable.strings`]: file('"a" = "b";', 0o100644),
    [`${fw}/Versions/A/Libraries/libx.dylib`]: file(Buffer.concat([Buffer.from([0xca, 0xfe, 0xba, 0xbe]), Buffer.alloc(64)]), 0o100755),
    // 符号链接：mode 0o120755，内容是目标路径，不压缩
    [`${fw}/Versions/Current`]: file('A', 0o120755, 0),
    [`${fw}/Electron Framework`]: file('Versions/Current/Electron Framework', 0o120755, 0),
    [`${fw}/Resources`]: file('Versions/Current/Resources', 0o120755, 0),
  };
}

function writeOfficial(name: string, mutate?: (z: Zippable) => void): string {
  const z = officialEntries();
  mutate?.(z);
  const file = path.join(dir, name);
  fs.writeFileSync(file, zipSync(z));
  return file;
}

async function assemble(official: string, outName: string): Promise<string> {
  const out = path.join(dir, outName);
  await assembleMacZip({ officialZip: official, outZip: out, appAsar: ASAR, icns: buildIcns(allPngs()), version: '0.1.0', readme: firstOpenText({ version: '0.1.0', minOs: minOsText('13.0') }) });
  return out;
}
const asarSha = crypto.createHash('sha256').update(ASAR).digest('hex');
const verify = (official: string, out: string) => verifyMacZip({ officialZip: official, newZip: out, version: '0.1.0', appAsarSha256: asarSha });

describe('名字映射和小工具', () => {
  it('只改顶层目录名', () => {
    expect(mapName('Electron.app/')).toBe('繁体简读.app/');
    expect(mapName('Electron.app/Contents/MacOS/Electron')).toBe('繁体简读.app/Contents/MacOS/Electron');
    expect(mapName('LICENSE')).toBe('LICENSE');
    expect(mapName('Electron.app.txt')).toBe('Electron.app.txt');
  });
  it('解析 SHASUMS256.txt', () => {
    const h = 'a'.repeat(64);
    const m = parseShasums(`${h} *electron-v45.1.0-darwin-arm64.zip\n${'B'.repeat(64)} *other.zip\n垃圾行\n`);
    expect(m.get('electron-v45.1.0-darwin-arm64.zip')).toBe(h);
    expect(m.get('other.zip')).toBe('b'.repeat(64));
    expect(m.size).toBe(2);
  });
  it('首次打开说明包含两条命令和系统要求', () => {
    const t = firstOpenText({ version: '0.1.0', minOs: minOsText('13.0') });
    expect(t).toContain('xattr -cr /Applications/繁体简读.app');
    expect(t).toContain('codesign --force --deep --sign - /Applications/繁体简读.app');
    expect(t).toContain('mac-arm64');
    expect(t).toContain('mac-x64');
    expect(t).toContain('仍要打开');
    expect(t).toContain('macOS 13（Ventura） 或更新');
    expect(minOsText('26.0')).toBe('macOS 26（Tahoe） 或更新');
    expect(minOsText('12.3')).toBe('macOS 12.3 或更新');
  });
});

describe('icns', () => {
  it('结构合法：头、总长度、块链条、PNG 尺寸', () => {
    const icns = buildIcns(allPngs());
    expect(icns.toString('latin1', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const info = parseIcns(icns);
    expect(info.chunks.map((c) => c.type)).toEqual(['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']);
    expect(info.chunks.map((c) => c.width)).toEqual([128, 256, 512, 1024, 32, 64, 256, 512]);
    expect(pngSize(png(48))).toEqual({ width: 48, height: 48 });
  });
  it('缺尺寸、尺寸不对、总长度不对、块越界都会报错', () => {
    const m = allPngs();
    m.delete(512);
    expect(() => buildIcns(m)).toThrow(/512/);
    const wrong = allPngs();
    wrong.set(128, png(64));
    expect(() => buildIcns(wrong)).toThrow(/128/);
    const ok = buildIcns(allPngs());
    const badTotal = Buffer.from(ok);
    badTotal.writeUInt32BE(ok.length + 1, 4);
    expect(() => parseIcns(badTotal)).toThrow(/总长度/);
    const badChunk = Buffer.from(ok);
    badChunk.writeUInt32BE(0x7fffffff, 12);
    expect(() => parseIcns(badChunk)).toThrow(/越界/);
    expect(() => parseIcns(ok.subarray(0, ok.length - 5))).toThrow();
  });
});

describe('Info.plist 改写', () => {
  const info = () => transformInfo(parseInfoPlist(OFFICIAL_PLIST), { version: '0.1.0' });
  it('改对该改的，可执行文件名不变', () => {
    const i = info();
    expect(i.CFBundleName).toBe('繁体简读');
    expect(i.CFBundleDisplayName).toBe('繁体简读');
    expect(i.CFBundleIdentifier).toBe('com.fantijiandu.reader');
    expect(i.CFBundleIconFile).toBe('icon.icns');
    expect(i.CFBundleShortVersionString).toBe('0.1.0');
    expect(i.CFBundleVersion).toBe('0.1.0');
    expect(i.LSApplicationCategoryType).toBe('public.app-category.books');
    expect(i.CFBundleExecutable).toBe('Electron');
    expect('ElectronAsarIntegrity' in i).toBe(false);
    // 没碰的字段原样保留
    expect(i.LSMinimumSystemVersion).toBe('13.0');
    expect(i.NSHighResolutionCapable).toBe(true);
  });
  it('文档类型覆盖 epub、mobi、azw3、fb2，角色是 Viewer', () => {
    const exts = DOCUMENT_TYPES.flatMap((d) => d.CFBundleTypeExtensions as string[]);
    for (const e of ['epub', 'mobi', 'azw3', 'fb2']) expect(exts).toContain(e);
    expect(DOCUMENT_TYPES.every((d) => d.CFBundleTypeRole === 'Viewer')).toBe(true);
  });
  it('写出的 XML 能解析回来并通过检查', () => {
    const xml = rewriteInfoPlist(OFFICIAL_PLIST, { version: '0.1.0' });
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(parseInfoPlist(xml)).toEqual(info());
    expect(() => checkInfoPlist(xml, { version: '0.1.0' })).not.toThrow();
  });
  it('检查会抓出错误：版本不对、可执行文件被改名、保留了 ElectronAsarIntegrity', () => {
    const xml = rewriteInfoPlist(OFFICIAL_PLIST, { version: '0.1.0' });
    expect(() => checkInfoPlist(xml, { version: '9.9.9' })).toThrow(/CFBundleShortVersionString/);
    expect(() => checkInfoPlist(xml.replace('<string>Electron</string>', '<string>Fantijiandu</string>'), { version: '0.1.0' })).toThrow(/CFBundleExecutable/);
    expect(() => transformInfo({ ...parseInfoPlist(OFFICIAL_PLIST), CFBundleExecutable: 'Other' }, { version: '1' })).toThrow(/Electron/);
    expect(() => checkInfoPlist(OFFICIAL_PLIST, { version: '45.1.0' })).toThrow();
  });
});

describe('zip：读权限位和符号链接', () => {
  it('读出 fflate 写的权限位、符号链接、可执行位', async () => {
    const f = writeOfficial('official-read.zip');
    const src = await ZipSource.open(f);
    try {
      const by = new Map(src.entries.map((e) => [e.name, e]));
      const exe = by.get('Electron.app/Contents/MacOS/Electron')!;
      expect(modeOf(exe)).toBe(0o100755);
      expect(isExecutable(exe)).toBe(true);
      const link = by.get('Electron.app/Contents/Frameworks/Electron Framework.framework/Versions/Current')!;
      expect(isSymlink(link)).toBe(true);
      expect((modeOf(link) & S_IFMT)).toBe(S_IFLNK);
      expect((await src.readBuffer(link)).toString()).toBe('A');
      expect(isSymlink(by.get('LICENSE')!)).toBe(false);
    } finally {
      src.close();
    }
  });
});

describe('组装 + 自检', () => {
  let official: string;
  let out: string;
  beforeAll(async () => {
    official = writeOfficial('official.zip');
    out = await assemble(official, 'out.zip');
  });

  it('自检通过，统计正确', async () => {
    const r = await verify(official, out);
    expect(r.machO).toBe(3); // 主程序、framework 二进制、dylib（胖 Mach-O 魔数 cafebabe）
    expect(r.symlinks).toBe(3);
    expect(r.executables).toBe(3);
    expect(r.changed).toEqual([`${NEW_APP}/Contents/Info.plist`]);
    expect(r.removed.sort()).toEqual([...PLAN.removed].sort());
    expect(r.added.sort()).toEqual([...PLAN.added].sort());
  });

  it('新 zip 的内容：改名、Mach-O 逐字节相同、符号链接写法、权限位、UTF-8 名', async () => {
    const src = await ZipSource.open(out);
    const off = await ZipSource.open(official);
    try {
      const by = new Map(src.entries.map((e) => [e.name, e]));
      expect([...by.keys()].some((n) => n.startsWith('Electron.app/'))).toBe(false);
      expect(by.has('繁体简读.app/')).toBe(true);
      expect(by.has('LICENSE')).toBe(true);
      expect(by.has('首次打开说明.txt')).toBe(true);
      expect(by.has('繁体简读.app/Contents/Resources/default_app.asar')).toBe(false);
      expect(by.has('繁体简读.app/Contents/Resources/electron.icns')).toBe(false);
      // Mach-O 字节一致
      const exe = by.get('繁体简读.app/Contents/MacOS/Electron')!;
      expect(modeOf(exe)).toBe(0o100755);
      expect((await src.readBuffer(exe)).equals(MACHO)).toBe(true);
      // 压缩后的原始字节也一致（原样搬运，没有重新压缩）
      const offExe = off.entries.find((e) => e.name === 'Electron.app/Contents/MacOS/Electron')!;
      expect(exe.compressedSize).toBe(offExe.compressedSize);
      expect(exe.crc32).toBe(offExe.crc32);
      // 符号链接：mode 0o120xxx、内容是目标、不压缩
      const link = by.get('繁体简读.app/Contents/Frameworks/Electron Framework.framework/Versions/Current')!;
      expect(isSymlink(link)).toBe(true);
      expect(link.method).toBe(0);
      expect((await src.readBuffer(link)).toString()).toBe('A');
      // 中文名置了 UTF-8 位；版本是 unix 创建
      expect(exe.flags & 0x0800).toBe(0x0800);
      expect(exe.versionMadeBy >> 8).toBe(3);
      const readme = by.get('首次打开说明.txt')!;
      expect(modeOf(readme)).toBe(0o100644);
      expect((await src.readBuffer(readme)).toString()).toContain('codesign');
      // 新增的 asar、icns
      expect((await src.readBuffer(by.get('繁体简读.app/Contents/Resources/app.asar')!)).equals(ASAR)).toBe(true);
      parseIcns(await src.readBuffer(by.get('繁体简读.app/Contents/Resources/icon.icns')!));
      // Info.plist 里的字段
      const info = checkInfoPlist((await src.readBuffer(by.get('繁体简读.app/Contents/Info.plist')!)).toString(), { version: '0.1.0' });
      expect(info.CFBundleExecutable).toBe('Electron');
    } finally {
      src.close();
      off.close();
    }
  });

  /** 从 out.zip 复制出一个“做坏了”的版本：对每个条目调用 tweak，返回 null 就删掉，返回 Buffer 就换成新内容（保持权限），返回 {mode} 就改权限 */
  async function corrupt(name: string, tweak: (e: string, data: Buffer) => null | Buffer | { mode: number } | void, extra?: (w: ZipWriter) => Promise<void>): Promise<string> {
    const src = await ZipSource.open(out);
    const file = path.join(dir, name);
    const w = new ZipWriter(file);
    for (const e of src.entries) {
      const data = e.name.endsWith('/') ? Buffer.alloc(0) : await src.readBuffer(e);
      const r = tweak(e.name, data);
      if (r === null) continue;
      if (r === undefined) await w.copyRaw(src, e);
      else if (Buffer.isBuffer(r)) await w.addBuffer(e.name, r, { mode: modeOf(e) });
      else await w.addBuffer(e.name, data, { mode: r.mode });
    }
    await extra?.(w);
    await w.finish();
    src.close();
    return file;
  }

  it('Mach-O 被改动一个字节 → 自检报错', async () => {
    const bad = await corrupt('bad-macho.zip', (n, d) => {
      if (n.endsWith('Contents/MacOS/Electron')) {
        const b = Buffer.from(d);
        b[10] ^= 1;
        return b;
      }
    });
    await expect(verify(official, bad)).rejects.toThrow(/内容不同.*Electron|Mach-O 被改动/s);
  });
  it('可执行位丢失 → 自检报错', async () => {
    const bad = await corrupt('bad-exec.zip', (n) => (n.endsWith('Contents/MacOS/Electron') ? { mode: 0o100644 } : undefined));
    await expect(verify(official, bad)).rejects.toThrow(/权限位不同|不可执行/);
  });
  it('符号链接指向变了 / 变成普通文件 → 自检报错', async () => {
    const bad = await corrupt('bad-link.zip', (n) => (n.endsWith('Versions/Current') ? Buffer.from('B') : undefined));
    await expect(verify(official, bad)).rejects.toThrow(/内容不同|指向不同/);
    const bad2 = await corrupt('bad-link2.zip', (n, d) => (n.endsWith('Versions/Current') ? { mode: 0o100644 } : undefined));
    await expect(verify(official, bad2)).rejects.toThrow(/权限位不同|符号链接/);
  });
  it('丢了条目 / 多了不该有的条目 / Info.plist 坏了 / icns 坏了 → 自检报错', async () => {
    const lost = await corrupt('bad-lost.zip', (n) => (n.endsWith('Localizable.strings') ? null : undefined));
    await expect(verify(official, lost)).rejects.toThrow(/缺少条目/);
    const extra = await corrupt('bad-extra.zip', () => undefined, (w) => w.addBuffer('繁体简读.app/Contents/Resources/payload.dylib', Buffer.from('x'), { mode: 0o100755 }));
    await expect(verify(official, extra)).rejects.toThrow(/多出了不允许的条目/);
    const plist = await corrupt('bad-plist.zip', (n, d) => (n.endsWith('Contents/Info.plist') ? Buffer.from(d.toString().replace(/<string>Electron<\/string>/, '<string>Renamed</string>')) : undefined));
    await expect(verify(official, plist)).rejects.toThrow(/CFBundleExecutable|MacOS\/Renamed/);
    const icns = await corrupt('bad-icns.zip', (n, d) => (n.endsWith('icon.icns') ? d.subarray(0, d.length - 7) : undefined));
    await expect(verify(official, icns)).rejects.toThrow(/icns/);
  });
  it('官方包结构不对（没有 Info.plist）时组装就报错', async () => {
    const f = writeOfficial('official-noplist.zip', (z) => void delete z[`${OFFICIAL_APP}/Contents/Info.plist`]);
    await expect(assemble(f, 'x.zip')).rejects.toThrow(/结构和预期不一致/);
  });
});
