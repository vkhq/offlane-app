import { drop, standardTool } from '../../ui';
import { options } from './options';

export default standardTool({
  input: drop('audio', 'audio/*,video/*', 'MP3, M4A, WAV, MP4 and MOV', true),
  options,
  action: 'Transcribe',
});
