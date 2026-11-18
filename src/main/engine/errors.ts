// Maps yt-dlp's error text to categories the UI can act on. yt-dlp has no
// error codes, only stderr lines such as
//   ERROR: [youtube] dQw4w9WgXcQ: Sign in to confirm your age.
// Rules go from most to least specific and the first match wins. They are
// loose, case-insensitive fragments, because exact wording changes between
// yt-dlp versions and differs per site.
import type { ErrorAction, ErrorCategory, JobError } from '../../shared/types';
import { ToolkitMissingError } from '../toolkits/store';
import { ExternalToolError } from './external';

type Rule = {
  category: ErrorCategory;
  pattern: RegExp;
  /** A fixed sentence, or one built from yt-dlp's own reason (see reason). */
  message: string | ((reason: string) => string);
  action: ErrorAction;
  retryable: boolean;
};

const rules: Rule[] = [
  {
    category: 'drm',
    pattern: /\bDRM\b/i,
    message: 'This content is copy-protected (DRM) and can’t be downloaded.',
    action: 'none',
    retryable: false,
  },
  {
    category: 'bot_check',
    pattern: /confirm you.?re not a bot|captcha|unusual traffic/i,
    message: 'The site is asking to verify you’re human. Try again later.',
    action: 'retry_later',
    retryable: false,
  },
  {
    // Reading Safari's cookies needs Full Disk Access, which macOS asks
    // for in System Settings, not in a prompt.
    category: 'browser_blocked',
    pattern: /binarycookies|com\.apple\.Safari/i,
    message:
      'macOS didn’t let the app read Safari’s sign-ins. Allow Full Disk Access for this app in System Settings › Privacy & Security, or choose another browser.',
    action: 'use_browser_cookies',
    retryable: false,
  },
  {
    // The chosen browser's sign-ins couldn't be read: no such profile, a
    // locked database, or its key refused in the Keychain.
    category: 'browser_cookies',
    pattern:
      /cookies? database|Cookies\.sqlite|could not find .*cookies|failed to (decrypt|load|read) .*cookies|extract(ing)? cookies|keyring|Safe Storage/i,
    message:
      'The app couldn’t read sign-ins from that browser. Make sure you’ve opened it and signed in, or choose another browser.',
    action: 'use_browser_cookies',
    retryable: false,
  },
  {
    // \b keeps "log in" from matching inside "blog in".
    category: 'auth_required',
    pattern:
      /sign in to confirm your age|\blog ?in\b|requires authentication|private video|members[- ]only|join this channel|subscriber|premium|account cookies|use --cookies|--username/i,
    message: 'This content needs you to be signed in to the site.',
    // The page offers to use the sign-in from the person's browser.
    action: 'use_browser_cookies',
    retryable: false,
  },
  {
    category: 'geo_blocked',
    pattern:
      /not available in your (country|region|location)|geo.?restrict|blocked (it )?in your country/i,
    message:
      'This content isn’t available in your region. A proxy in another region may help.',
    action: 'set_proxy',
    retryable: false,
  },
  {
    category: 'rate_limited',
    pattern: /HTTP Error 429|Too Many Requests|rate.?limit/i,
    message:
      'The site is limiting requests. The download will be retried shortly.',
    action: 'retry_later',
    retryable: true,
  },
  {
    category: 'unsupported_url',
    pattern: /Unsupported URL/i,
    message: 'No downloadable media was found at this link.',
    action: 'none',
    retryable: false,
  },
  {
    category: 'format_unavailable',
    pattern: /Requested format is not available/i,
    message:
      'The selected quality isn’t available for this item. Try another quality.',
    action: 'none',
    retryable: false,
  },
  {
    category: 'unavailable',
    pattern:
      /video unavailable|has been removed|no longer available|does not exist|HTTP Error 404|HTTP Error 410|content.*(deleted|removed)|is not available/i,
    message:
      'This item is unavailable. It may have been removed or made private.',
    action: 'none',
    retryable: false,
  },
  {
    category: 'disk_full',
    pattern: /No space left on device|Errno 28|disk full/i,
    message:
      'Your disk is full. Free up space or choose another download folder.',
    action: 'choose_folder',
    retryable: false,
  },
  {
    category: 'permission',
    pattern:
      /Permission denied|Errno 13|Access is denied|Operation not permitted|Read-only file system/i,
    message:
      'The app can’t write to the download folder. Choose a different folder.',
    action: 'choose_folder',
    retryable: false,
  },
  {
    // The bundled LGPL build leaves out GPL encoders such as libx264.
    category: 'missing_codec',
    pattern:
      /Unknown encoder|Encoder not found|Unknown decoder|Decoder not found|codec not currently supported in container|Requested output format .* is not (a suitable|known)/i,
    message:
      'This needs a codec the standard FFmpeg doesn’t include. Install the full FFmpeg in Settings.',
    action: 'install_full_ffmpeg',
    retryable: false,
  },
  {
    category: 'postprocess',
    pattern:
      /Postprocessing:|ffmpeg (is )?not (found|installed)|ffprobe.*not found|Conversion failed/i,
    message: (reason) =>
      `The download finished but converting or merging the file failed: ${reason}`,
    action: 'none',
    retryable: false,
  },
  {
    // A site changed its pages; the fix is a newer yt-dlp in an app update.
    category: 'extractor_broken',
    pattern:
      /Unable to extract|Unable to parse|Failed to parse JSON|nsig extraction failed|Signature extraction failed|please report this issue|This may be a bug|confirm you are on the latest version|KeyError|IndexError|TypeError/i,
    message:
      'This site changed recently and the download engine needs an app update.',
    action: 'none',
    retryable: false,
  },
  {
    category: 'network',
    pattern:
      /Unable to download (webpage|API page)|Failed to resolve|nodename nor servname|timed out|Connection (reset|refused|aborted)|Network is unreachable|getaddrinfo|Name or service not known|Temporary failure in name resolution|SSL|EOF occurred|IncompleteRead|HTTP Error 5\d\d/i,
    // The cause itself ("The read operation timed out."), which says more
    // than "network problem" would.
    message: (reason) => reason,
    action: 'retry_later',
    retryable: true,
  },
];

/** The last "ERROR:" line, else the last line. */
export function pickErrorLine(stderrTail: string[]): string {
  for (let i = stderrTail.length - 1; i >= 0; i--) {
    if (stderrTail[i].startsWith('ERROR:')) return stderrTail[i];
  }
  return stderrTail.at(-1) ?? 'yt-dlp exited without an error message';
}

/**
 * Common causes, said plainly: what the user sees in place of yt-dlp's own
 * words, which name sockets, hosts and Python exceptions. First match wins.
 */
const plainCauses: [RegExp, (match: RegExpExecArray) => string][] = [
  [
    /Failed to resolve '([^']+)'|getaddrinfo|nodename nor servname|Name or service not known|Temporary failure in name resolution/i,
    (match) =>
      `Couldn’t reach ${siteName(match[1])}. Check your internet connection.`,
  ],
  [
    /Network is unreachable|No route to host/i,
    () => 'You seem to be offline. Check your internet connection.',
  ],
  [/timed? ?out/i, () => 'The site took too long to respond.'],
  [
    /Connection (reset|refused|aborted)|Remote end closed|IncompleteRead|EOF occurred/i,
    () => 'The connection to the site dropped.',
  ],
  [
    /CERTIFICATE|SSL/i,
    () => 'A secure connection to the site couldn’t be made.',
  ],
  [/HTTP Error 5\d\d/i, () => 'The site is having problems. Try again later.'],
  [/HTTP Error 403/i, () => 'The site refused the request.'],
];

/** "www.youtube.com" as "youtube.com"; "the site" when none is known. */
function siteName(host: string | undefined): string {
  return host ? host.replace(/^www\./, '') : 'the site';
}

/** Past this, a reason is cut at a word, so it fits on a line or two. */
const maxReason = 100;

/**
 * yt-dlp's error line as a short sentence for the UI. A common cause is
 * said plainly (see plainCauses); anything else is yt-dlp's own words
 * without their plumbing, cut short when long:
 *   ERROR: [download] Got error: The read operation timed out
 *     -> The site took too long to respond.
 *   ERROR: [youtube] x: Unable to download API page: HTTPSConnection(host=
 *   'www.youtube.com', port=443): Failed to resolve 'www.youtube.com' (…)
 *     -> Couldn’t reach youtube.com. Check your internet connection.
 *   ERROR: [vimeo] 123: something odd happened
 *     -> Something odd happened.
 */
export function reason(line: string): string {
  for (const [pattern, say] of plainCauses) {
    const match = pattern.exec(line);
    if (match) return say(match);
  }
  let text = line
    .replace(/^(ERROR|WARNING):\s*/, '')
    // "[extractor] video-id: ", or just "[extractor] ".
    .replace(/^\[[^\]]+\]\s*(?:[\w-]+:\s+)?/, '')
    .replace(/^Got error:\s*/i, '')
    .replace(/\s*\(caused by [\s\S]*$/i, '')
    .replace(/;?\s*please report this issue[\s\S]*$/i, '')
    .replace(/<urlopen error ([^>]*)>/g, '$1')
    .replace(/\[Errno -?\d+\]\s*/g, '')
    // Python's own names, as in "HTTPSConnection(host='…', port=443): ".
    .replace(/\b\w+\([^)]*\):?\s*/g, '')
    .replace(/\s*\([^)]*\)/g, '')
    .trim();
  if (!text) return 'Something went wrong. Try again.';
  if (text.length > maxReason) {
    text = `${text
      .slice(0, maxReason)
      .replace(/\s+\S*$/, '')
      .replace(/[,:;]$/, '')}…`;
  }
  text = text[0].toUpperCase() + text.slice(1);
  return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function classifyError(stderrTail: string[]): JobError {
  const raw = pickErrorLine(stderrTail);
  // The chosen line first; failing that, the whole tail, since the useful
  // hint is sometimes in a WARNING line just before.
  for (const text of [raw, stderrTail.join('\n')]) {
    for (const rule of rules) {
      if (rule.pattern.test(text)) {
        const { category, message, action, retryable } = rule;
        return {
          category,
          message: typeof message === 'string' ? message : message(reason(raw)),
          raw,
          action,
          retryable,
        };
      }
    }
  }
  return {
    category: 'unknown',
    message: reason(raw),
    raw,
    action: 'none',
    retryable: false,
  };
}

/** A job that needs a toolkit that isn't installed. */
export function toolkitMissingError(error: ToolkitMissingError): JobError {
  return {
    category: 'toolkit_missing',
    message: error.message,
    raw: error.message,
    action: 'install_toolkit',
    retryable: false,
    toolkit: error.toolkit,
  };
}

/** For failures to even start the process. */
export function engineStartError(error: unknown): JobError {
  if (error instanceof ToolkitMissingError) return toolkitMissingError(error);
  if (error instanceof ExternalToolError) {
    return {
      category: 'engine_missing',
      message: error.message,
      raw: error.message,
      action: 'none',
      retryable: false,
    };
  }
  return {
    category: 'engine_missing',
    message:
      'yt-dlp couldn’t start. Check it in Settings › Toolkits, or reinstall it.',
    raw: error instanceof Error ? error.message : String(error),
    action: 'none',
    retryable: false,
  };
}
