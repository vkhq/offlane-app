// The option builders a tool's options.ts uses. Shared by its page and its
// handler, so nothing here may import React or Electron.
export {
  defineOptions,
  file,
  info,
  language,
  languages,
  number,
  pageRange,
  password,
  quality,
  select,
  shownWhen,
  text,
  timeRange,
  toggle,
  widthPx,
  type OptionValues,
  type Options,
} from '../shared/tools';
