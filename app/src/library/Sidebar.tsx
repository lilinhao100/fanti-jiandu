import { Books, GearSix, House } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

export type LibraryView = 'home' | 'all';

function Item({ icon, label, selected, onClick, testId }: { icon: ReactNode; label: string; selected?: boolean; onClick(): void; testId?: string }) {
  return (
    <button className={`item${selected ? ' selected' : ''}`} aria-current={selected ? 'page' : undefined} onClick={onClick} data-testid={testId}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** 浮动玻璃侧边栏：主页、书库·全部（不做联网书库，没有“搜索”）；底部固定“设置”（DESIGN 第 1 节） */
export function Sidebar({ view, onView, onSettings }: { view: LibraryView; onView(v: LibraryView): void; onSettings(): void }) {
  const w = (v: LibraryView): 'fill' | 'regular' => (view === v ? 'fill' : 'regular');
  return (
    <aside className="sidebar" aria-label="侧边栏" data-testid="sidebar">
      <div className="sidebar-top" data-tauri-drag-region />
      <nav className="sidebar-nav">
        <Item testId="nav-home" icon={<House size={18} weight={w('home')} />} label="主页" selected={view === 'home'} onClick={() => onView('home')} />
        <div className="group-name">书库</div>
        <Item testId="nav-all" icon={<Books size={18} weight={w('all')} />} label="全部" selected={view === 'all'} onClick={() => onView('all')} />
      </nav>
      <div className="sidebar-bottom">
        <Item testId="nav-settings" icon={<GearSix size={18} />} label="设置" onClick={onSettings} />
      </div>
    </aside>
  );
}
