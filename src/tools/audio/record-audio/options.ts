import { defineOptions, select, shownWhen } from '../../options';

export const options = defineOptions({
  input: select('Input', ['Default Microphone', 'System Audio']),
  format: select('Format', ['M4A', 'MP3', 'WAV']),
  // WAV is lossless: a quality means nothing for it.
  quality: shownWhen(select('Quality', ['High', 'Medium', 'Low']), 'format', [
    'M4A',
    'MP3',
  ]),
});
