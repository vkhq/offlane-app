import { defineOptions, file, select } from '../../options';

export const options = defineOptions({
  signature: file('Signature', 'image/*'),
  page: select('Page', ['Last', 'First', 'All']),
  position: select('Position', [
    'Bottom Right',
    'Bottom Left',
    'Bottom Center',
  ]),
});
