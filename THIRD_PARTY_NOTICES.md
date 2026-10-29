# 第三方许可声明

繁体简读本身以 MIT 协议发布（见 `LICENSE`）。下面列出随软件分发、或随源码仓库分发的第三方组件及其许可。

## 随源码仓库分发的文件

| 组件 | 位置 | 许可 | 说明 |
|---|---|---|---|
| [foliate-js](https://github.com/johnfactotum/foliate-js)（John Factotum） | `vendor/foliate-js/` | MIT | 电子书解析与分页渲染。许可全文见 `vendor/foliate-js/LICENSE`，固定的 commit 与修改情况见 `vendor/README.md` |
| [zip.js](https://github.com/gildas-lormeau/zip.js) | `vendor/foliate-js/vendor/zip.js` | BSD-3-Clause | foliate-js 自带 |
| [fflate](https://github.com/101arrowz/fflate)（Arjun Barrett） | `vendor/foliate-js/vendor/fflate.js` | MIT | foliate-js 自带 |
| [PDF.js](https://mozilla.github.io/pdf.js/)（Mozilla Foundation） | `vendor/foliate-js/vendor/pdfjs/` | Apache-2.0 | foliate-js 自带；其中的 CMap 与标准字体（Foxit、Liberation）分别带有 `LICENSE_FOXIT`、`LICENSE_LIBERATION` |
| [Noto Serif SC](https://fonts.google.com/noto/specimen/Noto+Serif+SC)（思源宋体）的子集 | `fixtures/fonts/NotoSerifSC-subset.ttf` | SIL Open Font License 1.1 | 仅用于字体导入的自动化测试，不随应用分发。许可全文见 `fixtures/fonts/OFL.txt` |

应用图标（`docs/icon/final/`、`app/src-tauri/icons/`）中的印文“简”由思源宋体（Source Han Serif，SIL Open Font License 1.1）的字形转成轮廓后绘制。

## 随应用分发的依赖（打进 app.asar 的代码）

| 组件 | 版本 | 许可 | 版权 |
|---|---|---|---|
| [React](https://github.com/facebook/react)、react-dom、scheduler | 18.3.x | MIT | Meta Platforms, Inc. 及其关联公司 |
| [zustand](https://github.com/pmndrs/zustand) | 5.x | MIT | Paul Henschel |
| [@phosphor-icons/react](https://github.com/phosphor-icons/react)（界面图标） | 2.1.x | MIT | Phosphor Icons |
| [fflate](https://github.com/101arrowz/fflate) | 0.8.x | MIT | Arjun Barrett |
| [opencc-js](https://github.com/nk2028/opencc-js) | 1.4.x | MIT AND Apache-2.0 | The nk2028 Project |
| [OpenCC](https://github.com/BYVoid/OpenCC) 词典数据（经 opencc-data 生成，内置于 opencc-js） | — | Apache-2.0 | BYVoid 及 OpenCC 贡献者 |

Apache-2.0 全文见 `licenses/Apache-2.0.txt`。

## Electron

桌面版直接使用 [Electron](https://github.com/electron/electron) 官方发布的二进制文件，不做任何修改。

- Electron：MIT，Copyright (c) Electron contributors，Copyright (c) 2013-2020 GitHub Inc.
- Electron 内含的 Chromium、Node.js 及其依赖，各自的许可声明随官方发行包一起提供（`LICENSE`、`LICENSES.chromium.html`），本项目的压缩包保留这些文件。

## 构建与测试用的依赖（不随应用分发）

| 组件 | 许可 |
|---|---|
| @electron/asar、@electron/get | MIT |
| esbuild | MIT |
| vite、@vitejs/plugin-react、vitest | MIT |
| TypeScript | Apache-2.0 |
| @playwright/test | Apache-2.0 |
| linkedom | ISC |
| iconv-lite | MIT |
| yauzl、plist | MIT |
| fake-indexeddb | Apache-2.0 |
| @tauri-apps/api、@tauri-apps/plugin-dialog、@tauri-apps/plugin-fs、@tauri-apps/cli | Apache-2.0 OR MIT |
| tsx | MIT |

仓库中保留的 Tauri 外壳（`app/src-tauri/`）不作为交付；它依赖的 Rust crate 见 `app/src-tauri/Cargo.lock`，各自带有许可声明。

各依赖的准确版本见 `pnpm-lock.yaml`。
