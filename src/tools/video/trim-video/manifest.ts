import { Scissors, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'trim-video',
  name: 'Trim Video',
  description: 'Cut a video down to just the part you need.',
  icon: Scissors,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
