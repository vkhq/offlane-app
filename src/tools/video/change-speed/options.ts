import { defineOptions, info, select } from '../../options';

export const options = defineOptions({
  speed: select('Speed', ['0.25×', '0.5×', '1.5×', '2×', '4×'], '2×'),
  audio: info('Audio', 'Pitch kept'),
});
