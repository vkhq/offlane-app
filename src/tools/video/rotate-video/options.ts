// SPDX-License-Identifier: GPL-3.0-or-later
import { defineOptions, select, toggle } from '../../options';

export const options = defineOptions({
  // Also set by the editor's turn buttons. None first, so a video starts
  // as it is, and for a flip on its own.
  rotate: select('Rotate', ['None', '90° Right', '90° Left', '180°']),
  flipHorizontally: toggle('Flip Horizontally'),
});
