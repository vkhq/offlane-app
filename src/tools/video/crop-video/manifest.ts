import { Crop, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'crop-video',
  name: 'Crop Video',
  description: 'Cut away the edges to keep just the part you want.',
  icon: Crop,
  accepts: ['video'],
  banner,
  requires: ['media'],
  keywords: ['cut out', 'trim edges', 'zoom in', 'region', 'frame', 'reframe'],
});
