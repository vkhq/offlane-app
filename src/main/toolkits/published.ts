// Toolkit builds this project publishes itself, by toolkit, variant and
// target. Written by `npm run publish-toolkits -- --base-url=<where they are
// hosted>`; edit by running it again, not by hand.
//
// Empty until the first publish: until then the Media toolkit isn't offered
// on macOS, where no one else publishes an LGPL FFmpeg.
import type { ReleaseOverlay } from './catalog';

export const published: ReleaseOverlay = {};
