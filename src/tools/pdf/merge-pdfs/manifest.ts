import { Files, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'merge-pdfs',
  name: 'Merge PDFs',
  description: 'Join several PDFs into a single document.',
  icon: Files,
  accepts: ['pdf'],
  banner,
  featured: true,
});
