import { FileArchive, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'compress-pdf',
  name: 'Compress PDF',
  description: 'Make a PDF smaller for email and uploads.',
  icon: FileArchive,
  accepts: ['pdf'],
  banner,
});
