import { defineOptions, select } from '../../options';

export const options = defineOptions({
  length: select('Length', ['Short', 'Medium', 'Detailed'], 'Medium'),
  style: select('Style', ['Paragraph', 'Bullet Points']),
});
