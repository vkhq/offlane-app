import { defineOptions, select, shownWhen } from '../../options';

export const options = defineOptions({
  // ALAC is Apple Lossless, in an .m4a file as M4A is.
  format: select('Format', [
    'MP3',
    'M4A',
    'WAV',
    'FLAC',
    'OGG',
    'Opus',
    'AIFF',
    'ALAC',
  ]),
  // WAV, FLAC, AIFF and ALAC are lossless: a bitrate means nothing for them.
  // Same as File keeps the file's own, within 64–320 kbps.
  bitrate: shownWhen(
    select(
      'Bitrate',
      ['Same as File', '320 kbps', '256 kbps', '192 kbps', '128 kbps'],
      '192 kbps',
    ),
    'format',
    ['MP3', 'M4A', 'OGG', 'Opus'],
  ),
});
