import { AudioTrimEditor, drop, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  // Files only: a link would need downloading first (Download Video).
  input: drop(
    'audio',
    'audio/*',
    'MP3, M4A, WAV, FLAC, OGG, AIFF and WMA',
    false,
  ),
  options,
  action: 'Trim',
  // Start and End set on a timeline of the sound's waveform, one file at
  // a time.
  editor: AudioTrimEditor,
});
