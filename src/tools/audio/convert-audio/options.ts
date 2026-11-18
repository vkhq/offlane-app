import { defineOptions, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG']),
  bitrate: select(
    'Bitrate',
    ['320 kbps', '256 kbps', '192 kbps', '128 kbps'],
    '192 kbps',
  ),
});
