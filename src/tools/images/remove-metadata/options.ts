import { defineOptions, toggle } from '../../options';

export const options = defineOptions({
  location: toggle('Location', true),
  cameraDetails: toggle('Camera Details', true),
  dateTime: toggle('Date & Time', true),
});
