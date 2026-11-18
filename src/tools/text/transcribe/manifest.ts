import { Captions, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'transcribe',
  name: 'Transcribe',
  description: 'Turn speech in audio or video into text.',
  icon: Captions,
  accepts: ['audio', 'video'],
  banner,
  featured: true,
});
