import { SpeedEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Change Speed',
  // The video playing at the speed set on a slider; one video at a time.
  editor: SpeedEditor,
});
