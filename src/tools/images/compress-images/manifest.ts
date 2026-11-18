import { Minimize2, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'compress-images',
  name: 'Compress Images',
  description: 'Make image files smaller with little visible loss.',
  icon: Minimize2,
  accepts: ['image'],
  banner,
});
