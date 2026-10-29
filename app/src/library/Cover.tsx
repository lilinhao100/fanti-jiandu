import { useEffect, useState } from 'react';
import type { BookRecord } from '../model';
import { coverColor, coverIndex } from './text';
import { averageColor, cardTint, parseCssColor, rgbCss } from './tint';

/** 没有封面的书：由书名哈希选色的色块；书名用宋体粗体排在上三分之一，作者在底部（DESIGN 第 1 节） */
export function GeneratedCover({ title, author }: { title: string; author: string }) {
  return (
    <span className="cover generated" style={{ background: coverColor(title) }} data-testid="generated-cover">
      <span className="g-title">{title}</span>
      <span className="g-author">{author}</span>
    </span>
  );
}

export function Cover({ book, title, author }: { book: Pick<BookRecord, 'coverUrl'>; title: string; author: string }) {
  return book.coverUrl ? (
    <span className="cover" data-testid="cover-image">
      <img src={book.coverUrl} alt="" draggable={false} />
    </span>
  ) : (
    <GeneratedCover title={title} author={author} />
  );
}

const tintCache = new Map<string, string>();

/** 封面的平均色，压暗成卡片底色。图片还没解码出来之前是 undefined（CSS 里有兜底色） */
export function useCoverTint(coverUrl: string | undefined, title: string): string | undefined {
  const key = coverUrl ?? `generated:${coverIndex(title)}`;
  const [tint, setTint] = useState<string | undefined>(() => tintCache.get(key));
  useEffect(() => {
    const cached = tintCache.get(key);
    if (cached) {
      setTint(cached);
      return;
    }
    let alive = true;
    const done = (rgb: ReturnType<typeof averageColor>): void => {
      if (!rgb || !alive) return;
      const css = rgbCss(cardTint(rgb));
      tintCache.set(key, css);
      setTint(css);
    };
    if (coverUrl) {
      const img = new Image();
      img.onload = () => done(averageColor(img));
      img.src = coverUrl;
    } else {
      const css = getComputedStyle(document.documentElement).getPropertyValue(`--c-cover-${coverIndex(title)}`);
      done(parseCssColor(css.trim()));
    }
    return () => {
      alive = false;
    };
  }, [key, coverUrl, title]);
  return tint;
}
