import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { clearTabState } from '../tabState';
import { tools } from '../tools';
import { pages } from './Sidebar';

/** A tab is its own browsing history: the pages it has visited and where it is. */
export type Tab = {
  id: string;
  entries: string[];
  index: number;
  /** Kept at the left as just its icon, like Home. */
  pinned?: boolean;
  /** Bumped to reload the tab, which starts its page afresh. */
  reloads?: number;
};

/** A closed tab and where it stood, so it can be put back. */
type ClosedTab = { tab: Tab; at: number };

type TabsState = {
  tabs: Tab[];
  activeId: string;
  /** Recently closed tabs, the latest last. */
  closed: ClosedTab[];
};

/** How many closed tabs are remembered for reopening, as in Chrome. */
const closedLimit = 25;

export const pathOf = (tab: Tab) => tab.entries[tab.index];

/** The pinned first tab. It always shows Home and cannot be closed. */
export const homeId = 'home';

const homeTab: Tab = { id: homeId, entries: ['/'], index: 0 };

/** Home, and any tab the user pinned: shown as icons, ahead of the others. */
export const isPinned = (tab: Tab) => tab.id === homeId || !!tab.pinned;

/** How many tabs lead the strip as pinned ones. */
const pinnedCount = (tabs: Tab[]) => tabs.filter(isPinned).length;

/**
 * Inserts `tab` just after the tab `afterId`, or at the end without one. An
 * unpinned tab never goes among the pinned ones.
 */
function insertAfter(tabs: Tab[], tab: Tab, afterId?: string) {
  const anchor = afterId ? tabs.findIndex((other) => other.id === afterId) : -1;
  const at = anchor < 0 ? tabs.length : Math.max(anchor + 1, pinnedCount(tabs));
  return [...tabs.slice(0, at), tab, ...tabs.slice(at)];
}

/**
 * Closes the given tabs and remembers them for reopening. If the active one
 * goes, the tab `fallbackId` is shown, or else the active tab's right-hand
 * neighbour, else its left one.
 */
function closeTabs(
  current: TabsState,
  shut: (tab: Tab) => boolean,
  fallbackId?: string,
): TabsState {
  const closing = (tab: Tab) => tab.id !== homeId && shut(tab);
  const tabs = current.tabs.filter((tab) => !closing(tab));
  // Right to left, so reopening them one by one puts each back in its place.
  const shutNow = current.tabs
    .map((tab, at) => ({ tab, at }))
    .filter(({ tab }) => closing(tab))
    .reverse();
  const closed = [...current.closed, ...shutNow].slice(-closedLimit);
  // A reopened tab gets a new id and starts afresh, so their pages' state goes.
  shutNow.forEach(({ tab }) => clearTabState(tab.id));
  if (tabs.some((tab) => tab.id === current.activeId)) {
    return { tabs, activeId: current.activeId, closed };
  }
  if (fallbackId && tabs.some((tab) => tab.id === fallbackId)) {
    return { tabs, activeId: fallbackId, closed };
  }
  const at = current.tabs.findIndex((tab) => tab.id === current.activeId);
  const after = current.tabs.slice(at + 1).find((tab) => !closing(tab));
  return { tabs, activeId: (after ?? tabs[tabs.length - 1]).id, closed };
}

/**
 * A tab's page without its query: a tool page may carry the session it
 * shows, as /download-video?session_id=… (see sessions.ts).
 */
export const pagePath = (path: string) => path.split('?')[0];

/** The name and icon a tab shows for the page it is on. */
export function describe(entry: string) {
  const path = pagePath(entry);
  const tool = tools.find((candidate) => `/${candidate.id}` === path);
  if (tool) return { name: tool.name, icon: tool.icon };
  const page = pages.find((candidate) => candidate.to === path) ?? pages[0];
  return { name: page.name, icon: page.icon };
}

const isPage = (entry: string) => {
  const path = pagePath(entry);
  return (
    pages.some((page) => page.to === path) ||
    tools.some((tool) => `/${tool.id}` === path)
  );
};

/** Pages that are only ever open in one tab; going there again selects it. */
export const singlePages = ['/history'];

/** The tab already showing `path`, if it is a single-tab page. */
const singleTab = (tabs: Tab[], path: string) =>
  singlePages.includes(path)
    ? tabs.find((tab) => pathOf(tab) === path)
    : undefined;

const createTab = (path: string): Tab => ({
  id: crypto.randomUUID(),
  entries: [path],
  index: 0,
});

// The tabs outlast a reload of the page, as a browser window's do, but not
// the window: session storage goes when it closes, so a launch starts afresh.
const savedKey = 'tabs';

const isTab = (tab: Partial<Tab> | undefined): tab is Tab =>
  typeof tab?.id === 'string' &&
  Array.isArray(tab.entries) &&
  tab.entries.length > 0 &&
  tab.entries.every((path) => path === '/' || isPage(path)) &&
  Number.isInteger(tab.index) &&
  tab.index! >= 0 &&
  tab.index! < tab.entries.length;

/** The tabs as they were before the page reloaded, if they were saved. */
function savedTabs(): TabsState | null {
  try {
    const saved = JSON.parse(
      sessionStorage.getItem(savedKey) ?? 'null',
    ) as Partial<TabsState> | null;
    const tabs = (saved?.tabs ?? []).filter(isTab);
    // Home always leads; without it, the save is not one of ours.
    if (!saved || tabs[0]?.id !== homeId) return null;
    const closed = (saved.closed ?? []).filter(
      (entry) => isTab(entry?.tab) && Number.isInteger(entry.at),
    );
    const activeId = tabs.some((tab) => tab.id === saved.activeId)
      ? saved.activeId!
      : homeId;
    return { tabs, activeId, closed };
  } catch {
    return null;
  }
}

function saveTabs(state: TabsState) {
  try {
    sessionStorage.setItem(savedKey, JSON.stringify(state));
  } catch {
    // Storage is unavailable; a reload will start from the page it is on.
  }
}

/**
 * Where a navigation to `to` lands: Home lives only in the pinned tab, so
 * going there selects it, as going to a single-tab page already open does; a
 * page picked from the pinned tab opens in a new tab; anything else goes in
 * the active tab, dropping its forward history.
 */
function follow(current: TabsState, to: string): TabsState {
  if (to === '/') return { ...current, activeId: homeId };
  const single = singleTab(current.tabs, to);
  if (single) return { ...current, activeId: single.id };
  if (current.activeId === homeId) {
    const tab = createTab(to);
    return { ...current, tabs: [...current.tabs, tab], activeId: tab.id };
  }
  return {
    ...current,
    tabs: current.tabs.map((tab) =>
      tab.id !== current.activeId || pathOf(tab) === to
        ? tab
        : {
            ...tab,
            entries: [...tab.entries.slice(0, tab.index + 1), to],
            index: tab.index + 1,
          },
    ),
  };
}

/**
 * The open tabs and which one is showing. The router's location is the page
 * the app is on: links and `go` navigate, and the tabs follow, recording the
 * page in the active tab's history. Each tab keeps that history of its own,
 * which one window's history cannot, so Back and Forward step through it,
 * and switching, stepping or closing tabs moves the location to match.
 */
export function useTabs() {
  const location = useLocation();
  const navigate = useNavigate();

  const [state, setState] = useState<TabsState>(() => {
    const saved = savedTabs();
    if (saved) return saved;
    const start = location.pathname + location.search;
    if (start === '/' || !isPage(start)) {
      return { tabs: [homeTab], activeId: homeId, closed: [] };
    }
    const tab = createTab(start);
    return { tabs: [homeTab, tab], activeId: tab.id, closed: [] };
  });

  useEffect(() => saveTabs(state), [state]);

  const active =
    state.tabs.find((tab) => tab.id === state.activeId) ?? state.tabs[0];
  const path = pathOf(active);

  // The active tab's page when the two last agreed, to tell which one moved.
  const synced = useRef(path);
  useEffect(() => {
    const at = location.pathname + location.search;
    if (at === path) {
      synced.current = path;
    } else if (path !== synced.current) {
      // The tabs moved: a tab was switched to, stepped, opened or closed.
      // Replaced, as tab history lives in the tabs, not the window's.
      synced.current = path;
      navigate(path, { replace: true });
    } else if (at !== '/' && !isPage(at)) {
      navigate(path, { replace: true });
    } else if (
      (location.state as { replaceEntry?: boolean } | null)?.replaceEntry
    ) {
      // The page changed its own address (a session starting or ending):
      // the tab's current entry becomes the new one, adding no history.
      setState((current) => ({
        ...current,
        tabs: current.tabs.map((tab) =>
          tab.id === current.activeId
            ? {
                ...tab,
                entries: tab.entries.map((entry, index) =>
                  index === tab.index ? at : entry,
                ),
              }
            : tab,
        ),
      }));
    } else {
      // The location moved: a link or `go`.
      setState((current) => follow(current, at));
    }
  }, [location.pathname, location.search, location.state, path, navigate]);

  /** Opens a page, in the active tab or the one it belongs in (see `follow`). */
  const go = useCallback((to: string) => navigate(to), [navigate]);

  /** Moves back (-1) or forward (1) through the active tab's history. */
  const step = useCallback((delta: number) => {
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === current.activeId
          ? {
              ...tab,
              index: Math.min(
                Math.max(tab.index + delta, 0),
                tab.entries.length - 1,
              ),
            }
          : tab,
      ),
    }));
  }, []);

  /**
   * Adds a tab after all the others, or just after the tab `afterId`.
   * `background` leaves the current tab showing.
   */
  const open = useCallback(
    (to: string, background = false, afterId?: string) => {
      setState((current) => {
        if (to === '/') {
          return background ? current : { ...current, activeId: homeId };
        }
        const single = singleTab(current.tabs, to);
        if (single) {
          return background ? current : { ...current, activeId: single.id };
        }
        const tab = createTab(to);
        return {
          ...current,
          tabs: insertAfter(current.tabs, tab, afterId),
          activeId: background ? current.activeId : tab.id,
        };
      });
    },
    [],
  );

  /** A copy of the tab, history and all, opened and shown just after it. */
  const duplicate = useCallback((id: string) => {
    setState((current) => {
      const source = current.tabs.find((tab) => tab.id === id);
      if (!source || source.id === homeId) return current;
      const copy: Tab = {
        id: crypto.randomUUID(),
        entries: source.entries,
        index: source.index,
      };
      return {
        ...current,
        tabs: insertAfter(current.tabs, copy, id),
        activeId: copy.id,
      };
    });
  }, []);

  /**
   * Reloads the tab's page, as a browser's reload does: what it held in
   * memory goes, and it starts afresh, unless it was showing a saved
   * session, which is filled in again from History (see useRestoredSession).
   */
  const reload = useCallback((id: string) => {
    clearTabState(id);
    setState((current) => ({
      ...current,
      tabs: current.tabs.map((tab) =>
        tab.id === id ? { ...tab, reloads: (tab.reloads ?? 0) + 1 } : tab,
      ),
    }));
  }, []);

  /**
   * Pinning moves a tab to the end of the pinned ones; unpinning moves it to
   * just after them. Home is always pinned.
   */
  const togglePin = useCallback((id: string) => {
    setState((current) => {
      const tab = current.tabs.find((other) => other.id === id);
      if (!tab || tab.id === homeId) return current;
      const rest = current.tabs.filter((other) => other.id !== id);
      const moved = { ...tab, pinned: !tab.pinned };
      const at = pinnedCount(rest);
      return {
        ...current,
        tabs: [...rest.slice(0, at), moved, ...rest.slice(at)],
      };
    });
  }, []);

  /**
   * Moves a tab to the place `to` in the strip. Home stays first, other
   * pinned tabs stay among the pinned ones, and the rest stay after them.
   */
  const move = useCallback((id: string, to: number) => {
    setState((current) => {
      const tab = current.tabs.find((other) => other.id === id);
      if (!tab || tab.id === homeId) return current;
      const rest = current.tabs.filter((other) => other.id !== id);
      const pinned = pinnedCount(rest);
      const [lowest, highest] = isPinned(tab)
        ? [1, pinned]
        : [pinned, rest.length];
      const at = Math.max(Math.min(to, highest), lowest);
      return {
        ...current,
        tabs: [...rest.slice(0, at), tab, ...rest.slice(at)],
      };
    });
  }, []);

  /** Closes every tab but this one and the pinned ones, and shows this one. */
  const closeOthers = useCallback((id: string) => {
    setState((current) =>
      closeTabs(current, (tab) => tab.id !== id && !isPinned(tab), id),
    );
  }, []);

  /** Closes the unpinned tabs to the right of this one. */
  const closeToRight = useCallback((id: string) => {
    setState((current) => {
      const at = current.tabs.findIndex((tab) => tab.id === id);
      const right = new Set(current.tabs.slice(at + 1).map((tab) => tab.id));
      return closeTabs(
        current,
        (tab) => right.has(tab.id) && !isPinned(tab),
        id,
      );
    });
  }, []);

  const select = useCallback(
    (id: string) => setState((current) => ({ ...current, activeId: id })),
    [],
  );

  /**
   * Closing the active tab shows its right-hand neighbour, else the left one,
   * which is at worst the pinned Home tab. That tab cannot be closed.
   */
  const close = useCallback((id: string) => {
    setState((current) => closeTabs(current, (tab) => tab.id === id));
  }, []);

  /**
   * Brings back the most recently closed tab, history and all, where it was,
   * and shows it. A pinned tab returns among the pinned ones, any other after
   * them.
   */
  const reopen = useCallback(() => {
    setState((current) => {
      const last = current.closed[current.closed.length - 1];
      if (!last) return current;
      // A new id, so it is a new tab to the tab bar and its page starts afresh.
      const tab = { ...last.tab, id: crypto.randomUUID() };
      const pinned = pinnedCount(current.tabs);
      const at = Math.min(
        tab.pinned ? Math.min(last.at, pinned) : Math.max(last.at, pinned),
        current.tabs.length,
      );
      return {
        tabs: [...current.tabs.slice(0, at), tab, ...current.tabs.slice(at)],
        activeId: tab.id,
        closed: current.closed.slice(0, -1),
      };
    });
  }, []);

  return {
    tabs: state.tabs,
    activeId: active.id,
    go,
    step,
    open,
    select,
    close,
    reopen,
    duplicate,
    reload,
    togglePin,
    move,
    closeOthers,
    closeToRight,
  };
}
