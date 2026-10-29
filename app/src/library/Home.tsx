import type { CSSProperties } from 'react';
import type { BookRecord } from '../model';
import { getPlatform } from '../platform';
import { useSettings } from '../store/settings';
import { BookCard } from './BookCard';
import { Cover, useCoverTint } from './Cover';
import { useGridColumns } from './grid';
import { cardSubtitle, continueReading, displayAuthor, displayTitle, recentlyAdded } from './text';

/** “继续阅读”卡片 300×120：左边封面，右边书名、作者和“图书 · 18%”；底色取封面平均色（DESIGN 第 1 节） */
function ContinueCard({ book }: { book: BookRecord }) {
  const conversion = useSettings((s) => s.settings.conversion);
  const title = displayTitle(book, conversion);
  const author = displayAuthor(book, conversion);
  const tint = useCoverTint(book.coverUrl, title);
  return (
    <button
      className="continue-card"
      data-testid="continue-card"
      data-book-id={book.id}
      style={tint ? ({ '--card-tint': tint } as CSSProperties) : undefined}
      onClick={() => void getPlatform().openReader(book.id)}
      aria-label={`继续阅读《${title}》`}
    >
      <span className="cc-cover">
        <Cover book={book} title={title} author={author} />
      </span>
      <span className="cc-text">
        <span className="cc-title">{title}</span>
        {author && <span className="cc-author">{author}</span>}
        <span className="cc-meta">{cardSubtitle(book)}</span>
      </span>
    </button>
  );
}

export function Home({ books, onRemove }: { books: BookRecord[]; onRemove(b: BookRecord): void }) {
  const cont = continueReading(books);
  const recent = recentlyAdded(books);
  const { ref, cols } = useGridColumns<HTMLDivElement>();
  return (
    <div className="home" data-testid="home">
      {cont.length > 0 && (
        <section>
          <h2 className="section-title">继续阅读</h2>
          <div className="continue-row" data-testid="continue-row">
            {cont.map((b) => (
              <ContinueCard key={b.id} book={b} />
            ))}
          </div>
        </section>
      )}
      <section>
        <h2 className="section-title">最近添加</h2>
        <div className="grid" ref={ref} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }} data-testid="recent-grid">
          {recent.map((b) => (
            <BookCard key={b.id} book={b} onRemove={() => onRemove(b)} />
          ))}
        </div>
      </section>
    </div>
  );
}
