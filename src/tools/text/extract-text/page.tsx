import { drop, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: drop(
    'image',
    'image/*,application/pdf',
    'JPEG, PNG, HEIC and PDF',
    true,
  ),
  options,
  action: 'Extract Text',
});
