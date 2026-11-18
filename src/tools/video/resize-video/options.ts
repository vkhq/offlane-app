import { defineOptions, select } from '../../options';

export const options = defineOptions({
  width: select(
    'Width',
    ['3840 px', '2560 px', '1920 px', '1280 px', '854 px', '640 px'],
    '1920 px',
  ),
});
