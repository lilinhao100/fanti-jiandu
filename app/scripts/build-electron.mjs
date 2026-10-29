// 用 esbuild 把主进程和预加载脚本编译到 app/dist-electron/。
// 输出 .cjs：app/package.json 是 "type": "module"，而 Electron 的 sandbox 预加载脚本必须是 CommonJS。
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

export async function buildElectron() {
  await build({
    entryPoints: {
      main: path.join(root, 'electron/main.ts'),
      preload: path.join(root, 'electron/preload.ts'),
    },
    outdir: path.join(root, 'dist-electron'),
    outExtension: { '.js': '.cjs' },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    external: ['electron'],
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'info',
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildElectron();
}
