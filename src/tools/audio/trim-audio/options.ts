import { defineOptions, timeRange } from '../../options';

export const options = defineOptions({
  // Start and End, in seconds.
  ...timeRange(),
});
