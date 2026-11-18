import { defineOptions, toggle } from '../../options';

export const options = defineOptions({
  reduceNoise: toggle('Reduce Noise', true),
  normalizeVolume: toggle('Normalize Volume', true),
  removeSilence: toggle('Remove Silence'),
});
