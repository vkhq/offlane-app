import { LockOpen, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'remove-password',
  name: 'Remove Password',
  description: 'Unlock a PDF you know the password for.',
  icon: LockOpen,
  accepts: ['pdf'],
  banner,
});
