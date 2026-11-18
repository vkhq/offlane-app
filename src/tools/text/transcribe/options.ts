import { defineOptions, language, select, toggle } from '../../options';

export const options = defineOptions({
  language: language(),
  format: select('Format', ['Plain Text', 'SRT', 'VTT']),
  timestamps: toggle('Timestamps'),
});
