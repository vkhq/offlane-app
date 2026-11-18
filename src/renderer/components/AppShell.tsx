import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';

import { basename } from '../app/basename';
import {
  OpenSessionContext,
  sessionUrl,
  useSessionRoute,
  useSessions,
} from '../sessions';
import { TabProvider } from '../tabState';
import { pageOf, preloadPages, tools } from '../tools';
import { HistoryPage } from './HistoryPage';
import { HomePage } from './HomePage';
import { openSettings, openSettingsPath, settingsPath } from '../settingsModal';
import { SettingsModal } from './SettingsModal';
import { type BusyRun, stopRuns, useBusyTabs } from '../busyTabs';
import { StopRunsDialog } from './StopRunsDialog';
import { hasModifier } from './keys';
import { QuickSearch } from './QuickSearch';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';
import { ToolkitGate, ToolkitSplash } from './Toolkits';
import { ExternalGate } from './ExternalTools';
import { isToolOn, useExternalTools } from '../externalTools';
import { useMissingToolkits, useToolkits } from '../toolkits';
import {
  type Tab,
  homeId,
  isPinned,
  pathOf,
  singlePages,
  useTabs,
} from './tabs';

type Shortcuts = Record<
  | 'back'
  | 'forward'
  | 'sidebar'
  | 'search'
  | 'newTab'
  | 'closeTab'
  | 'reopenTab'
  | 'history'
  | 'settings'
  | 'home',
  () => void
>;

/** Where quick search opens its pick: the current tab, or a new one. */
type SearchMode = 'current' | 'new-tab';

/**
 * App-wide keyboard shortcuts: Cmd+[ goes back and Cmd+] goes forward, as in a
 * browser, Cmd+\ shows or hides the rail, Cmd+P opens quick search, and
 * Cmd+T opens it to pick a page for a new tab. Cmd+W closes the current tab,
 * or the app when only the pinned Home tab is left, and Cmd+Shift+T reopens
 * the last tab closed. Cmd+Y shows History, in its tab if one is open, else
 * in a new one, as in Chrome; Cmd+, opens Settings, as in any Mac app. Cmd+H
 * shows Home, in place of the macOS Hide shortcut.
 */
function useShortcuts(shortcuts: Shortcuts) {
  // Always the latest handlers, so the listener is attached only once.
  const latest = useRef(shortcuts);
  latest.current = shortcuts;

  useEffect(() => {
    // `code` is the physical key, so these work on any keyboard layout.
    const keys: Record<string, keyof Shortcuts> = {
      BracketLeft: 'back',
      BracketRight: 'forward',
      Backslash: 'sidebar',
      KeyP: 'search',
      KeyT: 'newTab',
      KeyW: 'closeTab',
      KeyY: 'history',
      Comma: 'settings',
      KeyH: 'home',
    };
    const shiftKeys: Record<string, keyof Shortcuts> = {
      KeyT: 'reopenTab',
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!hasModifier(event) || event.altKey) return;
      const shortcut = (event.shiftKey ? shiftKeys : keys)[event.code];
      if (!shortcut) return;
      event.preventDefault();
      // Holding the keys down should not flip the sidebar back and forth.
      if (!event.repeat) latest.current[shortcut]();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/**
 * Cmd+Click on an in-app link opens its page in a new background tab, as in a
 * browser, and a link to Settings opens its modal. Any other plain click is
 * the link's own, and the tabs follow the router.
 */
function useLinkClicks(open: (path: string, background: boolean) => void) {
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const href = (event.target as Element)
        .closest?.('a[href]')
        ?.getAttribute('href');
      if (href !== basename && !href?.startsWith(`${basename}/`)) return;
      const path = href.slice(basename.length) || '/';
      const settings =
        path === settingsPath || path.startsWith(`${settingsPath}/`);
      if (!settings && !hasModifier(event)) return;
      // Handled here, before the link or the browser can act on it.
      event.preventDefault();
      event.stopPropagation();
      // Settings is a modal, not a page, so its links never open a tab.
      if (!openSettingsPath(path)) open(path, true);
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [open]);
}

/**
 * A tab's right-click menu, laid out like Chrome's: the same items in the same
 * order, less the ones for features this app does not have.
 */
function tabMenu(tabs: Tab[], id: string): MenuLine[] {
  const at = tabs.findIndex((tab) => tab.id === id);
  const tab = tabs[at];
  const home = id === homeId;
  const closable = (other: Tab) => other.id !== id && !isPinned(other);
  return [
    { id: 'new-right', label: 'New tab to the right' },
    null,
    { id: 'reload', label: 'Reload' },
    { id: 'duplicate', label: 'Duplicate', enabled: !home },
    { id: 'pin', label: isPinned(tab) ? 'Unpin' : 'Pin', enabled: !home },
    null,
    { id: 'close', label: 'Close', enabled: !home },
    {
      id: 'close-others',
      label: 'Close other tabs',
      enabled: tabs.some(closable),
    },
    {
      id: 'close-right',
      label: 'Close tabs to the right',
      enabled: tabs.slice(at + 1).some(closable),
    },
  ];
}

/**
 * A tool's page, at `/<tool id>`. Each tool's page is loaded the first time
 * it is opened; until then the page area stays blank.
 */
function ToolRoute() {
  const { toolId } = useParams();
  const tool = tools.find((candidate) => candidate.id === toolId);
  // The page shows the session its address names, filled in from History
  // first when the tab doesn't hold it (see useSessionRoute).
  const ready = useSessionRoute();
  // A toolkit it needs that isn't installed takes the page's place, with a
  // way to install it; null while the toolkits' state is still loading.
  const missing = useMissingToolkits(tool);
  // A tool that runs a program the person installs stays off until they
  // turn it on (see externalTools); null while that is still loading.
  const external = useExternalTools();
  if (!tool) return <Navigate to="/" replace />;
  if (!ready || !missing) return null;
  if (tool.enabledBy) {
    if (!external) return null;
    if (!isToolOn(tool, external)) {
      const { found } = external.ytdlp;
      // Still looking: wait, rather than send the page away too soon.
      if (!found && external.scanning) return null;
      // Without the program the tool doesn't exist here: off to Home.
      if (!found) return <Navigate to="/" replace />;
      return <ExternalGate tool={tool} found={found} />;
    }
  }
  if (missing.length > 0) return <ToolkitGate tool={tool} missing={missing} />;
  const Page = pageOf(tool);
  return (
    <Suspense fallback={null}>
      <Page key={tool.id} tool={tool} />
    </Suspense>
  );
}

/** Whether to show the first-launch toolkit screen: until it is closed. */
function useToolkitSplash() {
  const toolkits = useToolkits();
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  useEffect(() => {
    void window.downloader
      .getSettings()
      .then((settings) => setOnboarded(settings.toolkitsOnboarded));
  }, []);
  const done = () => {
    setOnboarded(true);
    void window.downloader.updateSettings({ toolkitsOnboarded: true });
  };
  // Shown until it has been closed once (and again after Settings › Storage
  // erases everything), whether or not anything is left to download: a
  // development checkout's vendor/ toolkits, say, already count as there.
  // Waits for the toolkits' state, so it never opens empty.
  return { show: onboarded === false && toolkits !== null, done };
}

export function AppShell() {
  // The rail starts shown; Cmd+\ or the tab bar's toggle hides it. Its
  // floating tool panel starts hidden, and hovering or clicking a tool group
  // in the rail shows it.
  const [railShown, setRailShown] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [search, setSearch] = useState<SearchMode | null>(null);
  const {
    tabs,
    activeId,
    go,
    step,
    open,
    select,
    close: closeNow,
    reopen,
    duplicate,
    reload,
    togglePin,
    move,
    closeOthers: closeOthersNow,
    closeToRight: closeToRightNow,
  } = useTabs();
  const active = tabs.find((tab) => tab.id === activeId) ?? tabs[0];
  const sessionList = useSessions();
  const splash = useToolkitSplash();

  // Tabs whose tool is at work (downloading, compressing), any tool alike:
  // their tab shows how it is going, and closing one asks first, as it
  // stops the work.
  const busy = useBusyTabs(tabs);
  /** Closing tabs that are at work, once confirmed. */
  const [stopping, setStopping] = useState<{
    runs: BusyRun[];
    tabs: number;
    close: () => void;
  } | null>(null);
  /** Closes the tabs `ids` at once, or asks first if any is at work. */
  const guard = (ids: string[], close: () => void) => {
    const working = ids.flatMap((id) => busy.get(id) ?? []);
    if (working.length === 0) close();
    else {
      setStopping({
        runs: working.flatMap((work) => work.runs),
        tabs: working.length,
        close,
      });
    }
  };
  const close = (id: string) => guard([id], () => closeNow(id));
  const unpinned = (list: Tab[]) =>
    list.filter((tab) => !isPinned(tab)).map((tab) => tab.id);
  const closeOthers = (id: string) =>
    guard(unpinned(tabs.filter((tab) => tab.id !== id)), () =>
      closeOthersNow(id),
    );
  const closeToRight = (id: string) =>
    guard(
      unpinned(tabs.slice(tabs.findIndex((tab) => tab.id === id) + 1)),
      () => closeToRightNow(id),
    );

  /**
   * Opens a saved session (from History) as it was: the tab already showing
   * it, else a new tab at its address, which fills itself in from it (see
   * useSessionRoute).
   */
  const openSession = useCallback(
    (id: string) => {
      const session = sessionList.find((candidate) => candidate.id === id);
      if (!session || !tools.some((tool) => tool.id === session.toolId)) {
        return;
      }
      const url = sessionUrl(session.toolId, id);
      const showing = tabs.find((tab) => pathOf(tab) === url);
      if (showing) select(showing.id);
      else open(url);
    },
    [sessionList, tabs, select, open],
  );
  // Tool pages load on first use; this fetches them while the app is idle.
  useEffect(preloadPages, []);
  // The tab "New tab to the right" was picked on, so the new tab lands there.
  const newTabAfter = useRef<string | undefined>(undefined);

  // Hiding the rail takes its tool panel with it.
  const toggleRail = () => {
    setSidebarOpen(false);
    setRailShown((shown) => !shown);
  };
  // Pressing a mode's shortcut again closes it; the other one switches mode.
  const toggleSearch = (mode: SearchMode) => {
    newTabAfter.current = undefined;
    setSearch((current) => (current === mode ? null : mode));
  };

  const showTabMenu = async (id: string) => {
    // Only the desktop app has native menus; a plain browser has no bridge.
    const choice = await window.app?.contextMenu(tabMenu(tabs, id));
    if (choice === 'new-right') {
      newTabAfter.current = id;
      setSearch('new-tab');
    } else if (choice === 'reload') reload(id);
    else if (choice === 'duplicate') duplicate(id);
    else if (choice === 'pin') togglePin(id);
    else if (choice === 'close') close(id);
    else if (choice === 'close-others') closeOthers(id);
    else if (choice === 'close-right') closeToRight(id);
  };

  useLinkClicks(open);
  useShortcuts({
    back: () => step(-1),
    forward: () => step(1),
    sidebar: toggleRail,
    search: () => toggleSearch('current'),
    newTab: () => toggleSearch('new-tab'),
    // The pinned Home tab never closes; on its own, it closes the app.
    closeTab: () => {
      if (activeId !== homeId) close(activeId);
      else if (tabs.length === 1) window.app.quit();
    },
    reopenTab: reopen,
    // History is a single-tab page, so this selects its tab if it has one.
    history: () => open('/history'),
    // Settings is a modal over whatever is showing.
    settings: () => openSettings(),
    // Home lives only in the pinned tab, so this selects it.
    home: () => go('/'),
  });

  return (
    // The sidebar runs down the window's left side, with the tab bar and the
    // page beside it, or they fill the window when it is hidden. The tool
    // panel floats over the page, so it never moves it.
    <div className="relative flex h-full text-ink">
      {/* Behind the translucent sidebar and the tab bar: the sidebar's wash,
          then the tab bar's colours fading down from the top to the middle.
          It spans the whole window, so the sidebar and the tab bar are one
          surface; the page covers the rest. The wash stays clear on macOS,
          where the window's own material shows instead. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden"
      >
        <div className="sidebar-gradient absolute inset-0" />
        <div className="sidebar-glow absolute inset-x-0 top-0 h-1/2" />
      </div>
      <Sidebar
        shown={railShown}
        onHide={toggleRail}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
        onSearch={() => setSearch('current')}
        onNew={() => toggleSearch('new-tab')}
        onStep={step}
      />

      {/* Raised over the sidebar, so the page card's shadow falls on it; the
          sidebar's tool panel floats above it in turn. */}
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          busy={busy}
          onSelect={(id) => {
            // Home closes the tool panel, as the rail's Home link does, so
            // Home is the page marked in the rail.
            if (id === homeId) setSidebarOpen(false);
            select(id);
          }}
          onClose={close}
          onMove={move}
          onMenu={showTabMenu}
          onNew={() => toggleSearch('new-tab')}
          sidebarShown={railShown}
          onToggleSidebar={toggleRail}
        />
        {/* The page area. Every page (Home, History, the tools) has no
            card: it runs to the window's edges, clear, on the same wash and
            veil as the sidebar, so the sidebar's and the tab bar's colours
            flow on across it. */}
        <div className="absolute top-10 right-0 bottom-0 left-0 flex overflow-hidden bg-white/20">
          {/* Only the active tab's page is mounted; what the others were
              showing waits in the tab store (see `useTabState`). The page is
              the active tab's, which the router's location follows. */}
          <div
            // Reloading a tab gives it a new key, so its page starts afresh.
            key={`${active.id}:${active.reloads ?? 0}`}
            className="flex min-h-0 min-w-0 flex-1"
          >
            <TabProvider id={active.id}>
              <OpenSessionContext value={openSession}>
                <Routes location={pathOf(active)}>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/history" element={<HistoryPage />} />
                  <Route path="/:toolId" element={<ToolRoute />} />
                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </OpenSessionContext>
            </TabProvider>
          </div>
        </div>
      </div>

      {search && (
        <QuickSearch
          // Switching mode starts the search afresh.
          key={search}
          hint={search === 'new-tab' ? '⌘T' : '⌘P'}
          onClose={() => setSearch(null)}
          onOpen={(path, background) => {
            // Settings opens its modal. Home only ever selects the pinned
            // Home tab, and History selects its tab, or opens one if none is
            // showing it, as Cmd+Y does.
            if (openSettingsPath(path)) return;
            if (path === '/') go(path);
            else if (singlePages.includes(path)) open(path);
            // From the + button or Cmd+T the pick always gets a new tab, and
            // that tab is shown. Otherwise Cmd+Click opens one in the
            // background and a plain pick replaces the current page.
            else if (search === 'new-tab')
              open(path, false, newTabAfter.current);
            else if (background) open(path, true);
            else go(path);
          }}
        />
      )}

      <SettingsModal />

      {splash.show && <ToolkitSplash onDone={splash.done} />}

      {stopping && (
        <StopRunsDialog
          runs={stopping.runs}
          tabs={stopping.tabs}
          onCancel={() => setStopping(null)}
          onConfirm={() => {
            const { runs, close: closeTabs } = stopping;
            setStopping(null);
            closeTabs();
            void stopRuns(runs);
          }}
        />
      )}
    </div>
  );
}
