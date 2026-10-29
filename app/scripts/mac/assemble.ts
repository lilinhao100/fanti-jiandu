// 把我们的 app.asar 装进官方 Electron.app（只在 zip 流里搬运，不解压到磁盘）。
// 允许的改动只有：顶层目录改名（Electron.app → 繁体简读.app）、Info.plist、Resources 里的图标、新增 app.asar、删除 default_app.asar；
// 另在 zip 根目录放一份“首次打开说明.txt”。其他条目（包括所有 Mach-O）原样搬运，一个字节都不动。
import { rewriteInfoPlist } from './info-plist.ts';
import { ZipSource, ZipWriter, modeOf, type ZipEntryInfo } from './zip.ts';

export const OFFICIAL_APP = 'Electron.app';
export const NEW_APP = '繁体简读.app';
export const README_NAME = '首次打开说明.txt';

/** 官方包里的这些路径要被替换或删除（路径相对 zip 根，用官方的名字） */
export const PLAN = {
  replaced: [`${OFFICIAL_APP}/Contents/Info.plist`],
  removed: [`${OFFICIAL_APP}/Contents/Resources/default_app.asar`, `${OFFICIAL_APP}/Contents/Resources/electron.icns`],
  added: [`${NEW_APP}/Contents/Resources/app.asar`, `${NEW_APP}/Contents/Resources/icon.icns`, README_NAME],
} as const;

/** 官方名字 → 新名字（只改顶层目录名） */
export function mapName(name: string): string {
  if (name === `${OFFICIAL_APP}/` || name.startsWith(`${OFFICIAL_APP}/`)) return NEW_APP + name.slice(OFFICIAL_APP.length);
  return name;
}

export interface AssembleOptions {
  officialZip: string;
  outZip: string;
  appAsar: Buffer;
  icns: Buffer;
  version: string;
  readme: string;
}

export async function assembleMacZip(o: AssembleOptions): Promise<void> {
  const src = await ZipSource.open(o.officialZip);
  const out = new ZipWriter(o.outZip);
  try {
    const removed = new Set<string>(PLAN.removed);
    const replaced = new Set<string>(PLAN.replaced);
    const seen = { replaced: 0, removed: 0 };
    let plist: ZipEntryInfo | null = null;
    for (const e of src.entries) {
      if (removed.has(e.name)) {
        seen.removed++;
        continue;
      }
      if (replaced.has(e.name)) {
        plist = e;
        seen.replaced++;
        continue;
      }
      await out.copyRaw(src, e, mapName(e.name));
    }
    if (seen.removed !== removed.size || seen.replaced !== replaced.size || !plist) {
      throw new Error('官方 zip 的结构和预期不一致：找不到 Info.plist、default_app.asar 或 electron.icns');
    }
    const xml = (await src.readBuffer(plist)).toString('utf8');
    await out.addBuffer(mapName(plist.name), Buffer.from(rewriteInfoPlist(xml, { version: o.version }), 'utf8'), { mode: modeOf(plist) });
    await out.addBuffer(PLAN.added[0], o.appAsar, { mode: 0o100644 });
    await out.addBuffer(PLAN.added[1], o.icns, { mode: 0o100644, compress: false });
    await out.addBuffer(README_NAME, Buffer.from(o.readme, 'utf8'), { mode: 0o100644 });
    await out.finish();
  } finally {
    src.close();
  }
}
