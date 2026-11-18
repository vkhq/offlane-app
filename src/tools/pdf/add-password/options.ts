import { defineOptions, password } from '../../options';

export const options = defineOptions({
  password: password('Password', 'Required'),
  confirm: password('Confirm', 'Required'),
});
