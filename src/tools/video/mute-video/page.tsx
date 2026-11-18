import { dropVideos, standardTool } from '../../ui';

export default standardTool({
  input: dropVideos(),
  options: {},
  action: 'Mute',
});
