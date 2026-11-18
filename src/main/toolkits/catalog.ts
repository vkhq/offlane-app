// What each toolkit is, and where each build of it is downloaded from, per
// "<os>-<arch>" (the same names as vendor/). Every archive is checked
// against a SHA-256 pinned here, or for a publisher's rolling build against
// the checksum list it publishes beside it, before anything is unpacked.
//
// Three places add releases, the first that answers winning:
//   1. the signed toolkit feed, when the app has one (feed.ts), so toolkits
//      can update without a new release of the app;
//   2. ./published.ts, written by `npm run publish-toolkits` for builds this
//      project hosts itself (the LGPL FFmpeg for macOS, which no one else
//      publishes);
//   3. the upstream builds pinned below.
//
// To move to a newer upstream build: download the archives, run them, and
// update url, sha256, size and version.
//
// No Electron import.
import { type ToolkitId, toolkitNames } from '../../shared/toolkits';
import { published } from './published';

export type ToolkitArchive = {
  url: string;
  /** A hash pinned here, or the publisher's checksum list and the file's
   *  name in it, for a rolling build. */
  sha256: string | { checksumsUrl: string; name: string };
  /** Bytes, for progress and the size shown before downloading. */
  size: number;
  /** The folder inside the toolkit its contents go to; the top by default. */
  into?: string;
  /**
   * Keep only these files, each found by name anywhere in the archive and
   * put in `into` (as `as`, if given). Without it the whole archive is kept
   * as it is laid out.
   */
  pick?: { name: string; as?: string; optional?: boolean }[];
  /** Renames inside `into` once unpacked, such as "yt-dlp_macos" to "yt-dlp". */
  rename?: Record<string, string>;
};

/** A program run after unpacking, which must start and answer as expected. */
export type ToolkitCheck = {
  /** One of the release's `binaries`. */
  binary: string;
  args: string[];
  /** Its output must match this (a regular expression). */
  expect?: string;
  /** Its output must not match this. */
  forbid?: string;
  /** What to say when `expect` or `forbid` fails. */
  message?: string;
};

export type ToolkitRelease = {
  version: string;
  /** Where it comes from, as the UI names it. */
  host: string;
  archives: ToolkitArchive[];
  /** Each program the toolkit provides, by name, as a path inside it. */
  binaries: Record<string, string>;
  checks: ToolkitCheck[];
};

export type ToolkitVariant = {
  id: string;
  name: string;
  note: string;
  /** Installed when no variant is asked for. */
  default?: boolean;
  /** Shown before installing, for a licence that asks to be. */
  license?: { name: string; url: string };
  /** The releases for each target, tried in order. */
  targets: Partial<Record<string, ToolkitRelease[]>>;
};

export type ToolkitDefinition = {
  id: ToolkitId;
  name: string;
  description: string;
  contents: string[];
  /** The programs every variant provides, for `ToolkitStore.binary`. */
  binaries: string[];
  /** Empty while its contents are still being chosen. */
  variants: ToolkitVariant[];
};

/** This computer's target, named as in vendor/: "mac-arm64". */
export function currentTarget(
  platform: string = process.platform,
  arch: string = process.arch,
) {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform];
  return `${os ?? platform}-${arch}`;
}

const gh = (repo: string, tag: string, asset: string) =>
  `https://github.com/${repo}/releases/download/${tag}/${asset}`;

// --- Media: FFmpeg and FFprobe -------------------------------------------

const ffmpegBinaries = (windows: boolean) => ({
  ffmpeg: windows ? 'ffmpeg.exe' : 'ffmpeg',
  ffprobe: windows ? 'ffprobe.exe' : 'ffprobe',
});

/** The LGPL build must never turn out to be GPL or non-free, and the GPL
 *  build must really be the GPL one. */
const ffmpegChecks = (variant: 'lgpl' | 'gpl'): ToolkitCheck[] => [
  {
    binary: 'ffmpeg',
    args: ['-hide_banner', '-buildconf'],
    ...(variant === 'gpl'
      ? {
          expect: '--enable-gpl',
          message: 'The downloaded FFmpeg isn’t the full (GPL) build.',
        }
      : {
          forbid: '--enable-(gpl|nonfree)\\b',
          message: 'The downloaded FFmpeg isn’t the standard (LGPL) build.',
        }),
  },
  { binary: 'ffprobe', args: ['-version'], expect: '^ffprobe version' },
];

/**
 * BtbN's rolling 9.0 build, checked against the checksum list in the same
 * release. BtbN deletes dated releases after a few weeks, so a pinned one
 * would soon stop answering.
 */
function btbn(
  platform: string,
  license: 'lgpl' | 'gpl',
  ext: 'zip' | 'tar.xz',
  size: number,
): ToolkitRelease[] {
  const name = `ffmpeg-n9.0-latest-${platform}-${license}-9.0.${ext}`;
  const windows = platform.startsWith('win');
  return [
    {
      version: '9.0',
      host: 'github.com/BtbN/FFmpeg-Builds',
      archives: [
        {
          url: gh('BtbN/FFmpeg-Builds', 'latest', name),
          sha256: {
            checksumsUrl: gh(
              'BtbN/FFmpeg-Builds',
              'latest',
              'checksums.sha256',
            ),
            name,
          },
          size,
          pick: [
            ...Object.values(ffmpegBinaries(windows)).map((file) => ({
              name: file,
            })),
            // The licence travels with the binaries.
            {
              name: 'LICENSE.txt',
              as: `licenses/FFmpeg-LICENSE.txt`,
              optional: true,
            },
          ],
        },
      ],
      binaries: ffmpegBinaries(windows),
      checks: ffmpegChecks(license),
    },
  ];
}

/** A Mac GPL build published as one zip per program. */
const macGpl = (
  host: string,
  version: string,
  [ffmpeg, ffprobe]: [string, string][],
  size: number,
): ToolkitRelease[] => [
  {
    version,
    host,
    archives: [ffmpeg, ffprobe].map(([url, sha256], index) => ({
      url,
      sha256,
      // Split evenly; only the total is shown.
      size: Math.round(size / 2) - index,
      pick: [{ name: index === 0 ? 'ffmpeg' : 'ffprobe' }],
    })),
    binaries: ffmpegBinaries(false),
    checks: ffmpegChecks('gpl'),
  },
];

const definitions: ToolkitDefinition[] = [
  {
    id: 'media',
    name: toolkitNames.media,
    description: 'Converts, compresses, trims and plays video and audio.',
    contents: ['FFmpeg', 'FFprobe'],
    binaries: ['ffmpeg', 'ffprobe'],
    variants: [
      {
        id: 'lgpl',
        name: 'Standard',
        note: 'Every common format, with the computer’s own H.264 encoder.',
        default: true,
        targets: {
          // macOS has no published LGPL build; this project builds and
          // hosts one (see ./published.ts).
          'win-x64': btbn('win64', 'lgpl', 'zip', 168_580_553),
          'win-arm64': btbn('winarm64', 'lgpl', 'zip', 117_201_523),
          'linux-x64': btbn('linux64', 'lgpl', 'tar.xz', 135_636_204),
          'linux-arm64': btbn('linuxarm64', 'lgpl', 'tar.xz', 116_413_768),
        },
      },
      {
        id: 'gpl',
        name: 'All Codecs',
        note: 'Adds x264 and x265 for H.264 and H.265 encoding.',
        license: {
          name: 'GNU GPL',
          url: 'https://www.gnu.org/licenses/gpl-3.0.html',
        },
        targets: {
          'win-x64': btbn('win64', 'gpl', 'zip', 194_988_536),
          'win-arm64': btbn('winarm64', 'gpl', 'zip', 136_234_279),
          'linux-x64': btbn('linux64', 'gpl', 'tar.xz', 152_717_604),
          'linux-arm64': btbn('linuxarm64', 'gpl', 'tar.xz', 128_424_448),
          // No one publishes both macOS architectures from one place. These
          // links are not versioned, so an update there fails the hash check
          // until the hash here is updated.
          'mac-arm64': macGpl(
            'osxexperts.net',
            '9.0',
            [
              [
                'https://www.osxexperts.net/ffmpeg9arm.zip',
                'd0c06c5c68ce48af3143b262f7a9118a7c9f67de1e237fcc24ffb14df9c67af9',
              ],
              [
                'https://www.osxexperts.net/ffprobe9arm.zip',
                '0c94fbdd8917022f28115eca512196cf4648732bc9e5db9ec8896c7e519d02aa',
              ],
            ],
            45_138_370,
          ),
          'mac-x64': macGpl(
            'evermeet.cx',
            '9.0.2',
            [
              [
                'https://evermeet.cx/ffmpeg/ffmpeg-9.0.2.zip',
                '4acc0be580f9b2788029eb7bd4d645ff87968911b0a62aeeb3940d42d54558d5',
              ],
              [
                'https://evermeet.cx/ffmpeg/ffprobe-9.0.2.zip',
                '24a9c968cd4da72d99c7245e914b921815835eb6dff01d99868031aebaf1d439',
              ],
            ],
            52_302_518,
          ),
        },
      },
    ],
  },
  // Still to be chosen; listed so Settings can say they are coming.
  {
    id: 'pdf',
    name: toolkitNames.pdf,
    description: 'Merges, splits, compresses and protects PDFs.',
    contents: [],
    binaries: [],
    variants: [],
  },
  {
    id: 'ocr',
    name: toolkitNames.ocr,
    description: 'Reads the text in pictures and scanned PDFs.',
    contents: [],
    binaries: [],
    variants: [],
  },
  {
    id: 'ai',
    name: toolkitNames.ai,
    description: 'Transcribes speech and removes picture backgrounds.',
    contents: [],
    binaries: [],
    variants: [],
  },
];

/** Releases from elsewhere, by toolkit, variant and target. */
export type ReleaseOverlay = Partial<
  Record<ToolkitId, Record<string, Record<string, ToolkitRelease>>>
>;

/**
 * Every toolkit with the releases of `overlays` (in order of preference)
 * put first, ahead of those pinned above.
 */
export function buildCatalog(
  overlays: ReleaseOverlay[] = [published],
): ToolkitDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    variants: definition.variants.map((variant) => {
      const targets: Partial<Record<string, ToolkitRelease[]>> = {};
      const names = new Set([
        ...Object.keys(variant.targets),
        ...overlays.flatMap((overlay) =>
          Object.keys(overlay[definition.id]?.[variant.id] ?? {}),
        ),
      ]);
      for (const target of names) {
        targets[target] = [
          ...overlays.flatMap((overlay) => {
            const release = overlay[definition.id]?.[variant.id]?.[target];
            return release ? [release] : [];
          }),
          ...(variant.targets[target] ?? []),
        ];
      }
      return { ...variant, targets };
    }),
  }));
}
