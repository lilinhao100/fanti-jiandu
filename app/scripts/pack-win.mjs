// Windows 交付包：解压即用的文件夹 release/繁体简读/ 和它的 zip。
//   1. 构建渲染进程（tsc + vite build）和主进程（esbuild）
//   2. 复制官方 Electron 的 dist/，electron.exe 改名为 繁体简读.exe，删掉 default_app.asar
//   3. 生成 resources/app.asar（package.json + dist + dist-electron）
//   4. 复制 icon.ico 到 resources
//   5. 校验 繁体简读.exe 与官方 electron.exe 的 SHA256 完全一致，不一致就报错退出
//   6. 打成 release/繁体简读-<version>-win-x64.zip
// 红线：exe 一个字节都不能动（不改图标、不改版本信息、不重新签名、不打补丁），保证它与官方发布的文件完全一致。
// 构建和 asar 的步骤与 macOS 版共用（common.mjs）。只清理自己的产物，不动 release/ 里的 mac 包。
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { Zip, ZipDeflate } from 'fflate';
import { NAME, buildApp, fail, makeAppAsar, pkg, releaseDir, repoRoot, sha256, step, walk } from './common.mjs';

const require = createRequire(import.meta.url);
const outDir = path.join(releaseDir, NAME);
const zipPath = path.join(releaseDir, `${NAME}-${pkg.version}-win-x64.zip`);
const iconSrc = path.join(repoRoot, 'docs', 'icon', 'final', 'icon.ico');

/** 流式 zip，条目名用 UTF-8（fflate 遇到非 ASCII 会置位），顶层是 繁体简读/ */
async function zipDir(dir, topName, zipFile) {
  const files = await walk(dir);
  const out = fs.createWriteStream(zipFile);
  const zip = new Zip();
  let error = null;
  const done = new Promise((resolve, reject) => {
    out.on('finish', resolve);
    out.on('error', reject);
  });
  zip.ondata = (err, chunk, final) => {
    if (err) {
      error = err;
      return;
    }
    out.write(chunk);
    if (final) out.end();
  };
  for (const rel of files) {
    const entry = new ZipDeflate(`${topName}/${rel.split(path.sep).join('/')}`, { level: 6 });
    zip.add(entry);
    const rs = fs.createReadStream(path.join(dir, rel), { highWaterMark: 1 << 20 });
    await new Promise((resolve, reject) => {
      rs.on('data', (c) => entry.push(new Uint8Array(c), false));
      rs.on('end', () => {
        entry.push(new Uint8Array(0), true);
        resolve();
      });
      rs.on('error', reject);
    });
    if (error) throw error;
  }
  zip.end();
  await done;
}

// ---------------------------------------------------------------- 1. 构建
await buildApp();

// ---------------------------------------------------------------- 2. 复制官方 Electron
step('复制官方 Electron');
const electronPkgDir = path.dirname(require.resolve('electron/package.json'));
const electronDist = path.join(electronPkgDir, 'dist');
const electronExe = path.join(electronDist, 'electron.exe');
if (!fs.existsSync(electronExe)) fail(`没有 ${electronExe}。运行 node ${path.join(electronPkgDir, 'install.js')} 下载官方二进制`);
await fsp.rm(outDir, { recursive: true, force: true });
await fsp.rm(zipPath, { force: true });
await fsp.mkdir(releaseDir, { recursive: true });
await fsp.cp(electronDist, outDir, { recursive: true });
const exePath = path.join(outDir, `${NAME}.exe`);
await fsp.rename(path.join(outDir, 'electron.exe'), exePath);
await fsp.rm(path.join(outDir, 'resources', 'default_app.asar'), { force: true });
// Chromium 自带 55 种界面语言包（约 49MB），只留简体中文和英文；删文件不动 exe，哈希不变
for (const f of await fsp.readdir(path.join(outDir, 'locales'))) {
  if (!['zh-CN.pak', 'en-US.pak'].includes(f)) await fsp.rm(path.join(outDir, 'locales', f));
}

// ---------------------------------------------------------------- 3. app.asar
await makeAppAsar(path.join(outDir, 'resources', 'app.asar'), '.stage-win');

// ---------------------------------------------------------------- 4. 图标
step('复制图标');
if (!fs.existsSync(iconSrc)) fail(`没有图标 ${iconSrc}`);
await fsp.copyFile(iconSrc, path.join(outDir, 'resources', 'icon.ico'));

// ---------------------------------------------------------------- 5. 校验
step('校验 exe 哈希');
const [a, b] = await Promise.all([sha256(exePath), sha256(electronExe)]);
console.log(`  ${NAME}.exe        ${a}`);
console.log(`  electron.exe(官方) ${b}`);
if (a !== b) fail('exe 的 SHA256 与官方 electron.exe 不一致，信誉会失效');
console.log('  一致');

// ---------------------------------------------------------------- 6. zip
step('生成 zip');
await zipDir(outDir, NAME, zipPath);
const size = fs.statSync(zipPath).size;
console.log(`  ${zipPath}  ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`\n完成：${outDir}`);
