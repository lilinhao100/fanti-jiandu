import { DotsThree } from '@phosphor-icons/react';
import type { BookRecord } from '../model';
import { getPlatform } from '../platform';
import { useSettings } from '../store/settings';
import { MenuButton } from '../ui/Menu';
import { bookMenuEntries } from './bookMenu';
import { Cover } from './Cover';
import { displayAuthor, displayTitle, formatDate, statusLabel } from './text';

/** 列表视图的一行（高 56px）：封面缩略图（高 44）、书名、作者、进度、添加日期（DESIGN 第 1 节） */
export function BookRow({ book, onRemove }: { book: BookRecord; onRemove(): void }) {
  const conversion = useSettings((s) => s.settings.conversion);
  const title = displayTitle(book, conversion);
  const author = displayAuthor(book, conversion);
  const status = statusLabel(book);

  return (
    <div className="row" data-testid="book-row" data-book-id={book.id}>
      <button className="row-main" onClick={() => void getPlatform().openReader(book.id)} aria-label={`打开《${title}》`}>
        <span className="thumb">
          <Cover book={book} title={title} author={author} />
        </span>
        <span className="r-title">{title}</span>
        <span className="r-author">{author}</span>
        <span className="r-status">{status.kind === 'new' ? <span className="pill-new">{status.text}</span> : status.text}</span>
        <span className="r-date">{formatDate(book.addedAt)}</span>
      </button>
      <MenuButton className="more-btn" label="更多" entries={bookMenuEntries(book, onRemove)}>
        <DotsThree size={24} weight="bold" />
      </MenuButton>
    </div>
  );
}
