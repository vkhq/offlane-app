import { defineOptions, select, toggle } from '../../options';

export const options = defineOptions({
  rotate: select('Rotate', ['90° Right', '90° Left', '180°']),
  flipHorizontally: toggle('Flip Horizontally'),
});
