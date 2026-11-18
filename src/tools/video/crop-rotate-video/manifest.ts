import { Crop, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'crop-rotate-video',
  name: 'Crop & Rotate Video',
  description: 'Change the aspect ratio, rotate or flip a video.',
  icon: Crop,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
