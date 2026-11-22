import { MoveDiagonal2, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'resize-video',
  name: 'Resize Video',
  description: 'Make a video bigger or smaller, keeping its shape.',
  icon: MoveDiagonal2,
  accepts: ['video'],
  banner,
  requires: ['media'],
  keywords: [
    'upscale',
    'downscale',
    'scale',
    'resolution',
    '4k',
    '1080p',
    '720p',
    'smaller',
    'bigger',
  ],
});
