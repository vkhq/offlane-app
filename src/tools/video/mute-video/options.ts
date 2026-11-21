import { defineOptions, toggle } from '../../options';

export const options = defineOptions({
  // Off by default: muting takes out only the sound.
  removeSubtitles: toggle('Remove Subtitles'),
});
