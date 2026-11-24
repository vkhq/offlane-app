// SPDX-License-Identifier: GPL-3.0-or-later
import { RotateEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Rotate',
  // Turned with buttons under the video, one video at a time.
  editor: RotateEditor,
});
