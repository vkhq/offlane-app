import { MessageSquareText, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'burn-in-subtitles',
  name: 'Burn In Subtitles',
  description: 'Add permanent captions from a transcript or a file.',
  icon: MessageSquareText,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
