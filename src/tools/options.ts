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
  time,
  timeRange,
  toggle,
  widthPx,
  type OptionValues,
  type Options,
} from '../shared/tools';

// Language codes as names ("es" → "Spanish"), for tracks offered by language.
export { languageName, sameLanguage } from '../shared/languages';
