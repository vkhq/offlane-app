import { defineOptions, pageRange, select } from '../../options';

export const options = defineOptions({
  pages: pageRange(),
  saveAs: select('Save As', ['One PDF', 'Separate PDFs']),
});
