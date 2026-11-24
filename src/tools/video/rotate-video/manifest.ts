// SPDX-License-Identifier: GPL-3.0-or-later
import { RotateCw, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'rotate-video',
  name: 'Rotate Video',
  description: 'Turn a sideways video upright, or flip it.',
  icon: RotateCw,
  accepts: ['video'],
  banner,
  requires: ['media'],
  keywords: [
    'turn',
    'flip',
    'mirror',
    'sideways',
    'upside down',
    'upright',
    'orientation',
  ],
});
