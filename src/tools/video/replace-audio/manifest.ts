import { Volume2, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'replace-audio',
  name: 'Replace Audio',
  description: "Swap a video's soundtrack for another audio file.",
  icon: Volume2,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
