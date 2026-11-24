// What a tool's runs are doing, in words, from the verb its button
// starts with.

/** The "-ing" form of the verbs tools' buttons start with. */
const progressives: Record<string, string> = {
  Add: 'Adding',
  Apply: 'Applying',
  Burn: 'Burning',
  Change: 'Changing',
  Clean: 'Cleaning',
  Compress: 'Compressing',
  Convert: 'Converting',
  Create: 'Creating',
  Crop: 'Cropping',
  Delete: 'Deleting',
  Export: 'Exporting',
  Extract: 'Extracting',
  Merge: 'Merging',
  Mute: 'Muting',
  Remove: 'Removing',
  Rename: 'Renaming',
  Replace: 'Replacing',
  Resize: 'Resizing',
  Rotate: 'Rotating',
  Save: 'Saving',
  Sign: 'Signing',
  Split: 'Splitting',
  Summarize: 'Summarizing',
  Transcribe: 'Transcribing',
  Translate: 'Translating',
  Trim: 'Trimming',
};

/**
 * What a run under way is doing, from the tool's button or name: Compress
 * becomes Compressing, Video to GIF Converting; Working when the verb isn't
 * known.
 */
export function progressive(action: string) {
  const verb = progressives[action.split(' ')[0]];
  if (verb) return verb;
  // A tool named for what it turns one thing into: Video to GIF.
  return / to /.test(action) ? 'Converting' : 'Working';
}

/** The past forms of the verbs tools' buttons start with: some lower-case,
 *  as they follow their object ("Background removed"). */
const pasts: Record<string, string> = {
  Add: 'added',
  Apply: 'Applied',
  Burn: 'Burned',
  Change: 'changed',
  Clean: 'Cleaned',
  Compress: 'Compressed',
  Convert: 'Converted',
  Create: 'created',
  Crop: 'Cropped',
  Delete: 'deleted',
  Export: 'Exported',
  Extract: 'Extracted',
  Merge: 'Merged',
  Mute: 'Muted',
  Remove: 'removed',
  Rename: 'Renamed',
  Replace: 'replaced',
  Resize: 'Resized',
  Rotate: 'Rotated',
  Save: 'Saved',
  Sign: 'Signed',
  Split: 'Split',
  Summarize: 'Summarized',
  Transcribe: 'Transcribed',
  Translate: 'Translated',
  Trim: 'Trimmed',
};

/**
 * What a finished run is called, from the tool's button: Compress becomes
 * Compressed, Clean Up "Cleaned up", Remove Background "Background removed".
 */
export function pastTense(action: string) {
  const [verb, ...rest] = action.split(' ');
  const past = pasts[verb];
  if (!past) return 'Done';
  const object = rest.join(' ');
  if (!object) return past;
  // A verb with a particle (Clean Up, Burn In) keeps its order.
  if (/^(Up|In|Out)$/.test(object)) return `${past} ${object.toLowerCase()}`;
  if (past === past.toLowerCase()) {
    return `${object} ${past}`;
  }
  return `${past} ${object.toLowerCase()}`;
}

/**
 * What finished runs made, as the link down to them says it: "Video Muted",
 * "2 Videos Muted", "2 of 3 Images Converted". `kind` is what they made;
 * Done when the button's verb isn't known.
 */
export function madeLabel(
  action: string,
  kind: keyof typeof madeNouns,
  done: number,
  total: number,
) {
  const [verb, ...rest] = action.split(' ');
  const past = pasts[verb];
  if (!past) return null;
  const noun = `${madeNouns[kind]}${done === 1 && total === 1 ? '' : 's'}`;
  const count =
    done === total ? (done === 1 ? '' : `${done} `) : `${done} of ${total} `;
  // A button naming something besides the file says what was done to it
  // ("Background Removed", "GIF Created"), how many after it.
  const object = rest.join(' ');
  if (object && !/^(videos?|images?|pdfs?|audio|files?)$/i.test(object)) {
    const finished = pastTense(action).replace(/\b\w/g, (letter) =>
      letter.toUpperCase(),
    );
    return count ? `${finished} · ${count}${noun}` : finished;
  }
  return `${count}${noun} ${past[0].toUpperCase()}${past.slice(1)}`;
}

/** What a run made, by its output's kind, as madeLabel counts it. */
const madeNouns = {
  video: 'Video',
  audio: 'Audio File',
  image: 'Image',
  pdf: 'PDF',
  file: 'File',
};

/** Words for a kind of file, as a button counts them. */
const countNouns = {
  video: 'Video',
  audio: 'Audio File',
  image: 'Image',
  pdf: 'PDF',
  file: 'File',
};
/** The words for a kind of file a button's label may end in. */
const kindWords = {
  video: 'Videos?',
  audio: 'Audio',
  image: 'Images?',
  pdf: 'PDFs?',
  file: 'Files?',
};

/**
 * A tool's button, saying how many of what it will run on: "Mute 2
 * Videos". On one, just its own words: "Mute Video". A button naming
 * something else keeps its words, the count after them: "Create GIF · 2
 * Videos".
 */
export function countedAction(
  action: string,
  count: number,
  kind: keyof typeof countNouns,
) {
  if (count === 1) return action;
  const things = `${count} ${countNouns[kind]}s`;
  const verb = action.replace(new RegExp(`\\s+(${kindWords[kind]})$`), '');
  return verb.includes(' ') ? `${action} · ${things}` : `${verb} ${things}`;
}
