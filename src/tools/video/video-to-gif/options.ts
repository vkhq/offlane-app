import { defineOptions, select, timeRange, toggle } from '../../options';

export const options = defineOptions({
  // Start and End, in seconds, set on the editor's timeline.
  ...timeRange(),
  width: select('Width', ['960 px', '640 px', '480 px', '320 px'], '640 px'),
  frameRate: select(
    'Frame Rate',
    ['30 fps', '24 fps', '15 fps', '10 fps'],
    '15 fps',
  ),
  // On, it plays over and over; off, once, stopping on its last frame.
  loop: toggle('Loop', true),
});
