import { PenLine, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'sign-pdf',
  name: 'Sign PDF',
  description: 'Place your signature on a PDF.',
  icon: PenLine,
  accepts: ['pdf'],
  banner,
});
