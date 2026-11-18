import { Mic, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'record-audio',
  name: 'Record Audio',
  description: 'Capture audio from your microphone or the system.',
  icon: Mic,
  banner,
  requires: ['media'],
});
