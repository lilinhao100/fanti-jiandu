// 放在 zip 根目录、和 .app 并列的“首次打开说明.txt”。因为这个 App 没有 Apple 签名，第一次打开要多做两步。
const MAC_NAMES: Record<string, string> = { '13': 'Ventura', '14': 'Sonoma', '15': 'Sequoia', '26': 'Tahoe' };

/** 最低系统版本取自官方 Electron 的 Info.plist（LSMinimumSystemVersion），不手写 */
export function minOsText(lsMinimumSystemVersion: string): string {
  const major = lsMinimumSystemVersion.split('.')[0]!;
  const name = MAC_NAMES[major];
  return `macOS ${lsMinimumSystemVersion.replace(/\.0$/, '')}${name ? `（${name}）` : ''} 或更新`;
}

export function firstOpenText(o: { version: string; minOs: string }): string {
  return `繁体简读 ${o.version} · macOS 版 · 首次打开说明
==========================================

这个 App 没有 Apple 开发者签名（我们没有加入付费的 Apple 开发者计划），所以第一次打开需要多做两步。
下面的操作都在你自己的 Mac 上完成，不需要联网，也不会改动系统设置。


一、先确认下载对了版本

  · Apple 芯片（M 系列）：下载文件名里带 mac-arm64 的版本。
  · Intel 芯片：下载文件名里带 mac-x64 的版本。

  不确定的话：点屏幕左上角的苹果菜单 → “关于本机”，看“芯片”一栏。
  写着 Apple M…… 的是 Apple 芯片，写着 Intel 的是 Intel 芯片。

  系统要求：${o.minOs}。


二、安装

  1. 双击下载的 zip 文件解压，得到“繁体简读”。
  2. 把“繁体简读”拖进“应用程序”文件夹。


三、去掉“来自网络”的标记，并在本机做一个免费的临时签名

  打开“终端”（启动台 → 其他 → 终端），把下面两行粘贴进去，每粘贴一行按一次回车：

      xattr -cr /Applications/繁体简读.app
      codesign --force --deep --sign - /Applications/繁体简读.app

  · 第一行：去掉下载时系统加在文件上的“隔离”标记。
  · 第二行：在你自己的 Mac 上做一个免费的临时签名。Apple 芯片的 Mac 要求每个程序都带签名，
    没有的话，系统会提示“已损坏”或者直接打不开。
  · 两行执行后都没有任何输出，就是成功了。


四、打开

  双击“应用程序”里的“繁体简读”。

  如果仍然被拦住（提示“无法验证开发者”或“已阻止”）：
  打开“系统设置 → 隐私与安全性”，拉到页面下方，点“仍要打开”，再确认一次。


补充

  · 每次更新到新版本，请重新做第二、第三步（新文件没有签名）。
  · 书、封面、笔记、设置都保存在 ~/Library/Application Support/繁体简读/ ，删除 App 不会删掉它们。
  · 想用它打开 epub、mobi、azw3、fb2：在 Finder 里右键点书 → “打开方式” → “繁体简读”。
`;
}
