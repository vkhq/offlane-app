import { standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: {
    kind: 'record',
    title: 'Ready to record',
    note: 'Records from the selected input until you stop.',
  },
  options,
  action: 'Save Recording',
});
