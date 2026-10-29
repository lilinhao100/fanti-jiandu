import { DotsThree } from '@phosphor-icons/react';
import type { BookRecord } from '../model';
import { getPlatform } from '../platform';
import { useSettings } from '../store/settings';
import { MenuButton } from '../ui/Menu';
import { bookMenuEntries } from './bookMenu';
import { Cover } from './Cover';
import { displayAuthor, displayTitle, statusLabel } from './text';

export { GeneratedCover } from './Cover';

/** 封面网格里的一本书：封面（底部对齐）+ 一行标签（状态在左，“…”在右） */
export function BookCard({ book, onRemove }: { book: BookRecord; onRemove(): void }) {
  const conversion = useSettings((s) => s.settings.conversion);
  const title = displayTitle(book, conversion);
  const author = displayAuthor(book, conversion);
  const status = statusLabel(book);

  return (
    <div className="card" data-testid="book-card" data-book-id={book.id}>
      <button
        className="cover-wrap"
        onClick={() => void getPlatform().openReader(book.id)}
        aria-label={`打开《${title}》`}
        title={`${title}${author ? ` · ${author}` : ''}`}
      >
        <Cover book={book} title={title} author={author} />
      </button>
      <div className="card-label">
        {status.kind === 'new' ? <span className="pill-new">{status.text}</span> : <span className="status">{status.text}</span>}
        <MenuButton className="more-btn" label="更多" entries={bookMenuEntries(book, onRemove)}>
          <DotsThree size={24} weight="bold" />
        </MenuButton>
      </div>
    </div>
  );
}
