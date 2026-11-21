// Language codes as people read them, for the audio and subtitle tracks of
// a download and of the player. Sites give codes like "es" or "en-US";
// MP4 files store three letters ("spa", "eng"). No Electron import.

const names = new Intl.DisplayNames(['en'], { type: 'language' });

/** A code in its standard form ("spa" → "es"), or null for none or
 *  "und" (undetermined), or a code that isn't one. */
export function canonicalLanguage(code: string | null | undefined) {
  if (!code || code === 'und') return null;
  try {
    return Intl.getCanonicalLocales(code)[0] ?? null;
  } catch {
    return null;
  }
}

/** "es" → "Spanish", "en-US" → "American English"; the code itself when it
 *  has no name. */
export function languageName(code: string) {
  const canonical = canonicalLanguage(code);
  if (!canonical) return code;
  try {
    return names.of(canonical) ?? code;
  } catch {
    return code;
  }
}

/** Whether two codes name the same language, however written ("spa" and
 *  "es", "en-US" and "en"): by the language itself, not its region. */
export function sameLanguage(
  a: string | null | undefined,
  b: string | null | undefined,
) {
  const [x, y] = [canonicalLanguage(a), canonicalLanguage(b)];
  return !!x && !!y && x.split('-')[0] === y.split('-')[0];
}

/** A code as the downloader may be given it: letters, digits and hyphens
 *  only, as every language code is. */
export const isLanguageCode = (value: unknown): value is string =>
  typeof value === 'string' && /^[A-Za-z0-9-]{1,35}$/.test(value);
