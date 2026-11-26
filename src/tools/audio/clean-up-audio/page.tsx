import { dropAudio, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  // Files only: a link would need downloading first (Download Video).
  input: dropAudio(false),
  options,
  action: 'Clean Up',
  blocked: (values) =>
    values.reduceNoise || values.normalizeVolume || values.removeSilence
      ? null
      : 'Turn on at least one option to clean up.',
});
