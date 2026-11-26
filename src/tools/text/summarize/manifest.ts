import { TextQuote, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'summarize',
  name: 'Summarize',
  description: 'Get the key points of a long document.',
  icon: TextQuote,
  accepts: ['file'],
  banner,
});
