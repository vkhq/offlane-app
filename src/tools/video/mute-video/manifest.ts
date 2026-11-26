import { VolumeX, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'mute-video',
  name: 'Mute Video',
  description: 'Remove the audio track from a video.',
  icon: VolumeX,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
