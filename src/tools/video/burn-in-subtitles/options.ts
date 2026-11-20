import { defineOptions, language, select, shownWhen } from '../../options';

export const options = defineOptions({
  subtitles: select('Subtitles', ['Transcribe', 'From File']),
  // The language to listen for; a file's subtitles are already written.
  language: shownWhen(language(), 'subtitles', ['Transcribe']),
  textSize: select('Text Size', ['Small', 'Medium', 'Large'], 'Medium'),
});
