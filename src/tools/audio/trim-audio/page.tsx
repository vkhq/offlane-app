import { dropAudio, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropAudio(),
  options,
  action: 'Trim',
});
