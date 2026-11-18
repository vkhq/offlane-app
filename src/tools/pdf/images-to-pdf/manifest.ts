import { FileImage, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'images-to-pdf',
  name: 'Images to PDF',
  description: 'Combine images into a single PDF document.',
  icon: FileImage,
  accepts: ['image'],
  banner,
});
