import { defineConfig } from '@playwright/test';

// Playwright 自带的浏览器下载失败时，用本机已安装的 Edge（见 ARCHITECTURE 第 4 节）。
// 默认先试 msedge；设置 FJD_BROWSER=chromium 可改用 Playwright 自带的 Chromium。
const channel = process.env.FJD_BROWSER === 'chromium' ? undefined : 'msedge';

// 默认测 dev server；FJD_PREVIEW=1 时测生产构建（先运行 pnpm --filter app build，再由 vite preview 提供）
const preview = process.env.FJD_PREVIEW === '1';
// FJD_PORT：同时有别的工作区在跑 e2e 时换个端口，免得抢 5173
const port = Number(process.env.FJD_PORT) || (preview ? 4173 : 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${port}`,
    channel,
    headless: true,
    viewport: { width: 1280, height: 800 },
    acceptDownloads: false,
    trace: 'off',
  },
  // dev server 只在测试期间由 Playwright 启动并随测试结束关闭，不会常驻。
  webServer: {
    command: preview ? `pnpm exec vite preview --port ${port} --strictPort` : `pnpm exec vite --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
