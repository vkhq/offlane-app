import { FilePenLine, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'batch-rename',
  name: 'Batch Rename',
  description: 'Rename many files at once with a pattern.',
  icon: FilePenLine,
  accepts: ['file'],
  banner,
});
