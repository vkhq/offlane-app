import { dropImages, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropImages(),
  options,
  action: 'Remove Background',
});
