import { RotateCw, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'rotate-images',
  name: 'Rotate Images',
  description: 'Rotate or flip a batch of images at once.',
  icon: RotateCw,
  accepts: ['image'],
  banner,
});
