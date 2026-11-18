// A JSON file with debounced, atomic writes (temp file, then rename), so a
// crash never leaves half-written JSON. During a download the job list
// changes many times a second, but the disk is written at most once per
// `debounceMs`.
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { writeJsonAtomic } from '../files';

export class JsonFile<T> {
  private timer: NodeJS.Timeout | null = null;
  private pending: T | null = null;

  constructor(
    private readonly file: string,
    private readonly debounceMs = 1000,
  ) {
    mkdirSync(path.dirname(file), { recursive: true });
  }

  /** The parsed contents, or `fallback` if the file is missing or corrupt. */
  read(fallback: T): T {
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as T;
    } catch {
      return fallback;
    }
  }

  /** Schedules a write; calls within the debounce window collapse into one. */
  write(value: T): void {
    this.pending = value;
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.debounceMs);
    }
  }

  /** Writes now; call on quit so the last state isn't lost. */
  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.pending === null) return;
    writeJsonAtomic(this.file, this.pending);
    this.pending = null;
  }
}
