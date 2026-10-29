import { defineConfig } from '@playwright/test';

// Electron 外壳的端到端测试：用 Playwright 的 _electron.launch 启动**打包后的** release/繁体简读/繁体简读.exe
// （见 e2e-electron/electron.spec.ts）。先 `pnpm --filter app pack:win`，再 `pnpm --filter app e2e:electron`。
// 测试用 FJD_USER_DATA 指向临时数据目录，并带 --no-register，不会碰真实数据、开始菜单和文件关联。
export default defineConfig({
  testDir: './e2e-electron',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
