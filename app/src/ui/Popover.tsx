import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * 从按钮下方弹出的玻璃面板，带指向按钮的小三角（DESIGN 2.5）。
 * 用 fixed 定位，位置由触发按钮的矩形算出，放不下时贴着窗口边缘；窗口大小变化时重新定位。
 * 关闭由调用方负责（点外面、Esc）。面板根节点带 data-panel-root，调用方据此判断“点在面板里”。
 */
export function Popover({
  anchor,
  width,
  align,
  label,
  testId,
  className,
  children,
}: {
  anchor: HTMLElement | null;
  width: number;
  /** start：面板左边缘靠近按钮（左侧按钮）；end：面板右边缘靠近按钮（右侧按钮） */
  align: 'start' | 'end';
  label: string;
  testId?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [tick, setTick] = useState(0);

  useLayoutEffect(() => {
    const onResize = (): void => setTick((t) => t + 1);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // 位置在渲染时直接算出（不先隐藏再定位），这样面板里的输入框一出现就能获得焦点
  const pos = useMemo(() => {
    if (!anchor) return null;
    const r = anchor.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const margin = 12;
    const w = Math.min(width, window.innerWidth - margin * 2);
    let left = align === 'start' ? cx - 36 : cx - w + 36;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    const arrow = Math.max(20, Math.min(cx - left, w - 20));
    return { left, top: r.bottom + 10, arrow };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anchor, width, align, tick]);

  return (
    <div
      ref={ref}
      className={`popover glass${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-label={label}
      data-panel-root
      data-testid={testId}
      style={{
        left: pos?.left ?? 0,
        top: pos?.top ?? 0,
        width: Math.min(width, window.innerWidth - 24),
        transformOrigin: `${pos?.arrow ?? 0}px -8px`,
      }}
    >
      <span className="arrow glass" style={{ left: (pos?.arrow ?? 0) - 9 }} aria-hidden />
      {children}
    </div>
  );
}
