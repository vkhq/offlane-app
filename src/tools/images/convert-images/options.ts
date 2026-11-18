import { defineOptions, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['JPEG', 'PNG', 'WebP', 'HEIC', 'AVIF', 'TIFF']),
});
