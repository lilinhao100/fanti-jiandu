# foliate-js 钩子笔记

> 读的版本：`vendor/foliate-js`，commit `78914aef4466eb960965702401634c2cb348e9b1`（见 `vendor/README.md`）。
> 下面的行号都指这个 commit。升级 vendor 后必须重新核对。
> 标 **[已验证]** 的结论，是 e2e 或脚本在真浏览器里跑过的；其余是读源码得出的。

## 0. 四条加载路径一览

| 格式 | 书对象由谁造 | 章节对象 `book.sections[i]` | 有 `transformTarget`？ | 章节正文有 `data` 事件？ |
|---|---|---|---|---|
| epub（含我们拼的 txt-epub） | `epub.js` 的 `EPUB` 类 | `{ id: href, load, unload, createDocument, size, cfi, linear, ... }` | 有（epub.js:978，就是 Loader 的 EventTarget） | **有**（正文、css、图片、字体都经过 `createURL`） |
| mobi（旧版 MOBI6） | `mobi.js` 的 `MOBI6` 类 | `{ id: 序号, load, createDocument, size }` | **没有** | **没有** |
| azw3 / 新版 mobi（KF8） | `mobi.js` 的 `KF8` 类 | `{ id, load, createDocument, size, pageSpread }`；空骨架是 `{ linear: 'no' }` | 有（mobi.js:944） | 只有 **css/svg 等资源**（flow、embed）；**正文没有** |
| fb2（以及 fb2.zip） | `fb2.js` 的 `makeFB2()` 返回普通对象 | `{ id, load: () => url, createDocument, size, linear }` | **没有** | **没有** |

分流入口是 `view.js` 的 `makeBook(file)`（view.js:79-123）：
- zip 魔数 → `.cbz` / `.fb2.zip|.fbz` / 否则 epub；
- `%PDF-` → pdf.js；
- 其余：`isMOBI`（偏移 60..68 为 `BOOKMOBI`，mobi.js:481）→ `new MOBI({unzlib}).open(file)`，它内部按 `mobi.version >= 8`（或“组合文件”里的 KF8 部分）选 `KF8`，否则 `MOBI6`（mobi.js:522-542）；
- 文件名以 `.fb2` 结尾（或 MIME 为 `application/x-fictionbook+xml`）→ `makeFB2`。**判断靠 `file.name`，所以交给 makeBook 的 File 必须带正确的扩展名**。
- `view.open(book)` 若收到的是 File，会自己调 makeBook（view.js:234-236）；我们要在 open 之前改 book 对象，所以自己先 `makeBook(file)`。

## 1. 三种格式各自怎样加载章节

### epub（epub.js）
- `EPUB.init()`（951）读 `META-INF/container.xml` → OPF → 建 `Resources`（manifest、spine、封面、`page-progression-direction`）→ 建 `Loader` → 建 `sections`（979-999）。
- `section.load()` 即 `Loader.loadItem(item)`（763）。xhtml/html/css/svg/js 走 `loadReplaced`（793）：用 `DOMParser` 解析原文，把里面所有 `src`、`href`（非锚点）、`url()` 递归换成 blob URL，再 `XMLSerializer` 序列化，最后 `createURL`（719）生成 blob URL。图片等二进制走 `loadBlob` 再 `createURL`。
- xhtml 解析失败（不是合法 XHTML）时，会把 `item.mediaType` 就地改成 `text/html` 再解析（817-822）。
- `section.unload()` 只做引用计数减一（747-761）。
- `section.createDocument()` 即 `EPUB.loadDocument(item)`（1038）：`loadText` 读**原始文本**，`DOMParser` 解析，**不经过** `Loader`、**不触发** `data` 事件。**书内搜索用的就是它**（见第 3 节）。

### mobi（旧版，MOBI6）（mobi.js:670-895）
- `init()` 一次性解压全部文本记录，拼成一个大字符串，按 `<mbp:pagebreak>` 切章（701-720）。
- `createDocument(section)`：`loadText`（824）把字节 `decode` 成字符串（先在每个 `filepos` 处插 `<a id="fileposN">`），`DOMParser` 按 `text/html` 解析（845）。
- `load()` 即 `loadSection`（849）：`createDocument` → 往 head 里塞默认样式 → `replaceResources`（img recindex 换成 blob URL）→ `XMLSerializer` → blob URL（`type: text/html`），缓存在 `#cache`。
- 没有 `unload`；`book.destroy()` 才统一回收 URL。**没有任何钩子**。

### azw3 / KF8（mobi.js:941-1238）
- `init()` 读 FDST/skel/frag 表，建章节。`loadText(section)`（1147）按 skel + frag 拼出原始 xhtml 字节再 decode。
- `createDocument` 即 `loadText` + `DOMParser`（`application/xhtml+xml`，1168）。
- `load()` 即 `loadSection`（1172）：`loadText` → `replaceResources`（把 `kindle:flow:`、`kindle:embed:` 链接换成 blob URL）→ 解析（不是合法 XHTML 时退回 `text/html`）→ 序列化 → blob URL。**正文这条路径没有事件**。
- 只有资源走 `loadResourceBlob`（1085-1102）：派发 `data` 事件（1091-1094），detail 是 `{ data, type }`（**没有 `name`**），`type` 取自 `kindle:flow:XXXX?mime=text/css` 里的 mime。
- `this.dir = exth.pageProgressionDirection`（1047）。

### fb2（fb2.js:232-360）
- `makeFB2(blob)`：`parseXML`（157-170）读 XML 声明里的 encoding（`TextDecoder` 支持 gbk、big5 等；**但它的正则要求版本号和 encoding 都用双引号**，写成单引号的声明会被当成 UTF-8 解析）。
- 在**打开时**就把每个顶层 `<section>` 转成 xhtml 字符串，立刻 `URL.createObjectURL`（306-310）。`load: () => url` 同步返回现成 URL（315），`createDocument: () => new DOMParser().parseFromString(str, XHTML)`（316）。
- 没有 `transformTarget`，没有 `dir`。需要 `document.implementation`（73-77），只能在浏览器里跑。

## 2. `transformTarget` 的 `data` 事件

- 触发点（epub）：`Loader.createURL(href, data, type, parent)`（epub.js:719-735）：
  ```js
  const detail = { data, type }
  Object.defineProperty(detail, 'name', { value: href }) // 只读
  const event = new CustomEvent('data', { detail })
  this.eventTarget.dispatchEvent(event)
  const newData = await event.detail.data
  const newType = await event.detail.type
  const url = URL.createObjectURL(new Blob([newData], { type: newType }))
  ```
- detail 结构：`{ data, type, name }`。
  - `data` 可以是 `string`（xhtml/html/svg/css，已经做过 URL 替换），也可以是 `Promise<Blob>`（图片、字体、音视频；`loadBlob` 出错时是被 reject 的 Promise）。
  - `type` 是 manifest 里的 `media-type`（xhtml 解析失败时是被改成的 `text/html`）。
  - `name` 是资源在包内的路径（href），只读。
  - **处理方式**：同步地把 `detail.data` 换成新的 Promise（或值）。监听器可以有多个，要用 `detail.data = Promise.resolve(detail.data).then(...)` 链起来。paginator 自己也监听了 css（paginator.js:649-664，处理 `-epub-`、vw/vh、page-break），我们的监听必须按同样的链式写法，不能直接覆盖。
- 另外 Loader 还派发一个 `load` 事件（epub.js:769-771），detail 是 `{ type, isScript, allow }`，可以把 `allow` 设成 false 来禁止加载（脚本）。暂不使用，但安全上值得把 `isScript` 的 `allow` 设为 false。
- 哪种格式会触发：
  - epub：**全部资源**，包括每一章的 xhtml。
  - KF8：只有 `kindle:flow/embed` 资源（css、svg、图片、字体），正文**不会**。
  - MOBI6、FB2：**不存在**这个对象。
- 已知上游 bug：KF8 `loadResourceBlob` 里写成 `new Blob([newData], { newType })`（mobi.js:1097），`type` 丢了，生成的 blob 没有 MIME。样式表在 iframe 里通常仍可用，但要留意。

## 3. 书内搜索读的是哪份文本

- `view.search()`（view.js:542）调用 `#searchBook`/`#searchSection`（525-541），对每章调 `book.sections[i].createDocument()` 得到 Document，再用 `search.js` 的 `searchMatcher` 配合 `text-walker.js` 在文本节点上匹配。
- 所以搜索读的是 **`createDocument()` 返回的文档**，对 epub 来说是**原始文本**（未经 Loader、未触发 `data` 事件）。**只挂 `data` 事件的话，搜索看到的永远是繁体原文，而且搜出的 CFI 和页面上渲染的 DOM 结构也可能对不上（排版清理会合并段落）**。
- 结论：必须包装每个 `section.createDocument`，对返回的 Document 原地调用 `transformDocument(doc, opts, ctx)`。5 种格式一视同仁。这样搜索文本等于显示文本，搜索结果的 CFI 与页面 DOM 结构一致（前提是引擎对同一份输入的结构改动是确定性的，ARCHITECTURE 2.1 已要求）。
- 搜索关键词本身：用户输入简体或繁体，都要先 `convertText` 成当前显示的字形再交给 `view.search({ query })`。`search.js` 默认 `sensitivity: 'base'` 走 `Intl.Collator`，不会把繁体当简体。

## 4. 竖排和 `book.dir` 怎样影响分页器

- **`book.dir`**（'ltr' | 'rtl' | undefined）：
  - epub 来自 spine 的 `page-progression-direction`（epub.js:653、1025）；KF8 来自 EXTH（mobi.js:1047）；MOBI6、FB2 没有。
  - `paginator.open(book)` 把它存为 `bookDir`（paginator.js:647），**只用于页眉页脚的 `direction`**（741）。
  - `view.goLeft()/goRight()` 用它决定“左键是上一页还是下一页”（view.js:519-524）。
  - 所以“竖排转横排”时必须在 `view.open` **之前**把 `book.dir = 'ltr'`。
- **竖排、从右到左的真正判定不看 `book.dir`，看渲染后的 CSS**：`View.load()` 里 iframe 的 load 事件触发后，先 `afterLoad`（里面会 `setStyles`，见下），**然后**才调 `getDirection(doc)`（paginator.js:178-187、257-263）：
  - `vertical` = `getComputedStyle(doc.body).writingMode` 是 `vertical-rl` 或 `vertical-lr`；
  - `rtl` = `doc.body.dir==='rtl'` 或 computed `direction==='rtl'` 或 `documentElement.dir==='rtl'`。
  - 这两个值决定：列的方向（`columnize` 用 height 还是 width）、`scrollProp`（scrollLeft/scrollTop）、页码到偏移的换算（`#rtl` 时取负）、`flow=scrolled` 时的方向。
- 因此让书横排要同时做到：
  1. CSS 里的 `writing-mode: vertical-*`（含 `-epub-`、`-webkit-` 前缀）全部改成 `horizontal-tb`：样式表走 `transformCss`（epub 的 `data` 事件里 `type==='text/css'`），行内 `<style>`、`style=""` 属性由 `transformMarkup/transformDocument` 处理（引擎负责）；
  2. 保险起见，再在 `setStyles` 里注入 `html, body { writing-mode: horizontal-tb !important }`。因为 `setStyles` 发生在 `getDirection` 之前，这条规则对 `body` 的 computed style 一定生效；
  3. 清掉 rtl：把 `html`/`body` 的 `dir` 属性改成 `ltr`（它读的是属性，不是 computed），并在 `setStyles` 里加 `direction: ltr !important`；
  4. `book.dir = 'ltr'`。
- 注意：`#vertical`/`#rtl` 是**每次加载一章时**重新检测的，所以每章都要满足上面几点。

## 5. 怎样注入样式（`renderer.setStyles`）

- `view.renderer` 是 `<foliate-paginator>`（固定版式书是 `<foliate-fxl>`，暂不处理）。
- `renderer.setStyles(css)`（paginator.js:1100-1117）：
  - 参数可以是字符串，或 `[beforeStyle, style]` 数组。每章的 head 里 `afterLoad` 会预先放两个 `<style>`：一个 prepend 到 head 最前（书的样式之前，优先级最低），一个 append 到 head 最后（paginator.js:977-986）。字符串形式只写后者。
  - 样式保存在 `this.#styles`，**每次换章时由 `onLoad` 自动重新应用**（1008-1011）。所以只需调用一次，之后翻到新章节会自动带上。
  - 换了样式后会 `fonts.ready.then(expand)`，自动重新分页；**不会自动保持位置**——位置由 `#anchor`（上次可见的 Range）维持，`onExpand` 调 `#scrollToAnchor(#anchor)`（673），基本能留在原处。
- 我们的主题 CSS 是 `app/src/reader/styles.ts` 生成的，用 `!important` 压过书里的样式。
- paginator 自己会改 `documentElement` 的内联样式（columnize 的 `setStylesImportant`，309-340）：`column-width`、`height`、`padding`、`overflow` 等被 `!important` 占用，**主题 CSS 不要碰这些属性**。
- 页边距、最大宽度、页间距不走 `setStyles`，是 `<foliate-paginator>` 的**属性**：`gap`（百分比）、`margin`（px，页眉页脚高度）、`max-inline-size`、`max-block-size`、`max-column-count`、`flow`（`paginated|scrolled`）、`animated`（翻页动画开关）（paginator.js:425-427、628-645）。

## 6. location、CFI、fraction 怎么取

全部来自 `view` 的 `relocate` 事件（view.js:329-338，`detail` 即 `view.lastLocation`）：

```js
view.addEventListener('relocate', e => {
  const { cfi, fraction, location, section, tocItem, range } = e.detail
  // cfi:       string，当前页可见范围起点的 CFI（view.getCFI(index, range)）
  // fraction:  0..1，全书进度（按各章 size 加权，SectionProgress，progress.js:58-112）
  // location:  { current, next, total }  把全书按 1500 字节切成“位置”，页脚的 161 / 418 就用它
  // section:   { current: 章序号, total: 章数 }
  // tocItem:   当前所在的目录项（或 null）
  // range:     DOM Range（在 iframe 文档里）
})
```
- 渲染器事件里的 `reason` 是 `'page' | 'scroll' | 'snap' | 'navigation' | 'anchor' | 'selection'`，view 只在 `page/scroll/snap` 时更新 history。
- 恢复位置：`view.init({ lastLocation, showTextStart })`（view.js:314-325）。`lastLocation` 可以是 CFI 字符串，也可以是 `{ fraction }`；`resolveNavigation`（446-459）依次尝试：数字 → 章序号；有 `fraction` → `SectionProgress.getSection`；`CFI.isCFI` → `resolveCFI`；否则当 href。**`init` 要在 `view.open(book)` 之后调用**；两个参数都不给时调用 `this.next()`。
- 注意：`#sectionProgress` 只在 `book.splitTOCHref && book.getTOCFragment` 都存在时才建立（view.js:240-251）。epub、mobi、fb2 都有。**没有它，`fraction`、`location` 都是空的**，`goToFraction` 会报错。
- 跳转：`view.goTo(hrefOrCfiOrIndex)` 会 pushState 进 `view.history`；`view.history.back()` 可用于“返回”按钮；`renderer.goTo` 则不记录历史。
- 页数：`renderer.page`、`renderer.pages`（paginator.js:787-792）。**`pages` 含首尾各一页空白缓冲**，所以 `fraction = (page-1)/(pages-2)`（963-967），可见页数 = `pages - 2`。页脚的“本章还剩 N 页”= `pages - 2 - page`（page 是 1 起算的可见页序号，对应 `renderer.page`）。这两个 getter 只在 `flow=paginated` 有意义。
- 目录进度：`view.lastLocation.tocItem`。目录项会被 `TOCProgress.init` 里的 `assignIDs` 加上 `id`（progress.js:1-10）——**会修改 `book.toc` 里的对象**，所以展示用的目录要另拷贝一份再转换。

## 7. 怎样拿到封面

- `book.getCover()`，各格式都有，返回 `Blob | null | undefined`，或 Promise：
  - epub：`resources.cover`（`cover-image` 属性 → EPUB2 的 `<meta name="cover">` → guide 里 `type=cover`，epub.js:669-675），`getCover()` 在 1066-1071。
  - mobi/azw3：EXTH 里的 `coverOffset` 或 `thumbnailOffset`（mobi.js:633-641，绑定在 779、1056）。
  - fb2：`<coverpage><image>`，`fetch(dataURL).then(r => r.blob())`（fb2.js:272-275）。
- 封面 blob 没有可靠的 `type`（mobi 里是 `new Blob([buf])`，`type` 为空）。存 IndexedDB、`URL.createObjectURL` 当 `<img src>` 都可以。
- 没有封面时返回 `null`、`undefined` 都有可能，别假定是 null。

## 8. 元数据形状（显示书名、作者时要转换）

- epub：`metadata.title` 是 **language map**（`string` 或 `{ [lang]: string }`，epub.js:263 的 `makeLanguageMap`），`metadata.author` 是数组，元素是字符串或 `{ name: string | map, sortAs, role }`；`metadata.language` 是字符串数组。
- mobi/azw3：`title` 字符串，`author` 是字符串数组（EXTH creator），`language` 字符串。
- fb2：`title` 字符串，`author` 是 `{ name, sortAs }` 数组，`language` 字符串。
- foliate 自己的 reader.js 用 `formatLanguageMap`/`formatContributor` 取显示值（reader.js:51-63）。我们在 `app/src/reader/meta.ts` 里写了等价的 `pickTitle`/`pickAuthors`。
- 目录：`book.toc` 是树，`{ label, href, subitems }`；mobi 旧版的 label 来自 `a.innerText`，可能为空串。

## 9. 我们的接线方案

1. `makeBook(file)` 得到 book（**file.name 要带正确扩展名**）。
2. **book 级**：横排开时 `book.dir = 'ltr'`。读取前 5 章原始 xhtml 做 `detectPdfReflow`（epub 用 `book.loadText(section.id)`；其它格式把 `createDocument()` 序列化），结果缓存进 BookRecord。**必须在包装 `createDocument` 之前读取**。
3. **章节级（5 种格式统一）**：包装 `section.createDocument`：先拿原始 Document，再 `transformDocument(doc, opts, ctx)`。
4. **渲染级**：
   - epub（含 txt）：`book.transformTarget.addEventListener('data', ...)`：`type` 为 `application/xhtml+xml`/`text/html` 时 `transformMarkup`，`text/css` 时 `transformCss`。
   - KF8：同样挂 `data`，但只会收到 css 等资源；
   - MOBI6、KF8、FB2 的正文：监听 `view` 的 `load` 事件，对 `e.detail.doc` 调 `transformDocument`。这个事件在 `afterLoad` 里同步派发（paginator.js:985、1011），**早于** `getDirection` 和首次布局（257-272），iframe 此时还是 `display:none`，不会闪烁，分页器看到的已经是转换后的文本。
   - epub 的正文已经在 `data` 事件里转换过，`load` 事件里不能重复转换（按格式开关）。
5. **样式**：`renderer.setStyles([before, after])`，主题 CSS 放第二个；横排保险规则也放进去。
6. **繁/简切换**：记下 `lastLocation.cfi` 和 `fraction`，`view.close()`、销毁旧 book，重新 `makeBook`、`view.open`，再 `view.init({ lastLocation })`。CFI 在两种模式下结构不同（R2 合并段落会改变结构）时用 `{ fraction }` 兜底。
7. **书内搜索**：直接用 `view.search({ query: convertText(query, opts) })`，因为第 3 步已经包装了 `createDocument`。

## 10. 其它值得记住的点

- `view.close()` 不会调用 `book.destroy()`（epub 的 blob URL 不会回收）。关闭阅读器时我们要自己 `book.destroy?.()`。
- `<foliate-view>` 的 shadow root 是 closed，只能通过 `view.renderer`、`renderer.getContents()` 触达 iframe 里的 `doc`。
- iframe 带 `sandbox="allow-same-origin allow-scripts"`（paginator.js:244），所以主页面可以直接访问 `contentDocument`，但书里的脚本也会执行。
- 键盘、鼠标事件在 iframe 里不会冒泡到宿主页，要在 `load` 事件里给 `doc` 单独绑定（reader.js:194-196 就是这样做的）。方向键翻页、点击左右区域翻页、滚轮翻页、Ctrl+J 全部要在 `doc` 上也绑一份。
- `renderer.next()` / `prev()` 在翻页动画期间 `#locked`，连续调用会被丢弃（paginator.js:1060-1071）。

## 11. 怎样区分 epub 与其它格式（踩过的坑）

- **不能用 `book.loadText` 或 `book.transformTarget` 判断**：
  - `loadText` 在 EPUB、MOBI6、KF8 三个类上都有，但参数不同：epub 是**包内路径字符串**，mobi/KF8 是**章节对象**（mobi.js:824、1147）。把 `section.id`（数字）传给 mobi 的 `loadText` 会得到垃圾，不报错。
  - `transformTarget` 在 EPUB 和 KF8 上都有，但 KF8 的**正文**没有 `data` 事件（只有资源有）。
- 只有 `EPUB.init()` 会设置 `book.resources`（epub.js:968）。`app/src/reader/transforms.ts` 的 `kindOf` 用它：有 `resources.manifest` 是 `epub`，否则是 `doc`。
- 读章节原文：epub 用 `book.loadText(section.id)`；其它格式把 `section.createDocument()` 序列化。

## 12. 运行验证记录（e2e，Edge 内核，vite dev 与生产构建都跑过）

- **[已验证]** epub 的 `data` 事件里 xhtml 经 `transformMarkup`、css 经 `transformCss` 后，iframe 里渲染的是简体，繁体字形和「」都不再出现。
- **[已验证]** 包装 `section.createDocument` 后，`view.search()` 搜简体、搜繁体（查询词先 `convertText`）命中数相同，命中的是转换后的文本。
- **[已验证]** MOBI6、KF8（azw3）、fb2 的正文走 view 的 `load` 事件里调 `transformDocument`：渲染出的是简体、引号变成 “”，目录标签也是简体（`formats.spec.ts`，夹具由 `fixtures/books/build.mjs` 生成）。
- **[已验证]** 竖排转横排：夹具 `tw-vertical.epub`（样式表、`<style>`、`style=""` 里都有 `writing-mode: vertical-rl`，spine 是 `page-progression-direction="rtl"`）。开关打开时 body 的 computed `writing-mode` 是 `horizontal-tb`、`direction` 是 `ltr`、`book.dir` 是 `ltr`，→ 键与点击右侧都往后翻；把开关关掉后同一本书是 `vertical-rl` + `rtl`。
- **[已验证]** `setStyles` 的第二个样式在 `getDirection` 之前生效，所以 `html, body { writing-mode: horizontal-tb !important }` 对分页器可见。
- **[已验证]** `view.init({ lastLocation: cfi })` 能恢复到同一页（刷新后 CFI 逐字相同）；繁/简切换后用 CFI 恢复，偏差超过 1% 才退回 fraction。
- **上游竞态（未修，已规避）**：`<foliate-paginator>` 的 ResizeObserver 首次回调若恰好落在第一章 iframe 加载到一半时，会对还没有 `body` 的文档调 `columnize`，抛出 `Cannot destructure property 'style' of 'el' as it is null`。表现为 fb2 重开时偶发的 pageerror。规避办法：`view.open` 之后先等两个动画帧（后台页面最多等 120ms），再 `view.init`（`controller.ts` 的 `nextFrames`）。
- **页面里的告警**：iframe 的 `sandbox="allow-same-origin allow-scripts"` 会让浏览器在控制台报 “can escape its sandboxing”。这是 foliate 的设计（paginator.js:244），暂不处理；可以考虑用 Loader 的 `load` 事件禁掉书里的脚本。
- **pdf.js 白占体积**：`view.js` 的 `makePDF` 动态 import 会让生产构建多出约 400KB 的 pdf chunk，并有一条 Vite 的 glob 警告。v1 不支持 PDF，可以在构建里用别名把 `foliate-js/pdf.js` 指向空壳。
- **[已验证]** 搜索 CFI 与页面 DOM 一致：对 PDF 转制书里被 R2 合并过段落的章节，`view.goTo(搜索命中的 cfi)` 后，可见范围里确实包含命中的那句。前提正是“包装 createDocument，对同一份输入走同一套引擎规则”。
