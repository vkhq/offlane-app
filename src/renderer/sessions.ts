import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import type {
  FilePreview,
  SavedFile,
  SessionMeta,
  SessionStatus,
  SessionSummary,
} from '../shared/types';
import {
  TabContext,
  clearTabPage,
  onTabStateChange,
  readTabValue,
  seedTab,
  snapshotTab,
  useTabState,
  writeTabValue,
} from './tabState';

/**
 * Tool sessions: what a tool page held, saved to the app's database (see
 * main/storage/sessions.ts) so History can list it and open it again as it
 * was, with everything filled in and chosen.
 *
 * A page starts its session with `record()` at its first real action: a
 * link looked up, a tool run. From then on, every change to what it keeps
 * with `useTabState` saves it again, a moment later, so the saved session
 * follows the page. `reset()` ends it, when the page starts over; its next
 * action starts a new one.
 */

/** What History shows for a session; null when there is nothing to save. */
export type SessionLabel = {
  title: string;
  summary: string;
  /** Its picture, as a URL; else one is made from `preview`. */
  thumbnail?: string | null;
  /** The file to make its picture (and length) from, when it has none. */
  preview?: File | SavedFile | string | null;
  /** The length of what it worked on, in seconds. */
  duration?: number | null;
  /** Its shape, width over height; else its picture's. */
  aspect?: number | null;
  /** Its runs by id, with how each stands now. */
  jobs?: Record<string, SessionStatus>;
  /** What its runs are called while under way, and once finished. */
  doing: string;
  done: string;
  /** For a playlist, how many videos it has. */
  playlist?: number | null;
} | null;

/** How long after the last change a session is saved. */
const settle = 400;

/** The URL parameter a tool page's session goes in. */
export const sessionParam = 'session_id';

/** A tool page's address showing session `id`. */
export const sessionUrl = (toolId: string, id: string) =>
  `/${toolId}?${sessionParam}=${encodeURIComponent(id)}`;

const urlSession = (search: string) =>
  new URLSearchParams(search).get(sessionParam);

/**
 * Sessions a page has just put in its address, or taken out (null), by tab
 * and path, until the address catches up: the router applies a navigation
 * in a later render (a transition), and until then the page and its address
 * disagree only because the address is behind.
 */
const pointing = new Map<string, string | null>();

/**
 * Whether the tab's tool page can be shown yet. The page's address names
 * the session it shows (…?session_id=…); when the tab's page holds another
 * one, or none (opened from History, reopened with Cmd+Shift+T, reloaded,
 * or stepped to with Back), it is filled from the database first. Without a
 * session in its address, a page that still holds one starts afresh.
 *
 * Until then it shows nothing, so the page unmounts and saves what it had
 * before its values are replaced.
 */
export function useSessionRoute() {
  const tabId = useContext(TabContext);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const wanted = urlSession(search);
  const held =
    (readTabValue(tabId, pathname, 'session') as string | null) ?? null;
  const key = `${tabId}${pathname}`;
  const settled =
    held === wanted || (pointing.has(key) && pointing.get(key) === held);
  if (pointing.has(key) && pointing.get(key) === wanted) pointing.delete(key);
  // Re-rendered once the page is filled in, to show it.
  const [, setLoaded] = useState(0);

  useEffect(() => {
    if (settled) return;
    if (!wanted) {
      clearTabPage(tabId, pathname);
      setLoaded((count) => count + 1);
      return;
    }
    let live = true;
    window.sessions
      .get(wanted)
      .then((session) => {
        if (!live) return;
        clearTabPage(tabId, pathname);
        if (session) {
          const state = JSON.parse(session.state) as Record<string, unknown>;
          seedTab(tabId, pathname, { ...state, session: wanted });
          setLoaded((count) => count + 1);
        } else {
          // Removed from History since: the page starts afresh.
          navigate(pathname, { replace: true, state: { replaceEntry: true } });
        }
      })
      .catch((error: unknown) => {
        console.error('[sessions] restore failed:', error);
        if (live) {
          clearTabPage(tabId, pathname);
          navigate(pathname, { replace: true, state: { replaceEntry: true } });
        }
      });
    return () => {
      live = false;
    };
  }, [settled, wanted, tabId, pathname, navigate]);

  return settled;
}

/** Dropped files, by the token the main process saved each under. */
const savedFiles = new WeakMap<File, Promise<SavedFile>>();

/**
 * The page's state as JSON, with each File replaced by a reference the main
 * process keeps (its path never comes to the page).
 */
async function serialize(value: unknown): Promise<unknown> {
  if (value instanceof File) {
    let saved = savedFiles.get(value);
    if (!saved) {
      saved = window.sessions.saveFile(value);
      savedFiles.set(value, saved);
      saved.catch(() => savedFiles.delete(value));
    }
    return saved;
  }
  if (Array.isArray(value)) return Promise.all(value.map(serialize));
  if (value && typeof value === 'object') {
    const entries = await Promise.all(
      Object.entries(value).map(
        async ([key, item]) => [key, await serialize(item)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
  return value;
}

/** Files' previews by token, asked of the main process once each. */
const previews = new Map<string, Promise<FilePreview>>();

function previewOf(token: string) {
  let preview = previews.get(token);
  if (!preview) {
    preview = window.sessions.preview(token);
    previews.set(token, preview);
    preview.catch(() => previews.delete(token));
  }
  return preview;
}

type Small = { url: string; aspect: number } | undefined;

/** Pictures made small, by their source, so each is only drawn once. */
const shrunk = new Map<string, Promise<Small>>();

/**
 * The most a session's picture is kept at, as the main process keeps files'
 * previews (previewBox in src/main/preview.ts): sharp on History's largest
 * card on a 2x screen.
 */
const pictureBox = { width: 640, height: 480 };

/**
 * A picture fitted within pictureBox, as a JPEG data: URL (one already
 * within it, as it is), with its shape. Never made larger.
 */
function shrink(source: string): Promise<Small> {
  let small = shrunk.get(source);
  if (!small) {
    small = (async () => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const { naturalWidth: width, naturalHeight: height } = image;
      const aspect = width / height;
      const scale = Math.min(
        1,
        pictureBox.width / width,
        pictureBox.height / height,
      );
      if (scale === 1 && source.startsWith('data:image/')) {
        return { url: source, aspect };
      }
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d');
      if (context) context.imageSmoothingQuality = 'high';
      context?.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { url: canvas.toDataURL('image/jpeg', 0.85), aspect };
    })().catch(() => undefined);
    if (shrunk.size > 50) shrunk.clear();
    shrunk.set(source, small);
  }
  return small;
}

/** What History shows of a session besides its title. */
async function metaOf(label: NonNullable<SessionLabel>): Promise<SessionMeta> {
  let thumbnail = label.thumbnail ?? undefined;
  let duration = label.duration ?? undefined;
  const file = label.preview;
  if (!thumbnail && file && typeof file !== 'string') {
    try {
      const saved = (
        file instanceof File ? await serialize(file) : file
      ) as SavedFile;
      const preview = await previewOf(saved.token);
      thumbnail = preview.thumbnail ?? undefined;
      duration ??= preview.duration ?? undefined;
    } catch {
      // No picture; History shows the tool's icon instead.
    }
  }
  const small = thumbnail ? await shrink(thumbnail) : undefined;
  return {
    thumbnail: small?.url,
    aspect: label.aspect ?? small?.aspect,
    duration,
    jobs: label.jobs,
    doing: label.doing,
    done: label.done,
    playlist: label.playlist ?? undefined,
  };
}

/**
 * How a session stands, from its runs, the first that applies:
 *
 * - any downloading (or waiting its turn, or retried): running;
 * - else any paused: paused, as it can carry on;
 * - else every one finished: done;
 * - else any cancelled: cancelled, as someone stopped it;
 * - else some finished and the rest failed: partly done;
 * - else failed.
 */
export function statusOf(
  jobs: Record<string, SessionStatus> | undefined,
): SessionState {
  const all = Object.values(jobs ?? {});
  if (all.length === 0) return 'draft';
  if (all.includes('running')) return 'running';
  if (all.includes('paused')) return 'paused';
  if (all.every((s) => s === 'done')) return 'done';
  if (all.includes('cancelled')) return 'cancelled';
  if (all.includes('done')) return 'partial';
  return 'failed';
}

/** How a session stands as a whole: a run's status, or partly done. */
export type SessionState = SessionStatus | 'partial';

export function useSession(
  toolId: string,
  label: () => SessionLabel,
  /** Saved again when this changes: how its runs stand. */
  watch?: string,
) {
  const tabId = useContext(TabContext);
  const { pathname } = useLocation();
  const [id, setId] = useTabState<string | null>('session', null);
  const navigate = useNavigate();
  const latest = useRef({ id, label });
  latest.current = { id, label };
  const timer = useRef<number>(undefined);

  /**
   * Puts session `next` in the page's address, or takes it out, in place of
   * the tab's current entry. The tab's store learns it at once too, so the
   * address and the page agree before the page's own effects run (see
   * useSessionRoute).
   */
  const point = useCallback(
    (next: string | null) => {
      writeTabValue(tabId, pathname, 'session', next);
      pointing.set(`${tabId}${pathname}`, next);
      setId(next);
      navigate(next ? `${pathname}?${sessionParam}=${next}` : pathname, {
        replace: true,
        state: { replaceEntry: true },
      });
    },
    [tabId, pathname, setId, navigate],
  );

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    const { id: sessionId, label: labelOf } = latest.current;
    const shown = sessionId && labelOf();
    if (!sessionId || !shown) return;
    try {
      const state = await serialize(snapshotTab(tabId, pathname));
      await window.sessions.save({
        id: sessionId,
        toolId,
        title: shown.title,
        summary: shown.summary,
        meta: await metaOf(shown),
        state: JSON.stringify(state),
      });
    } catch (error) {
      // History misses this change; the page itself carries on.
      console.error('[sessions] save failed:', error);
    }
  }, [tabId, pathname, toolId]);

  // Saves a moment after the page's state settles, once there is a session.
  useEffect(() => {
    const prefix = `${pathname}:`;
    const off = onTabStateChange((changedTab, slot) => {
      if (changedTab !== tabId || !slot.startsWith(prefix)) return;
      if (!latest.current.id) return;
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => void save(), settle);
    });
    return () => {
      off();
      // Leaving the page (another tab, another tool) saves what is pending.
      if (timer.current !== undefined) void save();
    };
  }, [tabId, pathname, save]);

  // Its runs starting and finishing change how History shows it.
  useEffect(() => {
    if (!latest.current.id || watch === undefined) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), settle);
  }, [watch, save]);

  /** Starts the session, if it hasn't started, and saves it. */
  const record = useCallback(() => {
    if (!latest.current.id) point(crypto.randomUUID());
    // The new id, and the action's own state, are saved once they settle.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void save(), settle);
  }, [point, save]);

  /** Ends the session; the page's next action starts another. */
  const reset = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    if (latest.current.id) point(null);
  }, [point]);

  return { record, reset };
}

// The saved sessions, newest first, for History. Loaded on first use and
// reloaded whenever any tab saves, removes or clears one.
let sessions: SessionSummary[] = [];
let loaded = false;
const listeners = new Set<() => void>();

const load = () =>
  window.sessions.list().then(
    (list) => {
      sessions = list;
      listeners.forEach((listener) => listener());
    },
    (error: unknown) => console.error('[sessions] list failed:', error),
  );

function subscribe(listener: () => void) {
  if (!loaded) {
    loaded = true;
    window.sessions.onChanged(() => void load());
    void load();
  }
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Every saved session, the latest first. */
export const useSessions = () =>
  useSyncExternalStore(subscribe, () => sessions);

/** Opens a saved session, given by AppShell, which owns the tabs. */
export const OpenSessionContext = createContext<(id: string) => void>(() => {});
export const useOpenSession = () => useContext(OpenSessionContext);
