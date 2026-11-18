import { defineOptions, select, toggle } from '../../options';

export const options = defineOptions({
  aspect: select('Aspect', ['Original', '16:9', '9:16', '4:3', '1:1']),
  rotate: select('Rotate', ['None', '90° Right', '90° Left', '180°']),
  flipHorizontally: toggle('Flip Horizontally'),
});
