// macOS 交付包：release/繁体简读-<version>-mac-arm64.zip 和 ...-mac-x64.zip。在 Windows 上组装，不编译任何东西。
//   1. 构建界面和主进程，生成 app.asar（与 Windows 版是同一份）
//   2. 下载官方 Electron 45.1.0 的 darwin-arm64、darwin-x64 包，用官方 SHASUMS256 校验
//   3. 流式搬运：读官方 zip 的条目，原样写进新 zip（保留权限位和符号链接），只改允许改的几样（见 mac/assemble.ts）
//   4. 自检（mac/verify.ts）：任何一项不过就报错退出
// 红线：Mach-O 二进制（可执行文件、.dylib、.framework 里的二进制）一个字节都不能改；
//       不在 NTFS 上解压 macOS 的 zip；不使用原生 Node 模块。
// 运行：pnpm --filter app pack:mac（脚本是 .ts 模块，由 node 直接运行；走代理下载时靠 --use-env-proxy）。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { NAME, buildApp, fail, makeAppAsar, pkg, releaseDir, repoRoot, sha256, step } from './common.mjs';
import { assembleMacZip, OFFICIAL_APP } from './mac/assemble.ts';
import { fetchOfficialMacZip } from './mac/download.ts';
import { buildIcnsFromDir, parseIcns } from './mac/icns.ts';
import { parseInfoPlist } from './mac/info-plist.ts';
import { firstOpenText, minOsText } from './mac/readme.ts';
import { verifyMacZip } from './mac/verify.ts';
import { ZipSource } from './mac/zip.ts';

const ELECTRON_VERSION = pkg.devDependencies.electron; // 与 Windows 版同一版本（package.json 里固定的 45.1.0）
const ARCHES = ['arm64', 'x64'];
const asarPath = path.join(releaseDir, '.mac-app.asar');
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------- 1. 构建
await buildApp();
await makeAppAsar(asarPath, '.stage-mac');
const asarSha = await sha256(asarPath);
const appAsar = await fsp.readFile(asarPath);
console.log(`  app.asar ${mb(appAsar.length)}  sha256 ${asarSha.slice(0, 16)}…`);

// ---------------------------------------------------------------- 2. 图标
step('生成 icon.icns（纯 JS）');
const icns = buildIcnsFromDir(path.join(repoRoot, 'docs', 'icon', 'final'));
parseIcns(icns);
console.log(`  ${icns.length} 字节，8 个 PNG 块（ic07–ic14）`);

// ---------------------------------------------------------------- 3. 下载、组装、自检
const results = [];
for (const arch of ARCHES) {
  step(`官方 Electron ${ELECTRON_VERSION} darwin-${arch}`);
  let official;
  try {
    official = await fetchOfficialMacZip(ELECTRON_VERSION, arch);
  } catch (e) {
    fail(`下载或校验官方包失败（darwin-${arch}）：${e instanceof Error ? e.message : e}`);
  }
  console.log(`  ${official.file}\n  SHA-256 ${official.sha256}（与官方 SHASUMS256 一致）`);

  // 最低系统版本取自官方 Info.plist
  const src = await ZipSource.open(official.file);
  const plistEntry = src.entries.find((e) => e.name === `${OFFICIAL_APP}/Contents/Info.plist`);
  if (!plistEntry) fail('官方包里没有 Info.plist');
  const officialInfo = parseInfoPlist((await src.readBuffer(plistEntry)).toString('utf8'));
  src.close();
  const minOs = minOsText(String(officialInfo.LSMinimumSystemVersion ?? ''));

  const outZip = path.join(releaseDir, `${NAME}-${pkg.version}-mac-${arch}.zip`);
  await fsp.mkdir(releaseDir, { recursive: true });
  await fsp.rm(outZip, { force: true });
  step(`组装 ${path.basename(outZip)}`);
  await assembleMacZip({ officialZip: official.file, outZip, appAsar, icns, version: pkg.version, readme: firstOpenText({ version: pkg.version, minOs }) });

  step(`自检 ${path.basename(outZip)}`);
  let report;
  try {
    report = await verifyMacZip({ officialZip: official.file, newZip: outZip, version: pkg.version, appAsarSha256: asarSha });
  } catch (e) {
    await fsp.rm(outZip, { force: true });
    fail(e instanceof Error ? e.message : String(e));
  }
  console.log(
    `  通过：${report.entries} 个条目；逐字节相同 ${report.compared} 个（其中 Mach-O ${report.machO} 个）；符号链接 ${report.symlinks} 个、可执行文件 ${report.executables} 个，指向与权限位均相同`,
  );
  console.log(`  改动：${report.changed.join('、')}；删除：${report.removed.join('、')}；新增：${report.added.join('、')}`);
  results.push({ outZip, size: fs.statSync(outZip).size, sha: await sha256(outZip), minOs });
}
await fsp.rm(asarPath, { force: true });

console.log('\n完成：');
for (const r of results) console.log(`  ${r.outZip}  ${mb(r.size)}  sha256 ${r.sha}`);
console.log(`  系统要求（取自官方 Info.plist）：${results[0].minOs}`);
