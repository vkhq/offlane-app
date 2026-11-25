import { GifClipEditor, GifPreview, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Create GIF',
  // The part to turn into a GIF, set on a timeline (5 seconds from the
  // middle to start with, zoomed in on); one video at a time.
  editor: GifClipEditor,
  // The GIF itself, looping, before it is made.
  preview: { label: 'GIF Preview', view: GifPreview },
});
