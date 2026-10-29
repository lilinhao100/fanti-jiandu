// web 版的字体：系统字体走 queryLocalFonts（需要用户授权，被拒绝或浏览器不支持时就没有系统字体，只剩推荐字体和导入的字体）。
import type { FontInfo } from '../model';
import { blobSource, readFaces, type Decompressors } from '../fonts/sfnt';

/** queryLocalFonts 返回的 FontData（TypeScript 的 DOM 库里还没有） */
interface LocalFontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}

type QueryLocalFonts = () => Promise<LocalFontData[]>;

/** 浏览器里 WOFF 的 zlib 用 DecompressionStream 解；没有 brotli，WOFF2 的名字读不出来（导入时退回文件名） */
export const browserDecompressors: Decompressors = {
  inflate: async (data) => {
    const stream = new Blob([data.slice().buffer]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },
};

/** 授权状态：prompt 时必须在用户操作之后才能调用，否则浏览器直接拒绝 */
async function canQuery(): Promise<boolean> {
  try {
    const st = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
    if (st.state === 'granted') return true;
    if (st.state === 'denied') return false;
    return !!navigator.userActivation?.isActive;
  } catch {
    // 查询权限本身不支持：直接试一下，失败了再说
    return true;
  }
}

/** 读不出字体文件时，凭名字猜有没有中文：常见的中文字体家族名 */
const CJK_NAME = /yahei|jheng|simsun|nsimsun|simhei|simkai|simfang|kaiti|fangsong|dengxian|noto (sans|serif) (sc|tc|cjk)|source han|pingfang|heiti|songti|stsong|stkaiti|stheiti|yuanti|hiragino|wenquanyi|droid sans fallback|fz|方正|宋|黑|楷|仿/i;

let cache: { key: string; fonts: FontInfo[] } | null = null;

/**
 * 系统字体列表。同一个家族的各个字重合成一项；用 FontData.blob() 读出字体文件里的简体中文名和有没有“简”字
 * （只按需读 name、cmap 两张表），读不出来的凭家族名猜。
 */
export async function listLocalFonts(): Promise<FontInfo[]> {
  const query = (window as unknown as { queryLocalFonts?: QueryLocalFonts }).queryLocalFonts;
  if (typeof query !== 'function' || !(await canQuery())) return cache?.fonts ?? [];
  let data: LocalFontData[];
  try {
    data = await query.call(window);
  } catch {
    return cache?.fonts ?? [];
  }
  const key = data.map((d) => d.postscriptName).sort().join('|');
  if (cache?.key === key) return cache.fonts;

  const byFamily = new Map<string, LocalFontData>();
  for (const d of data) {
    const have = byFamily.get(d.family);
    // 每个家族挑常规字重来读名字
    if (!have || /^(regular|normal|book)$/i.test(d.style)) byFamily.set(d.family, d);
  }
  const families = [...byFamily.values()];
  const out: FontInfo[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      while (next < families.length) {
        const d = families[next++]!;
        // queryLocalFonts 给的 family 在中文系统上是本地化名（“宋体”）；以字体文件里的英文名为准，
        // 这样和 electron / tauri 的 id 一致，也能和推荐字体（SimSun）对上号去重
        let family = d.family;
        let displayName = d.family;
        let hasCJK = CJK_NAME.test(d.family);
        let hasLatin = true;
        try {
          // 字体集合（msyh.ttc 里有“微软雅黑”和“微软雅黑 UI”）：挑名字对得上的那一个
          const faces = await readFaces(blobSource(await d.blob()), browserDecompressors);
          const face = faces.find((f) => f.family === d.family || f.zhName === d.family) ?? faces[0];
          if (face) {
            family = face.family;
            displayName = face.zhName ?? face.family;
            hasCJK = face.hasCJK;
            hasLatin = face.hasLatin || face.hasCJK;
          }
        } catch {
          /* 读不出来就用猜的 */
        }
        if (hasLatin && !out.some((f) => f.family.toLowerCase() === family.toLowerCase())) {
          out.push({ id: `sys:${family}`, family, displayName, source: 'system', hasCJK });
        }
      }
    }),
  );
  out.sort((a, b) => a.family.localeCompare(b.family));
  cache = { key, fonts: out };
  return out;
}
