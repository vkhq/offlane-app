import { defineOptions, info, quality } from '../../options';

export const options = defineOptions({
  format: info('Format', 'Same as original'),
  quality: quality(),
});
