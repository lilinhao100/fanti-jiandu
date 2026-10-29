// 改写 Electron.app/Contents/Info.plist：用纯 JS 的 plist 库解析，改字段，再写回。
// 红线：CFBundleExecutable 保持 "Electron"（Mach-O 可执行文件不改名、不改字节）。
import { build as plistBuild, parse as plistParse } from 'plist';

export const APP_NAME = '繁体简读';
export const BUNDLE_ID = 'com.fantijiandu.reader';
export const ICON_FILE = 'icon.icns';

type Dict = Record<string, unknown>;

/** 能打开的书。epub 有系统声明的 UTI；其余没有，用扩展名。角色 Viewer（只读），优先级 Alternate：出现在“打开方式”里，不抢走用户已有的默认程序 */
export const DOCUMENT_TYPES: Dict[] = [
  { CFBundleTypeName: 'EPUB 电子书', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', LSItemContentTypes: ['org.idpf.epub-container'], CFBundleTypeExtensions: ['epub'] },
  { CFBundleTypeName: 'MOBI 电子书', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', CFBundleTypeExtensions: ['mobi', 'prc'] },
  { CFBundleTypeName: 'AZW3 电子书', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', CFBundleTypeExtensions: ['azw3', 'azw'] },
  { CFBundleTypeName: 'FB2 电子书', CFBundleTypeRole: 'Viewer', LSHandlerRank: 'Alternate', CFBundleTypeExtensions: ['fb2'] },
];

export function parseInfoPlist(xml: string): Dict {
  const v = plistParse(xml);
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('Info.plist 不是字典');
  return v as Dict;
}

/** 在官方 Info.plist 的基础上改出我们的。返回新的字典（不改入参） */
export function transformInfo(official: Dict, opts: { version: string }): Dict {
  if (official.CFBundleExecutable !== 'Electron') throw new Error(`官方 Info.plist 的 CFBundleExecutable 不是 Electron：${String(official.CFBundleExecutable)}`);
  const info: Dict = { ...official };
  info.CFBundleName = APP_NAME;
  info.CFBundleDisplayName = APP_NAME;
  info.CFBundleIdentifier = BUNDLE_ID;
  info.CFBundleIconFile = ICON_FILE;
  info.CFBundleShortVersionString = opts.version;
  info.CFBundleVersion = opts.version;
  info.LSApplicationCategoryType = 'public.app-category.books';
  info.CFBundleDocumentTypes = DOCUMENT_TYPES.map((d) => ({ ...d }));
  // default_app.asar 已经删除，它的完整性记录不再有对应文件（官方 Electron 的 asar 完整性校验保险丝默认关闭，这个键本来就不生效）
  delete info.ElectronAsarIntegrity;
  return info;
}

export function buildInfoPlist(info: Dict): string {
  return plistBuild(info as never) + '\n';
}

/** 一步到位：官方 XML → 我们的 XML */
export function rewriteInfoPlist(xml: string, opts: { version: string }): string {
  return buildInfoPlist(transformInfo(parseInfoPlist(xml), opts));
}

/** 校验 Info.plist 能解析回来、关键字段正确；不对就抛错 */
export function checkInfoPlist(xml: string, opts: { version: string; officialExecutable?: string }): Dict {
  const info = parseInfoPlist(xml);
  const bad: string[] = [];
  const eq = (k: string, want: unknown): void => {
    if (JSON.stringify(info[k]) !== JSON.stringify(want)) bad.push(`${k} = ${JSON.stringify(info[k])}，应为 ${JSON.stringify(want)}`);
  };
  eq('CFBundleExecutable', opts.officialExecutable ?? 'Electron');
  eq('CFBundleName', APP_NAME);
  eq('CFBundleDisplayName', APP_NAME);
  eq('CFBundleIdentifier', BUNDLE_ID);
  eq('CFBundleIconFile', ICON_FILE);
  eq('CFBundleShortVersionString', opts.version);
  eq('CFBundleVersion', opts.version);
  eq('LSApplicationCategoryType', 'public.app-category.books');
  eq('CFBundlePackageType', 'APPL');
  const docs = info.CFBundleDocumentTypes;
  if (!Array.isArray(docs) || docs.length === 0) bad.push('缺少 CFBundleDocumentTypes');
  else {
    const exts = new Set<string>();
    for (const d of docs as Dict[]) {
      if (d.CFBundleTypeRole !== 'Viewer') bad.push(`文档类型 ${String(d.CFBundleTypeName)} 的角色不是 Viewer`);
      for (const e of (d.CFBundleTypeExtensions as string[] | undefined) ?? []) exts.add(e);
    }
    for (const e of ['epub', 'mobi', 'azw3', 'fb2']) if (!exts.has(e)) bad.push(`文档类型没有覆盖 .${e}`);
  }
  if ('ElectronAsarIntegrity' in info) bad.push('不应保留已删除的 default_app.asar 的 ElectronAsarIntegrity');
  if (bad.length > 0) throw new Error(`Info.plist 不合格：\n  ${bad.join('\n  ')}`);
  return info;
}
