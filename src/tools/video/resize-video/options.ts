import { defineOptions, number, select, shownWhen } from '../../options';

/** The sizes offered, as width × height. A video is fitted inside the one
 *  chosen, keeping its shape (see `fitInside`). */
export const presets = [
  '3840 × 2160',
  '2560 × 1440',
  '1920 × 1080',
  '1280 × 720',
  '854 × 480',
  '640 × 360',
];

export const options = defineOptions({
  size: select('Size', [...presets, 'Custom'], '1920 × 1080'),
  // Custom's size, in the video's shape: the editor fills in one side
  // from the other, and sets both when the frame is dragged.
  width: shownWhen(number('Width', 1920, 'px'), 'size', ['Custom']),
  height: shownWhen(number('Height', 1080, 'px'), 'size', ['Custom']),
});
