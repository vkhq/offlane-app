import { Eraser, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'remove-background',
  name: 'Remove Background',
  description: 'Cut the subject out of a photo automatically.',
  icon: Eraser,
  accepts: ['image'],
  banner,
  featured: true,
});
