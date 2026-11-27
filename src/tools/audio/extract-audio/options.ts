import { defineOptions, editorList, select, shownWhen } from '../../options';

export const options = defineOptions({
  // Which of the video's audio tracks to save, from 0 in its order, as the
  // track picker sets them ("0,2").
  tracks: editorList('Tracks'),
  // Original copies each track out as it is, in the file type that holds it.
  // The track picker names the file type Original makes beside it: "M4A".
  format: {
    ...select('Format', ['Original', 'MP3', 'M4A', 'WAV', 'FLAC', 'OGG']),
    hintInBar: true,
  },
  // WAV and FLAC are lossless, and Original keeps the track's own: a
  // bitrate means something only for the rest.
  bitrate: shownWhen(
    select('Bitrate', [
      'Same as Track',
      '320 kbps',
      '256 kbps',
      '192 kbps',
      '128 kbps',
    ]),
    'format',
    ['MP3', 'M4A', 'OGG'],
  ),
});
