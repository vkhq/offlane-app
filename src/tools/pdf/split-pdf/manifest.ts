import { SquareSplitHorizontal, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'split-pdf',
  name: 'Split PDF',
  description: 'Break a PDF into separate files by page.',
  icon: SquareSplitHorizontal,
  accepts: ['pdf'],
  banner,
});
