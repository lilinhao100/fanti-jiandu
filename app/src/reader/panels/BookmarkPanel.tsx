import { X } from '@phosphor-icons/react';
import { shortcutText } from '../../lib/shortcuts';
import type { Bookmark } from '../../model';
import { Popover } from '../../ui/Popover';

const fmtDate = (t: number): string => new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

/** 书签：每条显示章节名、片段和日期；悬停时显示删除按钮（DESIGN 2.9） */
export function BookmarkPanel({
  anchor,
  bookmarks,
  onPick,
  onRemove,
}: {
  anchor: HTMLElement | null;
  bookmarks: Bookmark[];
  onPick(b: Bookmark): void;
  onRemove(b: Bookmark): void;
}) {
  const sorted = [...bookmarks].sort((a, b) => b.createdAt - a.createdAt);
  return (
    <Popover anchor={anchor} width={340} align="start" label="书签" testId="bookmark-panel">
      <div className="popover-body">
        {sorted.length === 0 ? (
          <div className="panel-empty">
            <div>还没有书签</div>
            <div className="panel-hint">按 {shortcutText('bookmark')} 或点右上角的书签按钮，为当前页添加书签</div>
          </div>
        ) : (
          sorted.map((b) => (
            <div key={b.id} className="bm-item" data-testid="bookmark-item">
              <button className="bm-main" onClick={() => onPick(b)}>
                {b.chapter && <span className="bm-chapter">{b.chapter}</span>}
                <span className="bm-snippet">{b.label}</span>
                <span className="bm-date">{fmtDate(b.createdAt)}</span>
              </button>
              <button className="bm-remove" aria-label="删除书签" title="删除书签" onClick={() => onRemove(b)}>
                <X size={12} weight="bold" />
              </button>
            </div>
          ))
        )}
      </div>
    </Popover>
  );
}
