// 从 app/src-tauri/icon-source.png（1024×1024）生成全套应用图标到 app/src-tauri/icons/。
// 替换 icon-source.png 后运行：pnpm --filter app icons
// tauri icon 还会生成 android/ios/icns，本项目只发 Windows，生成后删掉，避免把用不到的文件提交进仓库。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(app, 'src-tauri', 'icon-source.png');
if (!fs.existsSync(source)) {
  console.error(`找不到 ${source}`);
  process.exit(1);
}
const r = spawnSync('pnpm', ['exec', 'tauri', 'icon', source], { cwd: app, stdio: 'inherit', shell: true });
if (r.status !== 0) process.exit(r.status ?? 1);
const icons = path.join(app, 'src-tauri', 'icons');
for (const name of ['android', 'ios', 'icon.icns']) fs.rmSync(path.join(icons, name), { recursive: true, force: true });
console.log('图标已生成：', icons);
