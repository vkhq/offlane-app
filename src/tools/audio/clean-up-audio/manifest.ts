import { WandSparkles, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'clean-up-audio',
  name: 'Clean Up Audio',
  description: 'Reduce noise, even out volume and remove silences.',
  icon: WandSparkles,
  accepts: ['audio'],
  banner,
  requires: ['media'],
});
