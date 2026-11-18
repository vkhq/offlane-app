import { defineOptions, select } from '../../options';

export const options = defineOptions({
  input: select('Input', ['Default Microphone', 'System Audio']),
  format: select('Format', ['M4A', 'MP3', 'WAV']),
  quality: select('Quality', ['High', 'Medium', 'Low']),
});
