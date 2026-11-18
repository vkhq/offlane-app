import { useSyncExternalStore } from 'react';

export type HistoryItem = {
  name: string;
  kind: 'file' | 'link' | 'recording';
  /** Bytes; files only. */
  size?: number;
};

/** One press of a tool's action button, with what it was run on. */
export type Activity = {
  id: string;
  toolId: string;
  /** Milliseconds since the epoch. */
  at: number;
  items: HistoryItem[];
};

// Kept in this browser profile only. Names and sizes are stored, not the
// files themselves.
const key = 'history';
// Where History was kept when the page was called Recents; read until the
// first save moves it under the new key.
const legacyKey = 'recents';
const limit = 50;

const read = (): Activity[] => {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(key) ?? localStorage.getItem(legacyKey) ?? '[]',
    );
    return Array.isArray(stored) ? stored : [];
  } catch {
    return [];
  }
};

let activities = read();
const listeners = new Set<() => void>();

const save = (next: Activity[]) => {
  activities = next;
  try {
    localStorage.setItem(key, JSON.stringify(next));
    localStorage.removeItem(legacyKey);
  } catch {
    // Storage is full or unavailable; the list still works for this session.
  }
  listeners.forEach((listener) => listener());
};

export const addActivity = (toolId: string, items: HistoryItem[]) =>
  save(
    [
      { id: crypto.randomUUID(), toolId, at: Date.now(), items },
      ...activities,
    ].slice(0, limit),
  );

export const clearActivities = () => save([]);

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Most recent first. */
export const useActivities = () =>
  useSyncExternalStore(subscribe, () => activities);
