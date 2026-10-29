// pack-win.mjs 和 pack-mac.mjs 共用的步骤：构建界面和主进程、生成 app.asar（两个平台是同一份）。
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackage } from '@electron/asar';
import { build as viteBuild } from 'vite';
import { buildElectron } from './build-electron.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

export const appDir = path.resolve(here, '..');
export const repoRoot = path.resolve(appDir, '..');
export const pkg = JSON.parse(fs.readFileSync(path.join(appDir, 'package.json'), 'utf8'));
export const NAME = '繁体简读';
export const releaseDir = path.join(appDir, 'release');

export const step = (s) => console.log(`\n== ${s}`);
export const fail = (msg) => {
  console.error(`\n打包失败：${msg}`);
  process.exit(1);
};

export function sha256(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

export async function run(cmd, args, cwd) {
  const { spawn } = await import('node:child_process');
  await new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: 'inherit' });
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} 退出码 ${code}`))));
  });
}

export async function walk(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full));
  }
  return out;
}

/** 构建渲染进程（tsc + vite build）和主进程（esbuild） */
export async function buildApp() {
  step('构建渲染进程和主进程');
  await run(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit'], appDir);
  await viteBuild({ root: appDir, logLevel: 'warn' });
  await buildElectron();
  for (const f of ['dist/index.html', 'dist-electron/main.cjs', 'dist-electron/preload.cjs']) {
    if (!fs.existsSync(path.join(appDir, f))) fail(`缺少构建产物：${f}`);
  }
}

/** 生成 app.asar（package.json + dist + dist-electron）。红线：包里不能有原生模块 */
export async function makeAppAsar(outFile, stageName = '.stage') {
  step('生成 app.asar');
  const stageDir = path.join(releaseDir, stageName);
  await fsp.rm(stageDir, { recursive: true, force: true });
  await fsp.mkdir(stageDir, { recursive: true });
  await fsp.writeFile(
    path.join(stageDir, 'package.json'),
    JSON.stringify({ name: 'fantijiandu', productName: NAME, version: pkg.version, main: 'dist-electron/main.cjs' }, null, 2),
  );
  await fsp.cp(path.join(appDir, 'dist'), path.join(stageDir, 'dist'), { recursive: true });
  await fsp.cp(path.join(appDir, 'dist-electron'), path.join(stageDir, 'dist-electron'), { recursive: true });
  const natives = (await walk(stageDir)).filter((f) => /\.(node|dll|exe|dylib)$/i.test(f));
  if (natives.length > 0) fail(`app 里不允许有原生文件：${natives.join(', ')}`);
  await fsp.mkdir(path.dirname(outFile), { recursive: true });
  await createPackage(stageDir, outFile);
  await fsp.rm(stageDir, { recursive: true, force: true });
}
