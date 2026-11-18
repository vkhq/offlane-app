import { dropPdfs, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: dropPdfs(),
  options,
  action: 'Split',
});
