import {
  type ReactNode,
  type RefObject,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';
import { useLocation } from 'react-router-dom';

/**
 * What each tab's page was showing, so a tab looks the same when it is shown
 * again: only the active tab's page is mounted, and the others' state waits
 * here. Each value belongs to a tab and to the page it was on, so a tab that
 * goes to another tool starts that tool afresh, and going back restores the
 * first. Kept in memory only, as it holds dropped files.
 */
const stores = new Map<string, Map<string, unknown>>();

const storeFor = (id: string) => {
  let store = stores.get(id);
  if (!store) stores.set(id, (store = new Map()));
  return store;
};

/** Forgets what a tab's page was showing, for a closed or reloaded tab. */
export const clearTabState = (id: string) => stores.delete(id);

/** Told the tab and slot of each value a page changes (see sessions.ts). */
type Listener = (tabId: string, slot: string) => void;
const listeners = new Set<Listener>();

export function onTabStateChange(listener: Listener) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Keys a snapshot leaves out: where the page was scrolled or panned to
 *  (and every `view:` key, see useTabView). */
const unsaved = new Set(['scroll', 'camera']);

/**
 * What the tab's page at `pathname` holds, by key: everything it keeps with
 * `useTabState`, to save as a session.
 */
export function snapshotTab(tabId: string, pathname: string) {
  const values: Record<string, unknown> = {};
  const prefix = `${pathname}:`;
  for (const [slot, value] of stores.get(tabId) ?? []) {
    const key = slot.slice(prefix.length);
    if (
      slot.startsWith(prefix) &&
      !unsaved.has(key) &&
      !key.startsWith('view:')
    ) {
      values[key] = value;
    }
  }
  return values;
}

/** One value of a tab's page, set at once, ahead of its page's effects. */
export function writeTabValue(
  tabId: string,
  pathname: string,
  key: string,
  value: unknown,
) {
  storeFor(tabId).set(`${pathname}:${key}`, value);
}

/** The value `key` the tab's page at `pathname` holds, if any. */
export const readTabValue = (tabId: string, pathname: string, key: string) =>
  stores.get(tabId)?.get(`${pathname}:${key}`);

/** Empties the tab's page at `pathname`, so it next shows afresh. */
export function clearTabPage(tabId: string, pathname: string) {
  const store = stores.get(tabId);
  if (!store) return;
  for (const slot of store.keys()) {
    if (slot.startsWith(`${pathname}:`)) store.delete(slot);
  }
}

/**
 * Fills a tab's page at `pathname` with saved values before it is shown, so
 * it opens as it was.
 */
export function seedTab(
  tabId: string,
  pathname: string,
  values: Record<string, unknown>,
) {
  const store = storeFor(tabId);
  for (const [key, value] of Object.entries(values)) {
    store.set(`${pathname}:${key}`, value);
  }
}

export const TabContext = createContext('');

/** Marks the page below as the tab `id`'s, for `useTabState`. */
export function TabProvider({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return <TabContext value={id}>{children}</TabContext>;
}

/** Where in its tab's store a page keeps the value `key`. */
function useSlot(key: string) {
  const id = useContext(TabContext);
  const { pathname } = useLocation();
  return { id, slot: `${pathname}:${key}` };
}

/**
 * `useState` for a page's state that should outlast its page: the value is
 * kept for the tab while another tab is showing, and comes back with it.
 */
export function useTabState<T>(key: string, initial: T | (() => T)) {
  const { id, slot } = useSlot(key);
  const [value, setValue] = useState<T>(() => {
    const store = stores.get(id);
    if (store?.has(slot)) return store.get(slot) as T;
    return initial instanceof Function ? initial() : initial;
  });
  useEffect(() => {
    const store = storeFor(id);
    const changed = store.get(slot) !== value;
    store.set(slot, value);
    if (changed) listeners.forEach((listener) => listener(id, slot));
  }, [id, slot, value]);
  return [value, setValue] as const;
}

/**
 * Where a part of a page was looking, such as a timeline's zoom and scroll,
 * kept with its tab while another tab shows, as useTabScroll keeps a page's
 * scroll: read it when the part comes back, write it as it changes. Like
 * the scroll, it isn't saved with the session (so it doesn't outlast a
 * reload), and writing it isn't a change to the session.
 */
export function useTabView<T>(key: string) {
  const { id, slot } = useSlot(`view:${key}`);
  return useMemo(
    () => ({
      read: () => stores.get(id)?.get(slot) as T | undefined,
      write: (value: T) => void storeFor(id).set(slot, value),
    }),
    [id, slot],
  );
}

/** Keeps the scroll position of a page's scrolling area with its tab. */
export function useTabScroll(ref: RefObject<HTMLElement | null>) {
  const { id, slot } = useSlot('scroll');
  // Before the page is painted, so it never shows at the top first.
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    area.scrollTop = (stores.get(id)?.get(slot) as number | undefined) ?? 0;
    const onScroll = () => storeFor(id).set(slot, area.scrollTop);
    area.addEventListener('scroll', onScroll, { passive: true });
    return () => area.removeEventListener('scroll', onScroll);
  }, [ref, id, slot]);
}

/**
 * A value of the page's kept with its tab, read and written without
 * rendering again or telling History: where a canvas was panned to.
 */
export function useTabStash<T>(key: string) {
  const { id, slot } = useSlot(key);
  return {
    read: () => stores.get(id)?.get(slot) as T | undefined,
    write: (value: T) => void storeFor(id).set(slot, value),
  };
}
