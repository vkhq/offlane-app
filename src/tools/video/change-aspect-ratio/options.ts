// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defineOptions,
  editorValue,
  number,
  select,
  shownWhen,
} from '../../options';

/** Fill keeps the whole height or width; its editor sets where. */
const fillOnly = ['Fill and Crop'];

export const options = defineOptions({
  // None until one is chosen, so a video opens as it is.
  aspect: select(
    'Aspect Ratio',
    [
      'None',
      '16:9 Landscape',
      '9:16 Vertical',
      '1:1 Square',
      '4:5 Portrait',
      '4:3 Classic',
      '21:9 Cinema',
      'Custom',
    ],
    'None',
  ),
  // Fit keeps the whole video, with bars where it doesn't reach the frame;
  // Fill covers the frame, cutting off what overflows.
  fit: select('Fit', ['Fit with Bars', 'Fill and Crop']),
  width: shownWhen(number('Width', 1080, 'px'), 'aspect', ['Custom']),
  height: shownWhen(number('Height', 1920, 'px'), 'aspect', ['Custom']),
  // Fill's kept part: its top-left corner in the video's own pixels, as
  // it plays, set by dragging it in the editor; -1 centres it.
  cropX: shownWhen(editorValue('Crop X', -1, { min: -1 }), 'fit', fillOnly),
  cropY: shownWhen(editorValue('Crop Y', -1, { min: -1 }), 'fit', fillOnly),
});
