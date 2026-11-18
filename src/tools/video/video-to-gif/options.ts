import { defineOptions, number, select } from '../../options';

export const options = defineOptions({
  start: number('Start', 0, 's'),
  end: number('End', 10, 's'),
  width: select('Width', ['960 px', '640 px', '480 px', '320 px'], '640 px'),
  frameRate: select(
    'Frame Rate',
    ['30 fps', '24 fps', '15 fps', '10 fps'],
    '15 fps',
  ),
});
