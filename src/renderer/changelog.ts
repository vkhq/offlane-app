/** What changed in each release, newest first, shown in Settings. */
export type Release = { version: string; date: string; changes: string[] };

export const changelog: Release[] = [
  {
    version: '1.0.0',
    date: '2026-10-22',
    changes: [
      'Download Video saves videos and audio from YouTube and about 1800 other sites.',
      'Downloads show progress, and can be paused, resumed, retried and canceled.',
      'Install the full FFmpeg from Settings to get every codec, including x264 and x265.',
      'New Settings page; open it any time with ⌘, (Ctrl+, on Windows and Linux).',
    ],
  },
];
