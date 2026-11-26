import { Minimize2, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'compress-video',
  name: 'Compress Video',
  description: 'Shrink video files while keeping them sharp enough to share.',
  icon: Minimize2,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
