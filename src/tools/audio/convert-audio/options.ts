import { defineOptions, select, shownWhen } from '../../options';

export const options = defineOptions({
  format: select('Format', ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG']),
  // WAV and FLAC are lossless: a bitrate means nothing for them.
  bitrate: shownWhen(
    select(
      'Bitrate',
      ['320 kbps', '256 kbps', '192 kbps', '128 kbps'],
      '192 kbps',
    ),
    'format',
    ['MP3', 'M4A', 'OGG'],
  ),
});
