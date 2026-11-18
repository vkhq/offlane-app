import { MoveDiagonal2, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'resize-video',
  name: 'Resize Video',
  description: 'Scale videos to a new width, keeping proportions.',
  icon: MoveDiagonal2,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
