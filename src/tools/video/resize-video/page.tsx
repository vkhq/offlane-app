import { ResizeEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Resize',
  // The size set on a frame over the video, one video at a time.
  editor: ResizeEditor,
});
