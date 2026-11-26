import { Images, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'convert-images',
  name: 'Convert Images',
  description: 'Change images to JPEG, PNG, WebP and other formats.',
  icon: Images,
  accepts: ['image'],
  banner,
});
