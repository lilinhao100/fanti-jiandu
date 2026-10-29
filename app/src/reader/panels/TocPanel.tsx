import { useLayoutEffect, useRef } from 'react';
import type { TocEntry } from '../../store/reader';
import { Popover } from '../../ui/Popover';

function TocList({ items, currentHref, onPick, depth = 0 }: { items: TocEntry[]; currentHref?: string; onPick(href: string): void; depth?: number }) {
  return (
    <>
      {items.map((it, i) => (
        <div key={`${it.href}-${i}`}>
          <button
            className={`toc-item${it.href === currentHref ? ' current' : ''}`}
            aria-current={it.href === currentHref ? 'location' : undefined}
            style={{ paddingLeft: 24 + depth * 16 }}
            onClick={() => onPick(it.href)}
          >
            {it.label}
          </button>
          {it.subitems && <TocList items={it.subitems} currentHref={currentHref} onPick={onPick} depth={depth + 1} />}
        </div>
      ))}
    </>
  );
}

/** 目录：多级缩进，每级 16px，当前章节加粗并在左侧显示一个蓝点（DESIGN 2.9） */
export function TocPanel({ anchor, toc, currentHref, onPick }: { anchor: HTMLElement | null; toc: TocEntry[]; currentHref?: string; onPick(href: string): void }) {
  const body = useRef<HTMLDivElement>(null);
  // 打开时把当前章节滚到可见处
  useLayoutEffect(() => {
    const el = body.current?.querySelector<HTMLElement>('.toc-item.current');
    el?.scrollIntoView({ block: 'center' });
  }, []);
  return (
    <Popover anchor={anchor} width={340} align="start" label="目录" testId="toc-panel">
      <div className="popover-body" ref={body}>
        {toc.length === 0 ? <div className="panel-empty">这本书没有目录</div> : <TocList items={toc} currentHref={currentHref} onPick={onPick} />}
      </div>
    </Popover>
  );
}
