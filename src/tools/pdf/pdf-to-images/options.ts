import { defineOptions, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['PNG', 'JPEG', 'WebP']),
  resolution: select('Resolution', ['72 dpi', '150 dpi', '300 dpi'], '150 dpi'),
});
