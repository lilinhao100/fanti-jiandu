import { DotsThree, Notebook } from '@phosphor-icons/react';
import { useRef } from 'react';
import type { Highlight } from '../../model';
import { useReaderStore, type HighlightInfo } from '../../store/reader';
import { MenuButton } from '../../ui/Menu';
import type { ReaderController } from '../controller';

const fmtDate = (t: number): string => new Date(t).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' });

interface Row {
  h: Highlight;
  info?: HighlightInfo;
}

interface Group {
  key: string;
  title: string;
  rows: Row[];
}

/** 按章节分组（书里的顺序），每章里按位置排；定位不上的放最后的“无法定位”（ARCHITECTURE 3.6） */
export function groupHighlights(highlights: Highlight[], info: Record<string, HighlightInfo>): { groups: Group[]; lost: Row[] } {
  const rows: Row[] = highlights.map((h) => ({ h, info: info[h.id] }));
  // 还没算出位置的（刚打开的一瞬间）先当作找到了，免得“无法定位”闪一下
  const found = rows.filter((r) => !r.info || r.info.located);
  const lost = rows.filter((r) => r.info && !r.info.located).sort((a, b) => a.h.createdAt - b.h.createdAt);
  found.sort((a, b) => (a.info?.index ?? 1e9) - (b.info?.index ?? 1e9) || (a.info?.start ?? 0) - (b.info?.start ?? 0) || a.h.createdAt - b.h.createdAt);
  const groups: Group[] = [];
  for (const r of found) {
    const title = r.info?.chapter || '正文';
    const last = groups.at(-1);
    if (last && last.title === title) last.rows.push(r);
    else groups.push({ key: `${groups.length}-${title}`, title, rows: [r] });
  }
  return { groups, lost };
}

/**
 * 要点精选（Ctrl+Shift+N）：从左侧滑入的玻璃面板，宽 320。按章节分组，每条是颜色竖条、高亮原文（最多 3 行）、笔记、日期。
 * 点击跳转；悬停出现“…”菜单（编辑笔记、删除）。底部是“无法定位”分组。
 */
export function HighlightsPanel({ ctrl, onPick }: { ctrl: ReaderController | null; onPick(h: Highlight): void }) {
  const highlights = useReaderStore((s) => s.highlights);
  const info = useReaderStore((s) => s.hlInfo);
  const root = useRef<HTMLDivElement>(null);
  const { groups, lost } = groupHighlights(highlights, info);

  const item = (r: Row, lostItem: boolean) => {
    const { h } = r;
    const text = r.info?.text || h.text;
    return (
      <div key={h.id} className="hl-item" data-testid="hl-item" data-id={h.id} data-style={h.style} data-lost={lostItem || undefined}>
        <button
          className="hl-main"
          data-testid="hl-jump"
          onClick={() => onPick(h)}
        >
          <span className="hl-bar" style={{ background: `var(--c-hl-${h.style})` }} aria-hidden />
          <span className="hl-body">
            <span className="hl-text">{text}</span>
            {h.note && <span className="hl-note" data-testid="hl-note-text">{h.note}</span>}
            <span className="hl-date">{fmtDate(h.createdAt)}</span>
          </span>
        </button>
        <MenuButton
          className="hl-more"
          label="更多"
          testId="hl-more"
          entries={[
            {
              label: h.note ? '编辑笔记' : '添加笔记',
              onSelect: () => {
                const el = root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(h.id)}"]`);
                const ir = el?.getBoundingClientRect();
                const pr = root.current?.getBoundingClientRect();
                ctrl?.editNote(h.id, ir && pr ? { left: pr.right, top: ir.top, right: pr.right, bottom: ir.bottom } : undefined);
              },
            },
            { kind: 'sep' },
            { label: '删除', danger: true, onSelect: () => ctrl?.removeHighlight(h.id) },
          ]}
        >
          <DotsThree size={18} weight="bold" />
        </MenuButton>
      </div>
    );
  };

  return (
    <div ref={root} className="hl-panel glass" role="dialog" aria-label="要点精选" data-panel-root data-testid="highlights-panel">
      <h2 className="hl-title">要点精选</h2>
      <div className="hl-scroll">
        {highlights.length === 0 ? (
          <div className="panel-empty hl-empty">
            <Notebook size={40} className="hl-empty-icon" />
            <div>还没有高亮或笔记</div>
            <div className="panel-hint">选中文字，点一个颜色或写笔记</div>
          </div>
        ) : (
          <>
            {groups.map((g) => (
              <section key={g.key} className="hl-group" data-testid="hl-group">
                <div className="hl-group-title">{g.title}</div>
                {g.rows.map((r) => item(r, false))}
              </section>
            ))}
            {lost.length > 0 && (
              <section className="hl-group lost" data-testid="hl-lost">
                <div className="hl-group-title">无法定位</div>
                {lost.map((r) => item(r, true))}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
