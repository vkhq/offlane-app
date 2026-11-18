import { defineOptions, language, select } from '../../options';

export const options = defineOptions({
  from: select('From', ['Detect Language']),
  to: language('To'),
});
