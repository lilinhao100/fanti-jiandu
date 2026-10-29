// 自检：新 zip 和官方 zip 逐条目比对，任何一项不过就抛错（打包脚本据此报错退出）。
//   1. 除了允许改动的文件，所有条目的内容逐字节相同（解压后比 SHA-256，并核对 CRC 与大小），Mach-O 单独再点一遍名；
//   2. 符号链接条目：数量相同、指向相同；
//   3. 权限位：每个条目的 st_mode 完全相同（含可执行位）；
//   4. Info.plist 能解析回来，字段正确；
//   5. icns 结构合法；
//   另外：没有多出来或少掉的条目，条目名含中文的都置了 UTF-8 位，Contents/MacOS 里确有 CFBundleExecutable 指向的可执行文件。
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';
import { parseIcns } from './icns.ts';
import { NEW_APP, OFFICIAL_APP, PLAN, README_NAME, mapName } from './assemble.ts';
import { checkInfoPlist } from './info-plist.ts';
import { ZipSource, isDirectory, isExecutable, isSymlink, isUnix, modeOf, type ZipEntryInfo } from './zip.ts';

export interface VerifyReport {
  entries: number;
  compared: number;
  symlinks: number;
  executables: number;
  machO: number;
  changed: string[];
  added: string[];
  removed: string[];
}

interface Digest {
  sha256: string;
  size: number;
  crc: number;
  magic: Buffer;
}

async function digest(src: ZipSource, e: ZipEntryInfo): Promise<Digest> {
  const h = crypto.createHash('sha256');
  let size = 0;
  let crc = 0;
  let magic = Buffer.alloc(0);
  const rs: Readable = await src.openDecoded(e);
  for await (const c of rs) {
    const b = c as Buffer;
    if (magic.length < 4) magic = Buffer.concat([magic, b.subarray(0, 4 - magic.length)]);
    h.update(b);
    size += b.length;
    crc = zlib.crc32(b, crc);
  }
  return { sha256: h.digest('hex'), size, crc: crc >>> 0, magic };
}

const MACHO_MAGICS = new Set(['feedface', 'feedfacf', 'cefaedfe', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca']);
const isMachO = (magic: Buffer): boolean => magic.length === 4 && MACHO_MAGICS.has(magic.toString('hex'));

/** 官方 zip 里这个条目在新 zip 里应该叫什么、该怎么处理 */
function classify(official: ZipEntryInfo): 'removed' | 'replaced' | 'same' {
  if ((PLAN.removed as readonly string[]).includes(official.name)) return 'removed';
  if ((PLAN.replaced as readonly string[]).includes(official.name)) return 'replaced';
  return 'same';
}

export async function verifyMacZip(o: { officialZip: string; newZip: string; version: string; appAsarSha256: string }): Promise<VerifyReport> {
  const problems: string[] = [];
  const bad = (m: string): void => void problems.push(m);
  const A = await ZipSource.open(o.officialZip);
  const B = await ZipSource.open(o.newZip);
  const report: VerifyReport = { entries: B.entries.length, compared: 0, symlinks: 0, executables: 0, machO: 0, changed: [], added: [], removed: [] };
  try {
    const byName = new Map<string, ZipEntryInfo>();
    for (const e of B.entries) {
      if (byName.has(e.name)) bad(`新 zip 里条目重名：${e.name}`);
      byName.set(e.name, e);
      if (/[^\x00-\x7f]/.test(e.name) && !(e.flags & 0x0800)) bad(`条目名含中文但没有置 UTF-8 位：${e.name}`);
      if (!isUnix(e)) bad(`条目不是 unix 创建的（权限位无效）：${e.name}`);
    }

    // 1~3：逐条目比对
    const consumed = new Set<string>();
    let officialSymlinks = 0;
    let officialExec = 0;
    for (const a of A.entries) {
      const kind = classify(a);
      const newName = mapName(a.name);
      const b = byName.get(newName);
      if (kind === 'removed') {
        report.removed.push(a.name);
        if (b) bad(`应当删除的条目还在：${newName}`);
        continue;
      }
      if (!b) {
        bad(`缺少条目：${newName}`);
        continue;
      }
      consumed.add(newName);
      if (kind === 'replaced') {
        report.changed.push(newName);
        if (modeOf(a) !== modeOf(b)) bad(`${newName} 的权限位变了：${modeOf(a).toString(8)} → ${modeOf(b).toString(8)}`);
        continue;
      }
      report.compared++;
      // 权限位（含文件类型、可执行位）
      if (modeOf(a) !== modeOf(b)) bad(`权限位不同 ${newName}：官方 ${modeOf(a).toString(8)}，新 ${modeOf(b).toString(8)}`);
      if (isDirectory(a) !== isDirectory(b)) bad(`目录属性不同：${newName}`);
      if (isSymlink(a)) officialSymlinks++;
      if (isExecutable(a)) officialExec++;
      if (isDirectory(a)) continue;
      const [da, db] = [await digest(A, a), await digest(B, b)];
      if (da.crc !== a.crc32) bad(`官方 zip 里 ${a.name} 的 CRC 与中央目录不符（官方文件损坏？）`);
      if (db.crc !== b.crc32) bad(`新 zip 里 ${newName} 的 CRC 与中央目录不符`);
      if (da.size !== db.size || da.sha256 !== db.sha256) bad(`内容不同 ${newName}（SHA-256 官方 ${da.sha256.slice(0, 12)}…，新 ${db.sha256.slice(0, 12)}…）`);
      if (isMachO(da.magic)) {
        report.machO++;
        if (da.sha256 !== db.sha256) bad(`Mach-O 被改动：${newName}`);
      }
      if (isSymlink(a)) {
        // 链接目标就是条目内容；上面 SHA 相同即指向相同，这里再显式读出来比一次，错误信息更直白
        const [ta, tb] = [(await A.readBuffer(a)).toString('utf8'), (await B.readBuffer(b)).toString('utf8')];
        if (ta !== tb) bad(`符号链接指向不同 ${newName}：${ta} → ${tb}`);
        if (!isSymlink(b)) bad(`符号链接变成了普通条目：${newName}`);
      }
    }
    report.symlinks = officialSymlinks;
    report.executables = officialExec;
    const newSymlinks = B.entries.filter(isSymlink).length;
    const newExec = B.entries.filter(isExecutable).length;
    if (newSymlinks !== officialSymlinks) bad(`符号链接数量不同：官方 ${officialSymlinks}，新 ${newSymlinks}`);
    // 新 zip 里的可执行文件 = 官方的 + 0（新增的文件都不是可执行的）
    if (newExec !== officialExec) bad(`可执行文件数量不同：官方 ${officialExec}，新 ${newExec}`);

    // 多出来的条目必须恰好是允许新增的
    const allowedAdded = new Set<string>(PLAN.added);
    for (const e of B.entries) {
      if (consumed.has(e.name)) continue;
      if (allowedAdded.has(e.name)) report.added.push(e.name);
      else bad(`多出了不允许的条目：${e.name}`);
    }
    for (const n of allowedAdded) if (!byName.has(n)) bad(`缺少应新增的条目：${n}`);
    if (byName.has(`${OFFICIAL_APP}/`) || [...byName.keys()].some((n) => n.startsWith(`${OFFICIAL_APP}/`))) bad(`新 zip 里还有 ${OFFICIAL_APP}/ 开头的条目`);

    // 4：Info.plist
    const plistEntry = byName.get(`${NEW_APP}/Contents/Info.plist`);
    let exeName = 'Electron';
    if (plistEntry) {
      try {
        const info = checkInfoPlist((await B.readBuffer(plistEntry)).toString('utf8'), { version: o.version });
        exeName = String(info.CFBundleExecutable);
      } catch (e) {
        bad(e instanceof Error ? e.message : String(e));
      }
    } else bad('新 zip 里没有 Info.plist');
    const exe = byName.get(`${NEW_APP}/Contents/MacOS/${exeName}`);
    if (!exe) bad(`Contents/MacOS/${exeName} 不存在`);
    else if (!isExecutable(exe)) bad(`Contents/MacOS/${exeName} 不可执行（权限 ${modeOf(exe).toString(8)}）`);

    // 5：icns
    const icns = byName.get(`${NEW_APP}/Contents/Resources/icon.icns`);
    if (icns) {
      try {
        parseIcns(await B.readBuffer(icns));
      } catch (e) {
        bad(e instanceof Error ? e.message : String(e));
      }
    }

    // app.asar 与我们生成的是同一份
    const asar = byName.get(`${NEW_APP}/Contents/Resources/app.asar`);
    if (asar) {
      const d = await digest(B, asar);
      if (d.sha256 !== o.appAsarSha256) bad(`app.asar 的 SHA-256 与生成的不一致`);
      if (d.crc !== asar.crc32) bad('app.asar 的 CRC 不符');
    }
    const readme = byName.get(README_NAME);
    if (readme && (await B.readBuffer(readme)).length === 0) bad('首次打开说明.txt 是空的');
  } finally {
    A.close();
    B.close();
  }
  if (problems.length > 0) throw new Error(`自检未通过（${problems.length} 项）：\n  ${problems.slice(0, 30).join('\n  ')}`);
  return report;
}
