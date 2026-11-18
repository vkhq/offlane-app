// Which toolkits are installed, and where their programs are.
//
// Each installed toolkit lives in <root>/<id>/<variant>-<version>-<time>/,
// and <root>/<id>/current.json points at the one in use. The installer
// writes the pointer only once a build has been downloaded, checked and
// run, so a half-finished install is never in use. A pointer to a folder
// outside <root>/<id>, or to programs that are gone, counts as not
// installed, so an edited pointer can't make jobs run another program.
//
// Development builds can also count the vendor/ folder (`npm run
// fetch-binaries`) as installed, so `npm start` and the tests work without
// downloading anything; a toolkit the user installs still wins.
//
// Read again on every lookup, so an install or removal applies to the next
// job without a restart. No Electron import.
import { mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';

import { type ToolkitId, toolkitNames } from '../../shared/toolkits';
import { exeName, isFile, writeJsonAtomic } from '../files';

export type InstalledToolkit = {
  id: ToolkitId;
  variant: string;
  version: string;
  /** Absolute path of its folder. */
  dir: string;
  /** Each program, as a path inside `dir`. */
  binaries: Record<string, string>;
  /** Bytes on disk, when known. */
  size: number | null;
  source: 'user' | 'development';
};

/** What <root>/<id>/current.json holds. */
export type ToolkitPointer = {
  variant: string;
  version: string;
  /** A folder name inside <root>/<id>. */
  dir: string;
  binaries: Record<string, string>;
  size: number | null;
};

/** A job needs a toolkit that isn't installed. */
export class ToolkitMissingError extends Error {
  constructor(readonly toolkit: ToolkitId) {
    super(`Install the ${toolkitNames[toolkit]} toolkit to use this.`);
    this.name = 'ToolkitMissingError';
  }
}

const isInside = (parent: string, child: string) =>
  child.startsWith(path.resolve(parent) + path.sep);

export class ToolkitStore {
  constructor(
    /** <userData>/toolkits */
    readonly root: string,
    /** Toolkits from a development checkout's vendor/ folder. */
    private readonly development: Partial<
      Record<ToolkitId, InstalledToolkit>
    > = {},
  ) {}

  /** The folder a toolkit's builds and pointer live in. */
  dirOf(id: ToolkitId) {
    return path.join(this.root, id);
  }

  pointerFile(id: ToolkitId) {
    return path.join(this.dirOf(id), 'current.json');
  }

  /** The toolkit in use: the user's install, else a development one. */
  installed(id: ToolkitId): InstalledToolkit | null {
    return this.fromPointer(id) ?? this.development[id] ?? null;
  }

  /** The absolute path of one of a toolkit's programs; throws
   *  ToolkitMissingError if the toolkit isn't installed. */
  binary(id: ToolkitId, name: string): string {
    const found = this.findBinary(id, name);
    if (!found) throw new ToolkitMissingError(id);
    return found;
  }

  /** As `binary`, but null when missing. */
  findBinary(id: ToolkitId, name: string): string | null {
    const toolkit = this.installed(id);
    const relative = toolkit?.binaries[name];
    return toolkit && relative ? path.join(toolkit.dir, relative) : null;
  }

  /** Writes the pointer, switching jobs to the build in `dir`. */
  writePointer(id: ToolkitId, pointer: ToolkitPointer) {
    mkdirSync(this.dirOf(id), { recursive: true });
    writeJsonAtomic(this.pointerFile(id), pointer);
  }

  private fromPointer(id: ToolkitId): InstalledToolkit | null {
    try {
      const parsed = JSON.parse(
        readFileSync(this.pointerFile(id), 'utf8'),
      ) as Partial<ToolkitPointer>;
      const dir = path.resolve(this.dirOf(id), String(parsed.dir ?? ''));
      if (!isInside(this.dirOf(id), dir)) return null;
      const binaries = Object.fromEntries(
        Object.entries(parsed.binaries ?? {}).map(([name, file]) => [
          name,
          String(file),
        ]),
      );
      const names = Object.keys(binaries);
      const present = Object.values(binaries).every((file) => {
        const full = path.resolve(dir, file);
        return isInside(dir, full) && isFile(full);
      });
      if (names.length === 0 || !present) return null;
      return {
        id,
        variant: String(parsed.variant ?? ''),
        version: String(parsed.version ?? ''),
        dir,
        binaries,
        size: typeof parsed.size === 'number' ? parsed.size : null,
        source: 'user',
      };
    } catch {
      // Missing or corrupt: not installed.
      return null;
    }
  }
}

/**
 * The toolkits a development checkout's vendor/<os>-<arch>/bin folder holds,
 * laid out as `npm run fetch-binaries` leaves it.
 */
export function vendorToolkits(
  binDir: string,
): Partial<Record<ToolkitId, InstalledToolkit>> {
  let versions: Record<string, { version?: string; tag?: string }> = {};
  try {
    versions = JSON.parse(
      readFileSync(path.join(binDir, 'versions.json'), 'utf8'),
    );
  } catch {
    // Unknown versions.
  }
  const found: Partial<Record<ToolkitId, InstalledToolkit>> = {};
  const toolkit = (
    id: ToolkitId,
    variant: string,
    version: string,
    binaries: Record<string, string>,
  ) => {
    if (
      !Object.values(binaries).every((file) => isFile(path.join(binDir, file)))
    )
      return;
    found[id] = {
      id,
      variant,
      version,
      dir: binDir,
      binaries,
      size: null,
      source: 'development',
    };
  };
  toolkit('media', 'lgpl', versions.ffmpeg?.version ?? 'development', {
    ffmpeg: exeName('ffmpeg'),
    ffprobe: exeName('ffprobe'),
  });
  return found;
}

/**
 * Before toolkits, a GPL FFmpeg the user installed lived in
 * <userData>/ffmpeg/gpl-*, with its own current.json. It moves into the
 * Media toolkit's folder once, so nobody has to download it again.
 */
export function migrateLegacyFfmpeg(oldDir: string, store: ToolkitStore) {
  let pointer: { variant?: string; dir?: string; version?: string } = {};
  try {
    pointer = JSON.parse(
      readFileSync(path.join(oldDir, 'current.json'), 'utf8'),
    );
  } catch {
    // No pointer: whatever is left there (an empty folder, a build nothing
    // points at) is unused, and goes below.
  }
  const from = path.resolve(oldDir, String(pointer.dir ?? ''));
  const binaries = { ffmpeg: exeName('ffmpeg'), ffprobe: exeName('ffprobe') };
  if (
    pointer.variant === 'gpl' &&
    isInside(oldDir, from) &&
    Object.values(binaries).every((file) => isFile(path.join(from, file))) &&
    store.installed('media')?.source !== 'user'
  ) {
    const version = String(pointer.version ?? 'unknown');
    const folder = `gpl-${version.replace(/[^\w.-]/g, '_')}-${Date.now()}`;
    try {
      mkdirSync(store.dirOf('media'), { recursive: true });
      renameSync(from, path.join(store.dirOf('media'), folder));
      store.writePointer('media', {
        variant: 'gpl',
        version,
        dir: folder,
        binaries,
        size: null,
      });
    } catch {
      // It couldn't move; it stays, unused, rather than being lost.
      return;
    }
  }
  rmSync(oldDir, { recursive: true, force: true });
}
