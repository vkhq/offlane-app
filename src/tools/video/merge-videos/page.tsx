import { dropVideos, ordered, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  // Merged in the order shown, which can be changed by dragging.
  input: ordered(dropVideos()),
  options,
  action: 'Merge',
});
