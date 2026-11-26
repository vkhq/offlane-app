import { Film, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'merge-videos',
  name: 'Merge Videos',
  description: 'Join several clips into one continuous video.',
  icon: Film,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
