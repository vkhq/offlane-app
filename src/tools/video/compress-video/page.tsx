import { dropVideos, standardTool, withSizes } from '../../ui';
import { options } from './options';

export default standardTool({
  input: withSizes(dropVideos()),
  options,
  action: 'Compress',
});
