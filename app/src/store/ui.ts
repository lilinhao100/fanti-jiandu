import { create } from 'zustand';

/** 界面层的临时状态（不持久化）。设置窗口在 web 版里是模态层，书库和阅读页都能用 Ctrl+, 打开 */
interface UiState {
  settingsOpen: boolean;
  setSettingsOpen(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
}));
