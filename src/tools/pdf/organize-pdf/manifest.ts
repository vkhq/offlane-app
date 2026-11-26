import { LayoutGrid, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'organize-pdf',
  name: 'Organize PDF',
  description: 'Reorder and rotate the pages of a PDF.',
  icon: LayoutGrid,
  accepts: ['pdf'],
  banner,
});
