import { defineOptions, select } from '../../options';

export const options = defineOptions({
  pageSize: select('Page Size', ['Fit Image', 'A4', 'Letter']),
  orientation: select('Orientation', ['Automatic', 'Portrait', 'Landscape']),
  margins: select('Margins', ['None', 'Small', 'Large']),
});
