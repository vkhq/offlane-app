import { AudioLines, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'trim-audio',
  name: 'Trim Audio',
  description: 'Cut an audio file down to just the part you need.',
  icon: AudioLines,
  accepts: ['audio'],
  banner,
  requires: ['media'],
});
