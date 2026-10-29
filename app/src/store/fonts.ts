// 字体状态（M2d）：能选的字体列表、导入字体的 @font-face 规则、“字体不可用，已改用宋体”的提示。
// 列表来自 platform.listFonts()；列表更新后立刻检查设置里选的字体还在不在，不在就退回宋体。
import { create } from 'zustand';
import type { FontInfo } from '../model';
import { getPlatform } from '../platform';
import { checkFonts } from '../reader/fonts';
import { useSettings } from './settings';

interface FontsState {
  list: FontInfo[];
  listLoaded: boolean;
  /** 导入字体的 @font-face 规则：注入界面，也注入阅读 iframe（reader/styles.ts） */
  faceCss: string;
  /** 面板里显示的提示；退回宋体、导入失败都放这里 */
  notice: { kind: 'info' | 'error'; text: string } | null;
  /** 读一次 @font-face 规则（同一个窗口里只读一次，阅读器打开书之前等它） */
  ensureFaces(): Promise<void>;
  reloadFaces(): Promise<void>;
  /** 重新读列表并检查设置里的字体 */
  refresh(): Promise<void>;
  importFonts(): Promise<FontInfo[]>;
  removeFont(id: string): Promise<void>;
  setNotice(n: FontsState['notice']): void;
}

let facesPromise: Promise<void> | null = null;
let refreshSeq = 0;

export const useFonts = create<FontsState>((set, get) => ({
  list: [],
  listLoaded: false,
  faceCss: '',
  notice: null,

  ensureFaces() {
    facesPromise ??= get().reloadFaces();
    return facesPromise;
  },

  async reloadFaces() {
    try {
      const css = await getPlatform().fontFaceCss();
      if (css !== get().faceCss) set({ faceCss: css });
    } catch (e) {
      console.warn('读取导入字体失败', e);
    }
  },

  async refresh() {
    const seq = ++refreshSeq;
    let list: FontInfo[];
    try {
      list = await getPlatform().listFonts();
    } catch (e) {
      console.warn('读取字体列表失败', e);
      return;
    }
    if (seq !== refreshSeq) return; // 更新的一次已经在路上
    set({ list, listLoaded: true });
    // 设置里选的字体被卸载或删掉了：退回宋体，提示一次
    const st = useSettings.getState();
    const settings = st.loaded ? st.settings : await st.load();
    const check = checkFonts(settings.appearance, list);
    if (check.patch) {
      set({ notice: { kind: 'info', text: check.notices.join('；') } });
      await st.update((s) => ({ ...s, appearance: { ...s.appearance, ...check.patch } }));
    }
  },

  async importFonts() {
    try {
      const added = await getPlatform().importFonts();
      if (added.length > 0) {
        await get().reloadFaces();
        await get().refresh();
        set({ notice: null });
      }
      return added;
    } catch (e) {
      set({ notice: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
      return [];
    }
  },

  async removeFont(id) {
    try {
      await getPlatform().removeFont(id);
    } catch (e) {
      set({ notice: { kind: 'error', text: e instanceof Error ? e.message : String(e) } });
      return;
    }
    await get().reloadFaces();
    // refresh 里会发现设置选的就是这个字体，退回宋体并给出提示
    await get().refresh();
  },

  setNotice(notice) {
    set({ notice });
  },
}));
