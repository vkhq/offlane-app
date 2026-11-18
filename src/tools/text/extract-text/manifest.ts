import { ScanText, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'extract-text',
  name: 'Extract Text',
  description: 'Read the text out of images and scanned PDFs.',
  icon: ScanText,
  accepts: ['image', 'pdf'],
  banner,
});
