import { defineOptions, select } from '../../options';

export const options = defineOptions({
  // The crop box's shape: drawn freely, or held to a ratio. The box itself
  // (where it is and how big) will be set on the video by its editor.
  shape: select('Shape', ['Free', '16:9', '9:16', '1:1', '4:5', '4:3']),
});
