import { CircleArrowDown, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'download-video',
  name: 'Download Video',
  description: 'Save videos from a link in the quality and format you choose.',
  icon: CircleArrowDown,
  banner,
  featured: true,
  requires: ['media'],
  // Runs the person's own yt-dlp; the app never ships one.
  enabledBy: 'ytdlp',
});
