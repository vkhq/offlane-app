// Download settings, with defaults and validation. Settings flow into yt-dlp
// arguments (proxy, rate limit), so every value is checked here; the
// renderer can propose changes but never write an unchecked value.
import type { Settings } from '../../shared/types';
import { validateProxy, validateRateLimit } from '../engine/args';
import { isBrowser } from '../engine/browsers';
import { JsonFile } from './json-file';

export function defaultSettings(downloadDir: string): Settings {
  return {
    downloadDir,
    maxConcurrent: 3,
    perSiteLimit: 2,
    fragmentConcurrency: 4,
    proxy: '',
    rateLimit: '',
    preferCompatible: true,
    embedMetadata: true,
    cookiesBrowser: '',
    toolkitsOnboarded: false,
  };
}

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === 'number' && Number.isInteger(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;

/** Applies a partial update; throws a friendly message on bad input. */
export function mergeSettings(
  current: Settings,
  patch: Partial<Settings>,
): Settings {
  const next = { ...current };
  if (patch.downloadDir !== undefined) {
    if (typeof patch.downloadDir !== 'string' || !patch.downloadDir) {
      throw new Error('Invalid folder');
    }
    next.downloadDir = patch.downloadDir;
  }
  if (patch.maxConcurrent !== undefined) {
    next.maxConcurrent = clampInt(
      patch.maxConcurrent,
      1,
      8,
      current.maxConcurrent,
    );
  }
  if (patch.perSiteLimit !== undefined) {
    next.perSiteLimit = clampInt(
      patch.perSiteLimit,
      1,
      8,
      current.perSiteLimit,
    );
  }
  if (patch.fragmentConcurrency !== undefined) {
    next.fragmentConcurrency = clampInt(
      patch.fragmentConcurrency,
      1,
      16,
      current.fragmentConcurrency,
    );
  }
  if (patch.proxy !== undefined) {
    next.proxy = validateProxy(String(patch.proxy).trim());
  }
  if (patch.rateLimit !== undefined) {
    next.rateLimit = validateRateLimit(String(patch.rateLimit).trim());
  }
  if (patch.preferCompatible !== undefined) {
    next.preferCompatible = patch.preferCompatible === true;
  }
  if (patch.embedMetadata !== undefined) {
    next.embedMetadata = patch.embedMetadata === true;
  }
  if (patch.cookiesBrowser !== undefined) {
    // It becomes a yt-dlp argument, so only a known browser's name.
    const browser = String(patch.cookiesBrowser);
    if (browser && !isBrowser(browser)) throw new Error('Unknown browser');
    next.cookiesBrowser = browser;
  }
  if (patch.toolkitsOnboarded !== undefined) {
    next.toolkitsOnboarded = patch.toolkitsOnboarded === true;
  }
  return next;
}

export class SettingsStore {
  private file: JsonFile<Partial<Settings>>;
  private current: Settings;

  constructor(
    filePath: string,
    private readonly defaultDownloadDir: string,
  ) {
    this.file = new JsonFile(filePath, 200);
    const defaults = defaultSettings(defaultDownloadDir);
    // Saved values go through the validator too, so a hand-edited file
    // can't slip in bad values.
    try {
      this.current = mergeSettings(defaults, this.file.read({}));
    } catch {
      this.current = defaults;
    }
  }

  get(): Settings {
    return { ...this.current };
  }

  update(patch: Partial<Settings>): Settings {
    this.current = mergeSettings(this.current, patch);
    this.file.write(this.current);
    return this.get();
  }

  /** Puts every setting back to its default, and saves that. */
  reset(): Settings {
    this.current = defaultSettings(this.defaultDownloadDir);
    this.file.write(this.current);
    this.file.flush();
    return this.get();
  }

  flush(): void {
    this.file.flush();
  }
}
