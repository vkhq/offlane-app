import { TrimEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Trim',
  // Start and End set on a timeline of the video, one video at a time.
  editor: TrimEditor,
});
