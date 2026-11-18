import { defineOptions, language, select } from '../../options';

export const options = defineOptions({
  subtitles: select('Subtitles', ['Transcribe', 'From File']),
  language: language(),
  textSize: select('Text Size', ['Small', 'Medium', 'Large'], 'Medium'),
});
