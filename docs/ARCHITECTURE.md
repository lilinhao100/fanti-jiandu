# 繁体简读 · 技术设计

> 本文是实现的依据；要偏离的地方，先在本文“变更记录”里写明理由。

## 1. 仓库结构

```
fanti-jiandu/
├─ package.json            pnpm workspace 根（只放脚本，不放依赖）
├─ pnpm-workspace.yaml     packages/*, app
├─ packages/
│  ├─ engine/              纯 TS 转换引擎：检测、繁转简、排版清理、txt 解码分章。不依赖 DOM 实现，不依赖 Tauri
│  └─ cli/                 开发工具：fjd convert in.epub out.epub、fjd report in.epub（给人和测试看效果）
├─ app/                    Vite + React 18 + TS 前端；app/src-tauri 是 Tauri 2 外壳
├─ vendor/foliate-js/      foliate-js 源码（git clone，固定 commit，MIT），前端直接 import
├─ fixtures/               合成测试用例（自己写的小段 xhtml、txt）
└─ docs/                   产品说明、本文、DESIGN、笔记
```

工具链：Node 24、pnpm 12、TypeScript 5（strict）、Vitest、ESLint 不强制。Rust stable + Tauri 2（app/src-tauri）。

## 2. 引擎 `@fjd/engine`

### 2.1 原则
- 纯函数，输入是字符串或 DOM `Document`，输出也是字符串或 DOM `Document`。没有 I/O。
- 运行环境：浏览器（WebView2）和 Node（测试）。需要 `DOMParser`、`XMLSerializer` 的地方，由调用方注入；Node 测试里用 `linkedom` 注入。
- 同样的输入加同样的选项，必须得到同样的输出（确定性）。标注定位依赖这一点。
- 导出常量 `ENGINE_VERSION`。规则一旦改动，版本号就加一。

### 2.2 API

```ts
export const ENGINE_VERSION: number;

export type Variant = 'tw' | 'hk' | 't';          // 台湾 / 香港 / 通用繁体
export interface ScriptInfo {
  script: 'hant' | 'hans' | 'mixed' | 'none';
  confidence: number;                              // 0..1
  variant: Variant;
}
export function detectScript(sample: string, langHint?: string): ScriptInfo;

export interface ConvertOptions {
  convert: boolean;        // 总开关（繁/简按钮）
  vocabulary: boolean;     // 词汇层：tw → twp 词典；hk/t 时没有词汇层
  quotes: boolean;         // 「」『』 → “”‘’
  cleanup: boolean;        // 排版清理总开关（只有 ctx.pdfReflow 为真才真正执行 R1、R2）
  horizontal: boolean;     // 竖排转横排
  variant: Variant;
}
export const DEFAULT_OPTIONS: ConvertOptions;

/** 纯文本转换（书名、作者、目录、搜索词） */
export function convertText(s: string, opts: ConvertOptions): string;

export interface BookContext { pdfReflow: boolean; }
/** 判断是否 PDF 转制：传入前若干章的原始 xhtml 文本 */
export function detectPdfReflow(sectionsXhtml: string[]): boolean;

export interface TransformEnv { DOMParser: typeof DOMParser; XMLSerializer: typeof XMLSerializer; }
export interface TransformStats { convertedChars: number; spacesRemoved: number; paragraphsMerged: number; }

/** 章节文档（xhtml/html）整体转换，供阅读器的加载钩子调用 */
export function transformMarkup(markup: string, mediaType: string, opts: ConvertOptions, ctx: BookContext, env: TransformEnv): { markup: string; stats: TransformStats };
/** 已经解析好的 Document 原地转换（transformMarkup 内部也调用它） */
export function transformDocument(doc: Document, opts: ConvertOptions, ctx: BookContext): TransformStats;
/** CSS 转换：horizontal 时把 writing-mode / -epub-writing-mode / -webkit-writing-mode 的 vertical-* 改成 horizontal-tb */
export function transformCss(css: string, opts: ConvertOptions): string;

/** txt：字节 → 文本（BOM、UTF-8 校验、GB18030 与 Big5 按解码错误率和用字统计判别） */
export function decodeText(bytes: Uint8Array): { text: string; encoding: string };
/** txt：文本 → 章节（识别“第X章/回/节/卷”、“Chapter N”、“序/楔子/后记”等标题行；找不到时每约 2 万字切一章） */
export function splitChapters(text: string): { title: string; paragraphs: string[] }[];
```

### 2.3 繁转简
- 使用 `opencc-js`。转换器按 (variant, vocabulary) 缓存。
  - tw + 词汇：`{ from: 'twp', to: 'cn' }`；tw 不带词汇：`{ from: 'tw', to: 'cn' }`。
  - hk：`{ from: 'hk', to: 'cn' }`；t：`{ from: 't', to: 'cn' }`。
- **按块转换**：每个块级元素（p、h1-6、li、td、dd、dt、blockquote、div、figcaption 等）先把直属的文本节点拼成一个字符串再转换，避免词语被行内标签切开。转换后长度不变的，按原来的偏移量拆回各个节点；长度变了的，退回逐个节点转换。
- 跳过：script、style、code、pre、kbd、samp、var、math、svg 内部。
- 属性：alt、title 也转换。`<title>` 也转换。
- 标点（quotes 开）：「→“ 」→” 『→‘ 』→’。horizontal 开时，竖排标点 U+FE10–FE19、U+FE30–FE4F 映射回普通标点（﹁﹂→“”，︵︶→（），︽︾→《》，︰→：，等等，完整映射表写在代码里，附测试）。
- 检测 `detectScript`：取样本里的汉字，用 t→cn 字表和 cn→t 字表分别统计只属于繁体、只属于简体的字。繁体比例 ≥ 0.6 判 hant，≤ 0.2 判 hans，中间判 mixed，没有汉字判 none。langHint 是 zh-HK、zh-MO 时 variant 取 hk；是 zh-TW、zh-Hant 或空时取 tw。

### 2.4 排版清理规则（宁可漏修，不可误伤）

记号：C = 汉字或全角标点（U+3000–303F、U+FF00–FFEF、U+4E00–9FFF、U+3400–4DBF、U+F900–FAFF、U+20000–2FFFF，以及“”‘’…—·）。

- **R0（所有书，cleanup 开即执行）**：C 与 C 之间、含换行的空白（`[ \t]*[\r\n]+[ \t]*`）整段删掉。原因：xhtml 源码在行中折行时，浏览器会把换行渲染成空格。
- **R1（只限 pdfReflow）**：C 与 C 之间的 ASCII 空格和 NBSP（1 到 3 个）删掉。全角空格 U+3000 保留。汉字与拉丁字母、数字之间的空格保留。
  - 跨节点的情况，比如 `<span>我 </span>非常`，按块拼接后统一处理。
- **R2（只限 pdfReflow）**：相邻的兄弟 `<p>` A 和 B，同时满足下面所有条件才合并：
  1. A 的 class 与 B 的 class 相同。
  2. A 去掉首尾空白后长度 ≥ 20，最后一个字符是汉字（不能是标点）。
  3. B 去掉首尾空白后第一个字符是汉字，或者是拉丁字母、数字后面紧跟汉字。B 不能以「“『‘（《【、项目符号、“第…章/节”开头。
  4. A 和 B 都不在 h1-6、li、td、th、figure、blockquote 里面。
  5. A、B 之间没有其他元素节点，也没有非空文本。
  - 合并方式：把 B 的子节点移到 A 的末尾，B 原有的 id 改为插在接缝处的空 `<span id>`，保证链接锚点仍然可用，然后删掉 B。连续断开的段落，可以链式合并。
- **R3（不做）**：删除页眉页脚和孤立的页码。误伤风险太高，留到以后。
- **detectPdfReflow**：满足下面任一条件就判定为 PDF 转制：
  - 任一章节 head 里有 `<meta name="generator" content="PDF Reflow…">`，或者有 `pdftohtml`、`ABBYY`。
  - 在所有含汉字的段落里，出现“C 空格 C”的段落占比 ≥ 15%，且总共 ≥ 30 处。

### 2.5 测试
- Vitest。每条规则都要有“该改的改了”和“不该改的没改”两类用例。不该改的包括：中英混排、诗歌短行、对话、署名、标题、列表、代码。
- `fixtures/xhtml/pdf-reflow.xhtml` 是自己写的 PDF 转制样例，覆盖 R1、R2 和各种“不该改”的情况。
- 词汇层：至少 30 组台湾词、10 组香港词的期望值。

## 3. 前端 `app/`

### 3.1 技术
- Vite + React 18 + TypeScript strict。状态管理用 zustand。样式用普通 CSS 文件加 CSS 变量（设计令牌，见 DESIGN.md），不用 UI 组件库，也不用 Tailwind。
- 图标：`@phosphor-icons/react`。
- 渲染：`vendor/foliate-js` 的 `<foliate-view>`（view.js）。用 Vite 别名 `foliate-js` 指向 vendor 目录。

### 3.2 窗口与路由
- 同一个前端包，按 URL hash 区分窗口：`#/library`（书库），`#/reader/:bookId`（阅读）。
- Tauri 里，书库是主窗口；每本书开一个新的 WebviewWindow（label 用 `reader-<bookId>`，同一本书已经开着就聚焦）。浏览器开发模式下，阅读窗口就在当前页面里切换路由。

### 3.3 平台适配层 `app/src/platform/`
前端只能通过这个接口访问外部环境：

```ts
interface Platform {
  kind: 'tauri' | 'web';
  // 书库
  listBooks(): Promise<BookRecord[]>;
  importFiles(input: File[] | string[]): Promise<ImportResult[]>;   // web 传 File，tauri 传路径
  readBookFile(id: string): Promise<File>;                          // 交给 foliate 打开
  updateBook(id: string, patch: Partial<BookRecord>): Promise<void>;
  removeBook(id: string): Promise<void>;
  saveCover(id: string, blob: Blob): Promise<string>;               // 返回可直接用作 <img src> 的 URL
  // 数据
  loadAnnotations(id: string): Promise<BookAnnotations>;
  saveAnnotations(id: string, a: BookAnnotations): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  // 窗口
  openReader(id: string): Promise<void>;
  onOpenFiles(cb: (paths: string[]) => void): () => void;           // 文件关联、单实例转发、拖放
  pickFiles(): Promise<File[] | string[]>;
  window: { minimize(): void; toggleMaximize(): void; close(): void; isMaximized(): Promise<boolean>; setTitle(t: string): void; };
}
```
- **web 实现**：IndexedDB（库名 `fjd`），存书文件、封面、JSON。开发和测试都用它：`pnpm --filter app dev`，然后用浏览器打开。
- **tauri 实现**：存储目录是 `appDataDir()/`，下面放 `books/<id>.<ext>`、`covers/<id>.jpg`、`library.json`、`annotations/<id>.json`、`settings.json`。使用插件：fs、dialog、single-instance、window-state。Rust 端只写最少的命令：`import_files(paths) -> Vec<ImportResult>`（计算 sha256 当作 id，复制文件）、`take_pending_open_files()`。
- 写 JSON 要原子：先写 `.tmp` 再重命名。

### 3.4 数据模型

```ts
interface BookRecord {
  id: string;               // 文件内容 sha256 的前 16 位十六进制；同一本书重复导入会去重
  title: string; author: string;   // 原始元数据（不转换；显示时再按设置转换）
  format: 'epub' | 'mobi' | 'azw3' | 'fb2' | 'txt';
  fileName: string; size: number;
  coverUrl?: string;        // 没有封面就显示生成的封面
  addedAt: number; lastOpenedAt?: number;
  progress?: { cfi: string; fraction: number; updatedAt: number };
  script?: ScriptInfo; pdfReflow?: boolean;   // 首次打开时检测并缓存
  display?: 'converted' | 'original';         // 繁/简按钮的状态，按书记住
}
interface Bookmark { id: string; cfi: string; label: string; createdAt: number; }
interface Highlight {
  id: string; cfi: string;
  text: string; prefix: string; suffix: string;    // 用于重新定位（各 32 字）
  style: 'yellow' | 'green' | 'blue' | 'pink' | 'purple' | 'underline';
  note?: string; createdAt: number; updatedAt: number;
  anchor: { mode: 'converted' | 'original'; engine: number; optsKey: string };
}
interface BookAnnotations { bookmarks: Bookmark[]; highlights: Highlight[]; history?: string[] }
interface Settings {
  appearance: { theme: ThemeId; mode: 'light' | 'dark' | 'auto'; fontStep: number; font: FontId;
    bold: boolean; custom: boolean; lineHeight: number; letterSpacing: number; wordSpacing: number; margin: number; justify: boolean };
  conversion: { vocabulary: boolean; quotes: boolean; cleanup: boolean; horizontal: boolean };
  library: { view: 'grid' | 'list'; sort: 'recent' | 'title' | 'author' | 'added' };
}
```

### 3.5 阅读器与引擎的接合（关键）
- 打开书：`platform.readBookFile(id)` 拿到 File，用 foliate 的 `makeBook(file)` 得到 book 对象，然后 `view.open(book)`。
- **转换钩子**：foliate-js 的 epub 加载器通过 `book.transformTarget` 派发 `data` 事件（detail 里有 `{ data, type, name }`），可以替换返回的内容。在这里：
  - type 是 xhtml 或 html 的，交给 `transformMarkup`。
  - type 是 css 的，交给 `transformCss`。
  - **以 vendor/foliate-js 源码为准**，确认这个钩子存在，并确认 mobi、fb2 走不走这条路径。不走的格式，在 `view` 的 `load` 事件里对 `doc` 调用 `transformDocument`，或者在 `section.createDocument`、`section.load` 外面包一层。最终要保证 5 种格式都能转换，**书内搜索也作用在转换后的文本上**。
- book.metadata（书名、作者）、book.toc 的 label 用 `convertText` 转换后再显示。
- horizontal 开且书是竖排时：把 `book.dir` 设为 `ltr`，同时清掉渲染器的 vertical 设置，确保翻页方向从左往右。
- 繁/简切换：记下当前 CFI，换选项，重新打开 book，再跳回 CFI。CFI 在两种模式下不一致时，用 fraction 兜底。
- pdfReflow 检测：第一次打开时，取前 5 个章节的原始 xhtml 调用 `detectPdfReflow`，结果缓存到 BookRecord。
- txt：`decodeText` → `splitChapters` → 拼成一本内存里的 epub（用 fflate 打包，最简 OPF、nav 和每章一个 xhtml），再按 epub 流程打开。导入时就生成，存为 `<id>.epub`，format 记为 txt。

### 3.6 标注定位
- 高亮在哪种显示模式下创建，就用那种模式下的 CFI。显示时先用 CFI 定位，再核对文本是否等于 `text`。对不上（换了模式或引擎版本变了），就在该章节里用 prefix、text、suffix 做模糊查找，重新定位；跨模式时，先用 convertText 转换查找串。找不到的标注，放进“要点精选”列表的“无法定位”分组，不丢数据。

### 3.7 外观
- 主题和字体通过 `view.renderer.setStyles(css)` 注入。CSS 由 `app/src/reader/styles.ts` 根据 Settings 生成。
- 字号步进、行距、页边距的数值表见 DESIGN.md。

## 4. 质量门槛
- `pnpm -r typecheck` 和 `pnpm -r test` 全部通过才算完成一项改动。
- 前端用 Playwright 对 web 版做冒烟测试：导入合成的小书，打开，翻页，切换繁简，加高亮，刷新后还在。如果 Playwright 下载浏览器失败，改用 Edge 的 channel（`channel: 'msedge'`）。

## 5. 变更记录
- 初版。
- 引擎 R2 增加了几条保守条件：A 的末行少于 12 字不并；整行是链接的不并；B 用全角空格缩进或以“一、”开头的不并。
- 执行顺序：R2 → R0/R1 → 繁简转换。原因是 R2 要看原始空格，先去掉空格 OpenCC 才能认出被切开的词。
- 新增词汇例外 `VOCABULARY_EXCEPTIONS`：行程、程序、文件、核心、執行、資料（資料庫、資料夾除外）、社群、物件（物件導向除外）。这些词只转字形。
- 引擎只能处理原始章节，不能二次处理已经转换过的文本。简体书不要调用繁转简。
- foliate 只对 epub 的正文触发 transformTarget；mobi、azw3、fb2 在 view 的 load 事件里转换。搜索时包一层 createDocument。详见 docs/notes/foliate-hooks.md。
- 阅读字体改为“随意调整”：用户可选系统已安装的任意字体，也可导入字体文件，注入阅读 iframe 的 @font-face。web 版用 queryLocalFonts 兜底。
- 桌面外壳定为 Electron：原样使用官方二进制（只改文件名，不改内容，打包脚本校验哈希），代码放进 app.asar，不使用任何原生模块；交付形式是 zip 加首次运行自注册。平台层新增 electron 实现；系统字体枚举由主进程用纯 JS 解析字体文件实现。Tauri 外壳保留在 app/src-tauri，不作为交付。
- Settings.appearance：`font` 由字符串改为 `{ id, family }`（推荐字体 id 为 songti 等，系统字体 `sys:<英文名>`，导入的 `imp:<英文名>`）；`fontStep`（档位下标）改为 `fontSize`（px，12–48）；新增 `fontWest`（西文字体，null = 跟随中文字体）。旧存档在 `mergeSettings` 里迁移。
- Platform 新增 `listFonts / importFonts / removeFont / fontFaceCss`；`onDataChanged` 的 kind 增加 `fonts`，web 用 BroadcastChannel 实现。web 的 IndexedDB 升到 v2，新增 `fonts` 仓库。
- 字体文件解析用自写的纯 JS 解析器 `app/src/fonts/sfnt.ts`（只读 name、cmap、OS/2，支持 TTF/OTF/TTC/WOFF/WOFF2），没有新增依赖；Electron 主进程扫描、导入，web 导入共用它。TTC 导入时拆成单个字体（浏览器的 @font-face 不认 TTC）。
