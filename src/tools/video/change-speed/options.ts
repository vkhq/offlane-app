import { defineOptions, info, select, shownWhen, toggle } from '../../options';

/** The speeds offered, slowest first: the editor's slider moves along
 *  them, and the bar picks from them. */
export const speeds = [
  '0.25×',
  '0.5×',
  '0.75×',
  '1×',
  '1.25×',
  '1.5×',
  '1.75×',
  '2×',
  '2.5×',
  '3×',
  '3.5×',
  '4×',
];

export const options = defineOptions({
  speed: select('Speed', speeds, '2×'),
  removeAudio: toggle('Remove Audio'),
  // The sound keeps its pitch at any speed; with no sound, nothing to say.
  audio: shownWhen(info('Audio', 'Pitch kept'), 'removeAudio', [false]),
});
