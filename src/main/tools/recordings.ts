// Recordings made in the page (Record Audio): the page sends the bytes when
// recording stops, and they are kept here until a tool has run on them.
// Each is in a folder of its own, under a name a person reads ("Recording
// 2026-11-20 at 10.15.32.webm"), as a tool names its output after it.
// Recordings older than a day are swept away when the app starts.
//
// No Electron import, so it can be driven by plain Node in tests.
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

/** The kinds of recording the page makes, and their extensions. */
const extensions: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
};

/** The most one recording may be: about 9 hours of 256 kbps audio. */
export const maxRecordingBytes = 1024 * 1024 * 1024;

const pad = (value: number) => String(value).padStart(2, '0');

/** "Recording 2026-11-20 at 10.15.32", in local time. */
export function recordingName(when = new Date()) {
  const date = `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`;
  const time = `${pad(when.getHours())}.${pad(when.getMinutes())}.${pad(when.getSeconds())}`;
  return `Recording ${date} at ${time}`;
}

export class Recordings {
  constructor(private dir: string) {}

  /**
   * Saves a recording; returns its path and the name and type to show.
   * `type` is the MediaRecorder's MIME type, parameters and all
   * ("audio/webm;codecs=opus").
   */
  save(
    data: Uint8Array,
    type: string,
    when = new Date(),
  ): { path: string; name: string; type: string } {
    const mime = type.split(';')[0].trim().toLowerCase();
    const ext = extensions[mime];
    if (!ext) throw new Error("Offlane can't save that kind of recording.");
    if (data.byteLength === 0) throw new Error('The recording is empty.');
    if (data.byteLength > maxRecordingBytes) {
      throw new Error('The recording is too long to save.');
    }
    const folder = path.join(this.dir, randomUUID());
    mkdirSync(folder, { recursive: true });
    const name = `${recordingName(when)}.${ext}`;
    const file = path.join(folder, name);
    writeFileSync(file, data);
    return { path: file, name, type: mime };
  }

  /** Removes recordings made more than `maxAgeMs` ago. */
  sweep(maxAgeMs = 24 * 60 * 60 * 1000, now = Date.now()) {
    let folders: string[];
    try {
      folders = readdirSync(this.dir);
    } catch {
      return; // None made yet.
    }
    for (const folder of folders) {
      const full = path.join(this.dir, folder);
      try {
        if (now - statSync(full).mtimeMs > maxAgeMs) {
          rmSync(full, { recursive: true, force: true });
        }
      } catch {
        // Gone already, or not ours to remove.
      }
    }
  }
}
