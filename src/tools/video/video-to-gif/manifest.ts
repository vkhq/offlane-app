import { CircleDot, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'video-to-gif',
  name: 'Video to GIF',
  description: 'Turn part of a video into a looping GIF.',
  icon: CircleDot,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
