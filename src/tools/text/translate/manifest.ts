import { Languages, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'translate',
  name: 'Translate',
  description: 'Translate documents into another language.',
  icon: Languages,
  accepts: ['file'],
  banner,
});
