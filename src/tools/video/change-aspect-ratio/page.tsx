// SPDX-License-Identifier: GPL-3.0-or-later
import { AspectEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Change Aspect Ratio',
  // The new frame over the video, and under Fill the part kept, dragged;
  // one video at a time.
  editor: AspectEditor,
});
