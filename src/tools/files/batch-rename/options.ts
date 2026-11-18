import { defineOptions, number, select, text } from '../../options';

export const options = defineOptions({
  name: text('Name', 'File', 'Name'),
  number: select('Number', ['After Name', 'Before Name', 'None']),
  startAt: number('Start At', 1),
  case: select('Case', ['Unchanged', 'lowercase', 'UPPERCASE', 'Title Case']),
});
