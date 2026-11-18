import { Gauge, defineTool } from '../../ui';
import banner from './banner.webp';

export default defineTool({
  id: 'change-speed',
  name: 'Change Speed',
  description: 'Speed up or slow down a video without changing pitch.',
  icon: Gauge,
  accepts: ['video'],
  banner,
  requires: ['media'],
});
