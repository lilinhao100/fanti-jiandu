import { Check } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export type MenuEntry =
  | {
      kind?: 'item';
      label: string;
      onSelect(): void;
      shortcut?: string;
      /** 有这个字段就是单选项（role=menuitemradio），并在左边留出对勾的位置 */
      checked?: boolean;
      danger?: boolean;
    }
  | { kind: 'sep' }
  | { kind: 'label'; text: string };

const MARGIN = 8;

/** 弹出菜单：固定定位 + 挂到 body，不会被滚动容器裁掉；放不下时翻到按钮上方。Esc、点外面都会关闭 */
function MenuPopup({ anchor, trigger, entries, onClose }: { anchor: DOMRect; trigger: HTMLElement | null; entries: MenuEntry[]; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);
  const hasChecks = entries.some((e) => e.kind !== 'sep' && e.kind !== 'label' && e.checked !== undefined);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = anchor.right - w;
    left = Math.max(MARGIN, Math.min(left, window.innerWidth - w - MARGIN));
    let top = anchor.bottom + 6;
    let origin = 'top right';
    if (top + h > window.innerHeight - MARGIN && anchor.top - 6 - h >= MARGIN) {
      top = anchor.top - 6 - h;
      origin = 'bottom right';
    }
    top = Math.max(MARGIN, Math.min(top, window.innerHeight - h - MARGIN));
    setPos({ left, top, origin });
  }, [anchor, entries]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Node;
      // 点触发按钮自己：交给它的 click 去切换，免得先关后开
      if (!ref.current?.contains(t) && !trigger?.contains(t)) onClose();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
      if (opener && document.contains(opener)) opener.focus({ preventScroll: true });
    };
  }, [onClose, trigger]);

  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('.menu-item') ?? []);
    if (items.length === 0) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
    items[next]!.focus();
  };

  return createPortal(
    <div
      ref={ref}
      className="menu glass"
      role="menu"
      tabIndex={-1}
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, transformOrigin: pos?.origin, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={onMenuKey}
    >
      {entries.map((e, i) => {
        if (e.kind === 'sep') return <div key={i} className="sep" role="separator" />;
        if (e.kind === 'label')
          return (
            <div key={i} className="menu-label">
              {e.text}
            </div>
          );
        const radio = e.checked !== undefined;
        return (
          <button
            key={i}
            className={`menu-item${e.danger ? ' danger' : ''}`}
            role={radio ? 'menuitemradio' : 'menuitem'}
            aria-checked={radio ? e.checked : undefined}
            onClick={() => {
              onClose();
              e.onSelect();
            }}
          >
            {hasChecks && <span className="check">{e.checked && <Check size={13} weight="bold" />}</span>}
            <span className="label">{e.label}</span>
            {e.shortcut && <span className="shortcut">{e.shortcut}</span>}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

/** 一个按钮加它弹出的菜单。entries 在每次渲染时重新算，菜单开着时也跟着最新状态走 */
export function MenuButton({
  entries,
  className,
  label,
  children,
  testId,
}: {
  entries: MenuEntry[];
  className?: string;
  label: string;
  children: ReactNode;
  testId?: string;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={className}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        data-testid={testId}
        onClick={() => setAnchor((a) => (a ? null : btn.current!.getBoundingClientRect()))}
      >
        {children}
      </button>
      {anchor && <MenuPopup anchor={anchor} trigger={btn.current} entries={entries} onClose={close} />}
    </>
  );
}
