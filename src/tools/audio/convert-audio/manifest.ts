import { Music, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'convert-audio',
  name: 'Convert Audio',
  description: 'Change audio to MP3, M4A, WAV and other formats.',
  icon: Music,
  accepts: ['audio'],
  banner,
  requires: ['media'],
});
