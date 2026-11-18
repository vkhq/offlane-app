import { defineOptions, language, select } from '../../options';

export const options = defineOptions({
  language: language(),
  format: select('Format', ['Plain Text', 'Markdown']),
});
