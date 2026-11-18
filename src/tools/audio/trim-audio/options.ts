import { defineOptions, number } from '../../options';

export const options = defineOptions({
  start: number('Start', 0, 's'),
  end: number('End', 10, 's'),
});
