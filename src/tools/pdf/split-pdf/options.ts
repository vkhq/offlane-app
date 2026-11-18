import { defineOptions, pageRange, select } from '../../options';

export const options = defineOptions({
  split: select('Split', ['Every Page', 'Every N Pages', 'At Page Ranges']),
  ranges: pageRange('Ranges'),
});
