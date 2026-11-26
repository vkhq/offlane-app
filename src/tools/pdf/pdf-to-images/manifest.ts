import { Image, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'pdf-to-images',
  name: 'PDF to Images',
  description: 'Export every page of a PDF as an image.',
  icon: Image,
  accepts: ['pdf'],
  banner,
});
