// SPDX-License-Identifier: GPL-3.0-or-later
import { defineOptions, editorValue, select } from '../../options';

export const options = defineOptions({
  // Free, or the box held to a shape.
  shape: select('Shape', ['Free', '16:9', '9:16', '1:1', '4:5', '4:3']),
  // The box kept, set by dragging it in the editor: its top-left corner
  // and size in the video's own pixels, as it plays. A width or height of
  // 0 is the whole picture.
  left: editorValue('Left'),
  top: editorValue('Top'),
  width: editorValue('Width'),
  height: editorValue('Height'),
});
