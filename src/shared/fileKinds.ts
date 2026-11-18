// What kind of file something is, by its extension: what a tool takes in, and
// what its outputs can be passed on to. No Electron, Node or React import.

export type FileKind = 'video' | 'audio' | 'image' | 'pdf' | 'file';

const extensions: Record<Exclude<FileKind, 'file'>, string[]> = {
  video: [
    'mp4',
    'mov',
    'm4v',
    'mkv',
    'webm',
    'avi',
    'flv',
    'wmv',
    'mpg',
    'mpeg',
    'ts',
    '3gp',
  ],
  audio: [
    'mp3',
    'm4a',
    'aac',
    'wav',
    'flac',
    'ogg',
    'opus',
    'wma',
    'aiff',
    'aif',
  ],
  image: [
    'jpg',
    'jpeg',
    'png',
    'webp',
    'gif',
    'heic',
    'heif',
    'tif',
    'tiff',
    'bmp',
    'avif',
  ],
  pdf: ['pdf'],
};

/** A file's kind from its name; anything unrecognised is just a file. */
export function fileKindOf(name: string): FileKind {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  for (const [kind, known] of Object.entries(extensions)) {
    if (known.includes(ext)) return kind as FileKind;
  }
  return 'file';
}
