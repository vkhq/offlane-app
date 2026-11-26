// SPDX-License-Identifier: GPL-3.0-or-later
import { Ratio, defineTool } from '../../manifest';
import banner from './banner.webp';

export default defineTool({
  id: 'change-aspect-ratio',
  name: 'Change Aspect Ratio',
  description:
    'Reshape a video for Reels, Shorts or YouTube, with bars or a crop.',
  icon: Ratio,
  accepts: ['video'],
  banner,
  requires: ['media'],
  keywords: [
    'resize for instagram',
    'reels',
    'shorts',
    'tiktok',
    'youtube',
    'vertical',
    'square',
    'portrait',
    'landscape',
    'letterbox',
    'black bars',
    'pad',
    '16:9',
    '9:16',
    '1:1',
    '4:5',
  ],
});
