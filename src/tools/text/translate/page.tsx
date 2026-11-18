import { dropFiles, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropFiles(),
  options,
  action: 'Translate',
});
