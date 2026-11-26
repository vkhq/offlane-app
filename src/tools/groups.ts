import { FilePdf, Folder, Image, Music, TextSquare, Video } from './manifest';

/**
 * The tool groups, in the order the app lists them. A tool's group is the
 * folder it sits in: `src/tools/<group id>/<tool id>/`.
 */
export const groups = [
  { id: 'video', name: 'Video', icon: Video },
  { id: 'audio', name: 'Audio', icon: Music },
  { id: 'images', name: 'Images', icon: Image },
  { id: 'pdf', name: 'PDF', icon: FilePdf },
  { id: 'text', name: 'Text', icon: TextSquare },
  { id: 'files', name: 'Files', icon: Folder },
];
