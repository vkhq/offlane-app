import { defineOptions, info, select } from '../../options';

export const options = defineOptions({
  order: info('Order', 'Drag to reorder'),
  rotate: select('Rotate', ['None', '90° Right', '90° Left', '180°']),
});
