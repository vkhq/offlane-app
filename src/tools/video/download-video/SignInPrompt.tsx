import { useEffect, useState } from 'react';

import type { BrowserChoice } from '../../../shared/types';
import { Check, LoaderCircle, Lock } from '../../ui';

/** What a failed lookup or download said, when it asks for a sign-in. */
export type SignInNeed = {
  /** The link's site, such as instagram.com. */
  site: string;
  /** auth_required: the site wants a sign-in; browser_cookies: the chosen
   *  browser's sign-ins couldn't be read; browser_blocked: macOS keeps the
   *  app out of them until it has Full Disk Access. */
  category: string;
  message: string;
};

/** Whether an error from a lookup or download asks for a browser sign-in. */
export function signInNeed(error: unknown, url: string): SignInNeed | null {
  const { action, category, message } = (error ?? {}) as {
    action?: string;
    category?: string;
    message?: string;
  };
  if (action !== 'use_browser_cookies') return null;
  return {
    site: siteOf(url),
    category: category ?? 'auth_required',
    message: message ?? '',
  };
}

/** "https://www.instagram.com/p/…" as "instagram.com". */
export function siteOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'this site';
  }
}

/**
 * Asks to use the sign-in from a browser the person is already signed in
 * to, when a site shows a video only to signed-in people: why it's needed,
 * a choice of the browsers installed, and Allow & Retry, which saves the
 * choice (see Settings › Preferences) and tries again. Shown again, with
 * what went wrong, if the site still asks, or the browser's sign-ins
 * couldn't be read.
 */
export function SignInPrompt({
  need,
  onRetry,
}: {
  need: SignInNeed;
  /** Tries the lookup or download again, now with the browser's sign-in. */
  onRetry: () => Promise<void> | void;
}) {
  const [browsers, setBrowsers] = useState<BrowserChoice[] | null>(null);
  const [current, setCurrent] = useState('');
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void Promise.all([
      window.downloader.browsers(),
      window.downloader.getSettings(),
    ]).then(([list, settings]) => {
      if (!live) return;
      setBrowsers(list);
      setCurrent(settings.cookiesBrowser);
      // The browser already in use, if any, else the first one.
      setChosen(settings.cookiesBrowser || list[0]?.id || '');
    });
    return () => {
      live = false;
    };
  }, []);

  const nameOf = (id: string) =>
    browsers?.find((browser) => browser.id === id)?.name ?? id;

  const allow = async () => {
    if (!chosen) return;
    setBusy(true);
    setError('');
    try {
      await window.downloader.updateSettings({ cookiesBrowser: chosen });
      setCurrent(chosen);
      await onRetry();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  // Already signing in through a browser: the site still asks, or that
  // browser's sign-ins couldn't be read.
  const again = current !== '';
  const blocked = need.category === 'browser_blocked';
  const title = blocked
    ? `macOS is blocking access to ${nameOf(current)}`
    : need.category === 'browser_cookies'
      ? `Couldn’t use ${nameOf(current)}’s sign-in`
      : again
        ? `${need.site} still asks you to sign in`
        : `Sign in to ${need.site} through your browser`;
  const explanation =
    blocked || need.category === 'browser_cookies'
      ? need.message
      : again
        ? `Make sure you’re signed in to ${need.site} in ${nameOf(current)}, or pick the browser where you are.`
        : `${need.site} only shows this to people who are signed in. Pick the browser where you’re signed in to ${need.site}, and the app will download it with that sign-in.`;

  return (
    <div
      role="group"
      aria-label="Sign in through your browser"
      className="flex flex-col gap-3 rounded-2xl bg-canvas p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-group text-ink-soft">
          <Lock size={17} />
        </span>
        <div className="min-w-0 pt-0.5">
          <p className="text-[14px] font-semibold">{title}</p>
          <p className="pt-1 text-[13px] leading-snug text-ink-soft">
            {explanation}
          </p>
        </div>
      </div>

      {browsers === null ? (
        <LoaderCircle size={16} className="ml-12 animate-spin text-ink-faint" />
      ) : browsers.length === 0 ? (
        <p className="pl-12 text-[13px] text-ink-soft">
          No browser the app can use sign-ins from was found.
        </p>
      ) : (
        <div className="flex flex-col gap-3 pl-12">
          <div
            role="radiogroup"
            aria-label="Browser you’re signed in to"
            className="flex flex-wrap gap-1.5"
          >
            {browsers.map((browser) => (
              <button
                key={browser.id}
                type="button"
                role="radio"
                aria-checked={chosen === browser.id}
                onClick={() => setChosen(browser.id)}
                className={`inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold ${
                  chosen === browser.id
                    ? 'bg-ink text-canvas'
                    : 'bg-well text-ink hover:bg-field'
                }`}
              >
                {chosen === browser.id && <Check size={13} />}
                {browser.name}
              </button>
            ))}
          </div>
          {/* Why, and what to expect from the Mac. */}
          <p className="text-[12px] leading-snug text-ink-faint">
            {chosen === 'safari'
              ? 'Safari keeps its sign-ins private: the app needs Full Disk Access (System Settings › Privacy & Security) to use them. '
              : 'Your Mac may ask you to allow access to the browser’s saved sign-ins. '}
            The app reads only that browser’s cookies, when downloading, and
            never sees your passwords. You can turn this off in Settings.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {blocked && (
              <button
                type="button"
                onClick={() => void window.downloader.openPrivacySettings()}
                className="inline-flex h-8 cursor-pointer items-center rounded-full bg-well px-3.5 text-[13px] font-semibold text-ink hover:bg-field"
              >
                Open Privacy Settings
              </button>
            )}
            <button
              type="button"
              disabled={!chosen || busy}
              onClick={() => void allow()}
              className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-ink px-3.5 text-[13px] font-semibold text-canvas hover:opacity-90 disabled:cursor-default disabled:opacity-50"
            >
              {busy && <LoaderCircle size={13} className="animate-spin" />}
              {blocked && chosen === current ? 'Retry' : 'Allow & Retry'}
            </button>
            {error && <p className="text-[12px] text-brand">{error}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
