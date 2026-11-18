import { defineOptions, file, info, toggle } from '../../options';

export const options = defineOptions({
  audio: file('Audio', 'audio/*'),
  loopToFill: toggle('Loop to Fill'),
  video: info('Video', 'Unchanged'),
});
