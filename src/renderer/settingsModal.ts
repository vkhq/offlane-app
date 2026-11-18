import { useSyncExternalStore } from 'react';

/** Whether the Settings modal is showing, and the group it opens on. */
type State = { open: boolean; group: string | null };

let state: State = { open: false, group: null };
const listeners = new Set<() => void>();

const set = (next: State) => {
  state = next;
  listeners.forEach((listener) => listener());
};

/** Shows Settings, on `group` if given, else where it was last left. */
export const openSettings = (group?: string) =>
  set({ open: true, group: group ?? state.group });

export const closeSettings = () => set({ ...state, open: false });

/** Remembers the group shown, so Settings reopens on it. */
export const setSettingsGroup = (group: string) => set({ ...state, group });

/**
 * Links to Settings: "/settings", or "/settings/<group>" to open on a group.
 * Settings is a modal, not a page, so these never become tabs.
 */
export const settingsPath = '/settings';

export function openSettingsPath(path: string): boolean {
  if (path !== settingsPath && !path.startsWith(`${settingsPath}/`)) {
    return false;
  }
  openSettings(path.slice(settingsPath.length + 1) || undefined);
  return true;
}

export const useSettingsModal = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
