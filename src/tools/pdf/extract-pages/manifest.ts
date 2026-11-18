import { FileOutput, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'extract-pages',
  name: 'Extract Pages',
  description: 'Save selected pages of a PDF as a new file.',
  icon: FileOutput,
  accepts: ['pdf'],
  banner,
});
