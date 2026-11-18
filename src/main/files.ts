import { renameSync, statSync, writeFileSync } from 'node:fs';

/** True if the path exists and is a file, not a folder or a dangling link. */
export const isFile = (file: string) => {
  try {
    return statSync(file).isFile();
  } catch {
    return false;
  }
};

/** An executable's file name on this platform: "ffmpeg" or "ffmpeg.exe". */
export const exeName = (name: string) =>
  process.platform === 'win32' ? `${name}.exe` : name;

/** Writes JSON via a temp file and a rename, so a crash never half-writes it. */
export function writeJsonAtomic(file: string, value: unknown) {
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, file);
}
