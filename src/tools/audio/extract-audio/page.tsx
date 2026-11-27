import { parseList } from '../../options';
import { AudioTrackPicker, dropVideos, standardTool } from '../../ui';
import { options } from './options';

/** How many tracks are ticked. */
const ticked = (tracks: string) => parseList(tracks)?.length ?? 0;

export default standardTool({
  // Files only, one at a time: its tracks are picked in the editor.
  input: dropVideos(),
  editor: AudioTrackPicker,
  options,
  action: 'Extract',
  actionLabel: (values) => {
    const count = ticked(values.tracks);
    return count > 1 ? `Extract ${count} Tracks` : 'Extract Track';
  },
  blocked: (values) =>
    ticked(values.tracks) > 0 ? null : 'Pick at least one track to extract.',
});
