# 繁体简读

繁体中文电子书，打开就是简体。

<!-- screenshot -->

- 字形、词汇、标点三层转换：幣 → 币，軟體 → 软件，「」 → “”。可随时切回原文。
- 竖排书自动转横排；PDF 转制书里多余的空格和断行自动清理。
- 原文件不会被修改，所有处理都在本机完成，不联网。

支持 epub、mobi、azw3、fb2、txt。界面参考 macOS 图书。

## 下载

下载地址：见 Releases

- **Windows 10/11（x64）**：解压 zip，双击文件夹里的 `繁体简读.exe`。没有安装程序。首次运行会为当前用户创建快捷方式，并为 `.epub`、`.mobi`、`.azw3`、`.fb2` 注册“打开方式”，在 设置 → 关于 里可以移除。
- **macOS 13 或更新（Apple 芯片 / Intel）**：下载对应版本的 zip（`mac-arm64` 或 `mac-x64`）。App 没有 Apple 签名，第一次打开要多做两步：

  1. 解压，把“繁体简读”拖进“应用程序”。
  2. 打开“终端”，执行：

     ```
     xattr -cr /Applications/繁体简读.app
     codesign --force --deep --sign - /Applications/繁体简读.app
     ```

  3. 双击打开。如果仍被拦住，在 系统设置 → 隐私与安全性 里点“仍要打开”。

  两条命令都在你自己的 Mac 上执行，不需要联网。每次更新到新版本后重做一遍。

书、封面、标注和设置保存在本机：Windows 在 `%APPDATA%\繁体简读\`，macOS 在 `~/Library/Application Support/繁体简读/`。

## 从源码构建

需要 Node 24 和 pnpm 12。

```
pnpm install
pnpm -r typecheck
pnpm -r test
pnpm --filter app pack:win     # 产物在 app/release/
pnpm --filter app pack:mac
```

- 开发：`pnpm --filter app dev`，用浏览器打开（数据存在 IndexedDB）。
- 网页版端到端测试：`pnpm --filter app exec playwright test`（默认使用本机 Edge，设置 `FJD_BROWSER=chromium` 可改用 Playwright 自带的 Chromium）。
- 桌面外壳是 Electron 官方发布的二进制，原样使用、不做修改；应用代码在 `resources/app.asar` 里，不含原生模块。`pack:win` 会校验 exe 的 SHA-256 与官方文件一致，`pack:mac` 会逐字节校验所有 Mach-O 文件未被改动。`pack:mac` 在 Windows 上也能运行。
- 仓库里还保留着 Tauri 外壳（`app/src-tauri/`），不作为交付。

## 文档

- [产品说明](docs/PRD.md)
- [技术设计](docs/ARCHITECTURE.md)
- [视觉与交互规格](docs/DESIGN.md)

## 许可

[MIT](LICENSE)。第三方组件的许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
