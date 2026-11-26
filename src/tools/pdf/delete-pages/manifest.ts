import { FileMinus, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'delete-pages',
  name: 'Delete Pages',
  description: "Remove the pages you don't need from a PDF.",
  icon: FileMinus,
  accepts: ['pdf'],
  banner,
});
