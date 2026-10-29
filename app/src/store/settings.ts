import { create } from 'zustand';
import { DEFAULT_SETTINGS, type Settings } from '../model';
import { getPlatform } from '../platform';

interface SettingsState {
  settings: Settings;
  loaded: boolean;
  load(): Promise<Settings>;
  update(patch: (s: Settings) => Settings): Promise<void>;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  async load() {
    const s = await getPlatform().loadSettings();
    set({ settings: s, loaded: true });
    return s;
  },
  async update(patch) {
    const next = patch(get().settings);
    set({ settings: next });
    await getPlatform().saveSettings(next);
  },
}));
