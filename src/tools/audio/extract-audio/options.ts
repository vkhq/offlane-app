import { defineOptions, info, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['MP3', 'M4A', 'WAV', 'FLAC', 'OGG']),
  quality: info('Quality', 'Original'),
});
