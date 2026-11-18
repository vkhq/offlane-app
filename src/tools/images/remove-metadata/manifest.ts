import { Tag, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'remove-metadata',
  name: 'Remove Metadata',
  description: 'Strip location, camera and date details from images.',
  icon: Tag,
  accepts: ['image'],
  banner,
});
