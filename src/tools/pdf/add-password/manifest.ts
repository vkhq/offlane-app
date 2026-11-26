import { Lock, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'add-password',
  name: 'Add Password',
  description: 'Protect a PDF so it needs a password to open.',
  icon: Lock,
  accepts: ['pdf'],
  banner,
});
