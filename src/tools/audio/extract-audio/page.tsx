import { dropVideos, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropVideos(true),
  options,
  action: 'Extract',
});
