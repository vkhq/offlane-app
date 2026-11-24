// SPDX-License-Identifier: GPL-3.0-or-later
import { defineOptions, number, select, shownWhen } from '../../options';

export const options = defineOptions({
  aspect: select(
    'Aspect Ratio',
    [
      '16:9 Landscape',
      '9:16 Vertical',
      '1:1 Square',
      '4:5 Portrait',
      '4:3 Classic',
      '21:9 Cinema',
      'Custom',
    ],
    '9:16 Vertical',
  ),
  // Fit keeps the whole video, with bars where it doesn't reach the frame;
  // Fill covers the frame, cutting off what overflows.
  fit: select('Fit', ['Fit with Bars', 'Fill and Crop']),
  width: shownWhen(number('Width', 1080, 'px'), 'aspect', ['Custom']),
  height: shownWhen(number('Height', 1920, 'px'), 'aspect', ['Custom']),
});
