// 记住窗口位置和大小：存成 JSON（userData/window-state.json），不用任何原生模块。
import fs from 'node:fs';
import path from 'node:path';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedWindow extends Rect {
  maximized: boolean;
}

export type WindowStates = Record<string, SavedWindow>;

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function loadWindowStates(file: string): WindowStates {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Partial<SavedWindow>>;
    const out: WindowStates = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v && num(v.x) && num(v.y) && num(v.width) && num(v.height) && v.width > 100 && v.height > 100) {
        out[k] = { x: v.x, y: v.y, width: v.width, height: v.height, maximized: v.maximized === true };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function saveWindowStates(file: string, states: WindowStates): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(states));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn('保存窗口位置失败', e);
  }
}

/** 窗口至少有一块 80×40 的区域落在某个显示器的工作区里才算“看得见”（拔掉外接显示器后避免窗口跑到屏幕外） */
export function isVisible(r: Rect, workAreas: Rect[]): boolean {
  return workAreas.some((w) => {
    const ox = Math.min(r.x + r.width, w.x + w.width) - Math.max(r.x, w.x);
    const oy = Math.min(r.y + r.height, w.y + w.height) - Math.max(r.y, w.y);
    return ox >= 80 && oy >= 40;
  });
}

/** 把保存的状态变成可用的窗口位置；位置不可见时只保留大小（交给系统居中） */
export function restore(
  saved: SavedWindow | undefined,
  workAreas: Rect[],
  min: { width: number; height: number },
): { bounds: Partial<Rect>; maximized: boolean } | null {
  if (!saved) return null;
  const width = Math.max(min.width, saved.width);
  const height = Math.max(min.height, saved.height);
  if (isVisible({ x: saved.x, y: saved.y, width, height }, workAreas)) {
    return { bounds: { x: saved.x, y: saved.y, width, height }, maximized: saved.maximized };
  }
  return { bounds: { width, height }, maximized: saved.maximized };
}
