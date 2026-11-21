// What a standard tool takes in: dropped or browsed files, one link, or a
// recording.

import type { FileKind } from '../../shared/fileKinds';

export type { FileKind } from '../../shared/fileKinds';

export type DropInput = {
  kind: 'drop';
  files: FileKind;
  /** MIME filter for the upload dialog. */
  accept: string;
  /** The same filter in words, shown beside the import methods. */
  formats: string;
  /** Whether items can also be added by URL, not just as files. */
  links: boolean;
  /** Whether the order matters (as for Merge): items can then be dragged,
   *  or moved with Alt+↑ and Alt+↓, into place. */
  ordered?: boolean;
  /** Whether each file's size shows under its picture (see MediaStrip),
   *  where size is what the tool is about (Compress). */
  sizes?: boolean;
};

export type LinkInput = {
  kind: 'link';
  label: string;
  placeholder: string;
  /** A line under the field, such as which sites work; optional. */
  note?: string;
};

export type RecordInput = { kind: 'record'; title: string; note: string };

export type Input = DropInput | LinkInput | RecordInput;

export const drop = (
  files: FileKind,
  accept: string,
  formats: string,
  links = true,
): DropInput => ({ kind: 'drop', files, accept, formats, links });

// Video tools take files only; Download Video is the tool for links.
export const dropVideos = (links = false) =>
  drop('video', 'video/*', 'MP4, MOV, WebM, MKV and AVI', links);
export const dropAudio = () =>
  drop('audio', 'audio/*', 'MP3, M4A, WAV, FLAC and OGG');
export const dropImages = () =>
  drop('image', 'image/*', 'JPEG, PNG, WebP, HEIC and TIFF');
export const dropPdfs = () => drop('pdf', 'application/pdf', 'PDF');
export const dropFiles = () => drop('file', '*/*', 'any file type');

/** `input`, its files' sizes shown (see DropInput.sizes), on its page and
 *  as a later step. */
export const withSizes = (input: DropInput): DropInput => ({
  ...input,
  sizes: true,
});

/** `input`, with items that can be put in order (see DropInput.ordered). */
export const ordered = (input: DropInput): DropInput => ({
  ...input,
  ordered: true,
});
