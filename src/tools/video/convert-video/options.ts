import { defineOptions, select } from '../../options';

export const options = defineOptions({
  format: select('Format', ['MP4', 'MOV', 'WebM', 'MKV', 'AVI']),
});
