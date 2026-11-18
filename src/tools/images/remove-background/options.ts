import { defineOptions, info, select } from '../../options';

export const options = defineOptions({
  background: select('Background', ['Transparent', 'White', 'Black']),
  format: info('Format', 'PNG'),
});
