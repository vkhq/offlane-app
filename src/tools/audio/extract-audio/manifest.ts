import { AudioWaveform, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'extract-audio',
  name: 'Extract Audio',
  description: 'Pull the soundtrack out of a video file.',
  icon: AudioWaveform,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
