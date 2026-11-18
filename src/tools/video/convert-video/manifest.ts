import { RefreshCw, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'convert-video',
  name: 'Convert Video',
  description: 'Change videos to MP4, MOV, WebM and other formats.',
  icon: RefreshCw,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
