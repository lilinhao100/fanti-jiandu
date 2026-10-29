import { defineConfig } from '@playwright/test';

// Tauri 外壳的端到端测试：不启动 dev server，直接拉起打包好的 exe（见 e2e-tauri/m3.spec.ts）。
// 先 `pnpm --filter app tauri build`，再 `pnpm --filter app e2e:tauri`。
export default defineConfig({
  testDir: './e2e-tauri',
  timeout: 180_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
});
