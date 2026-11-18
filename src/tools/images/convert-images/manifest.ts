import { Images, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'convert-images',
  name: 'Convert Images',
  description: 'Change images to JPEG, PNG, WebP and other formats.',
  icon: Images,
  accepts: ['image'],
  banner,
});
