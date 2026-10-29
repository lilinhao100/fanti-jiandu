import { Copy, Note, TextUnderline, Trash } from '@phosphor-icons/react';
import { useLayoutEffect, useRef } from 'react';
import { useReaderStore } from '../store/reader';
import type { ReaderController } from './controller';
import { COLOR_STYLES } from './highlightPaint';

const COLOR_NAME: Record<(typeof COLOR_STYLES)[number], string> = { yellow: '黄色', green: '绿色', blue: '蓝色', pink: '粉色', purple: '紫色' };

/**
 * 选区上方 8px 的玻璃胶囊菜单（DESIGN 2.8）：5 个颜色圆点、下划线、笔记、拷贝；点在已有高亮上时多一个删除。
 * 位置由控制器按选区算好放进 store（视口坐标）；mousedown 不抢焦点，免得页面里的选区被取消。
 */
export function SelectionMenu({ ctrl }: { ctrl: ReaderController | null }) {
  const menu = useReaderStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  // 菜单按选区的中点居中，但整条不能超出窗口：量出宽度后再夹一次（点在窗口边上的高亮时）
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !menu) return;
    const w = el.offsetWidth;
    el.style.left = `${Math.max(w / 2 + 8, Math.min(menu.x, window.innerWidth - w / 2 - 8))}px`;
  }, [menu]);
  if (!menu || !ctrl) return null;
  const existing = menu.hid !== null;
  return (
    <div
      ref={ref}
      className="sel-menu glass"
      role="toolbar"
      aria-label="标注"
      data-sel-menu
      data-panel-root
      data-testid="sel-menu"
      data-below={menu.below || undefined}
      style={{ left: menu.x, top: menu.y }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div className="sel-dots" role="group" aria-label="高亮颜色">
        {COLOR_STYLES.map((c) => (
          <button
            key={c}
            className="hl-dot"
            data-testid={`hl-${c}`}
            aria-label={`${COLOR_NAME[c]}高亮`}
            title={`${COLOR_NAME[c]}高亮`}
            aria-pressed={menu.style === c}
            style={{ ['--dot' as string]: `var(--c-hl-${c})` }}
            onClick={() => ctrl.applyHighlightStyle(c)}
          />
        ))}
        <button className="hl-ul" data-testid="hl-underline" aria-label="下划线" title="下划线" aria-pressed={menu.style === 'underline'} onClick={() => ctrl.applyHighlightStyle('underline')}>
          <TextUnderline size={18} />
        </button>
      </div>
      <span className="sel-sep" aria-hidden />
      <button className="sel-btn" data-testid="hl-note" onClick={() => ctrl.startNote()}>
        <Note size={16} />
        笔记
      </button>
      <button className="sel-btn" data-testid="hl-copy" onClick={() => void ctrl.copySelection()}>
        <Copy size={16} />
        拷贝
      </button>
      {existing && (
        <>
          <span className="sel-sep" aria-hidden />
          <button
            className="sel-btn danger"
            data-testid="hl-delete"
            onClick={() => {
              ctrl.removeHighlight(menu.hid!);
              ctrl.hideMenu();
            }}
          >
            <Trash size={16} />
            删除
          </button>
        </>
      )}
    </div>
  );
}
