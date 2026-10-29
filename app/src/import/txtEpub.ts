// txt → 内存里的 epub（ARCHITECTURE 3.5）：最简 OPF、nav 和每章一个 xhtml，用 fflate 打包。
import { strToU8, zipSync, type Zippable } from 'fflate';

export interface TxtChapter {
  title: string;
  paragraphs: string[];
}

export interface TxtEpubInput {
  /** 书的唯一标识（用文件 sha256 前缀） */
  id: string;
  title: string;
  author?: string;
  /** BCP 47，例如 zh-TW、zh-CN、zh */
  language: string;
  chapters: TxtChapter[];
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
export const escapeXml = (s: string): string =>
  // XML 1.0 不允许的控制字符直接丢掉，否则整本书会因为一个 \u0000 解析失败
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c]!);

const CSS = `body { line-height: 1.8; }
h2 { font-size: 1.3em; text-align: center; margin: 2em 0 1.5em; }
p { margin: 0; text-indent: 2em; text-align: justify; }
`;

function chapterXhtml(title: string, paragraphs: string[], language: string): string {
  const body = paragraphs.map((p) => `<p>${escapeXml(p)}</p>`).join('\n');
  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="${language}" lang="${language}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2>${escapeXml(title)}</h2>
${body}
</body>
</html>
`;
}

export function buildTxtEpub(input: TxtEpubInput): Uint8Array {
  const { id, title, author, language } = input;
  const chapters = input.chapters.length > 0 ? input.chapters : [{ title, paragraphs: [''] }];
  const names = chapters.map((_, i) => `ch${String(i + 1).padStart(4, '0')}.xhtml`);
  const chapterTitle = (c: TxtChapter, i: number): string => (c.title.trim() ? c.title : `第${i + 1}部分`);

  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="style.css" media-type="text/css"/>',
    ...names.map((n, i) => `<item id="c${i + 1}" href="${n}" media-type="application/xhtml+xml"/>`),
  ].join('\n    ');
  const spine = names.map((_, i) => `<itemref idref="c${i + 1}"/>`).join('\n    ');

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:fjd:${id}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>${escapeXml(language)}</dc:language>${author ? `\n    <dc:creator>${escapeXml(author)}</dc:creator>` : ''}
  </metadata>
  <manifest>
    ${manifest}
  </manifest>
  <spine>
    ${spine}
  </spine>
</package>
`;

  const navItems = chapters
    .map((c, i) => `<li><a href="${names[i]}">${escapeXml(chapterTitle(c, i))}</a></li>`)
    .join('\n      ');
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${language}">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <ol>
      ${navItems}
    </ol>
  </nav>
</body>
</html>
`;

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

  // mimetype 必须是第一个条目且不压缩（EPUB OCF 规范）
  const files: Zippable = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(container),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/style.css': strToU8(CSS),
  };
  chapters.forEach((c, i) => {
    files[`OEBPS/${names[i]}`] = strToU8(chapterXhtml(chapterTitle(c, i), c.paragraphs, language));
  });
  return zipSync(files);
}
