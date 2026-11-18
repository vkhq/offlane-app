import { defineOptions, info, quality } from '../../options';

export const options = defineOptions({
  format: info('Format', 'MP4 · H.264'),
  quality: quality(),
});
