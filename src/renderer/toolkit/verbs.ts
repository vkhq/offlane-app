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
