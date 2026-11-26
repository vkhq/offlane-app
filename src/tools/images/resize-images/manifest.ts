import { MoveDiagonal2, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'resize-images',
  name: 'Resize Images',
  description: 'Scale images to a new width, keeping proportions.',
  icon: MoveDiagonal2,
  accepts: ['image'],
  banner,
});
