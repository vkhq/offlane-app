import { CropEditor, dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(),
  options,
  action: 'Crop',
  // The box kept, dragged over the video; one video at a time.
  editor: CropEditor,
});
