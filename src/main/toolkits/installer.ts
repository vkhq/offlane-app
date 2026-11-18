// Installs a toolkit into the user's data folder, updates it, and removes
// it. The steps, each of which must pass before the next:
//   1. download every archive to a staging folder, with progress and cancel
//   2. check each against its SHA-256
//   3. unpack, and lay the files out as the release says
//   4. clear macOS's quarantine flag, and run the programs: each must start
//      and answer as the release expects (an LGPL FFmpeg must not be GPL)
//   5. move the build into <root>/<id>/ and switch current.json to it
// Until step 5 nothing the jobs use changes, so a failure or cancel at any
// point leaves the toolkit as it was (installed or not) and no staging files
// behind. A release that is gone (404) moves on to the next one listed.
//
// An install stopped by the app quitting is the one exception: it leaves a
// small marker, <root>/.resume-<id>, naming the variant, and the next launch
// starts it again (see `interrupted`). Its partial files are swept then too.
//
// No Electron import, so the integration tests can use it with plain Node.
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import extractZip from 'extract-zip';

import type { ToolkitId, ToolkitInstallState } from '../../shared/toolkits';
import { run } from '../engine/runner';
import type { ToolkitArchive, ToolkitCheck, ToolkitRelease } from './catalog';
import type { InstalledToolkit, ToolkitStore } from './store';

export class InstallCanceled extends Error {
  constructor() {
    super('Install canceled.');
  }
}

/** A release that no longer exists, so the next one should be tried. */
class SourceGone extends Error {}

const sha256File = async (file: string) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
};

/** Finds a file by exact name anywhere under `dir`. */
async function findFile(dir: string, name: string): Promise<string | null> {
  for (const entry of await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile() && entry.name === name) {
      return path.join(entry.parentPath, entry.name);
    }
  }
  return null;
}

/** Bytes on disk under `dir`, links counted as themselves. */
async function sizeOf(dir: string): Promise<number> {
  let total = 0;
  for (const entry of await fs.readdir(dir, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      total += (await fs.lstat(path.join(entry.parentPath, entry.name))).size;
    }
  }
  return total;
}

/** `relative` under `root`, refusing any path that climbs out of it. */
function inside(root: string, relative: string) {
  const full = path.resolve(root, relative);
  if (
    full !== path.resolve(root) &&
    !full.startsWith(path.resolve(root) + path.sep)
  ) {
    throw new Error(`The toolkit names a file outside its folder: ${relative}`);
  }
  return full;
}

export class ToolkitInstaller extends EventEmitter<{
  state: [ToolkitId, ToolkitInstallState];
}> {
  private states = new Map<ToolkitId, ToolkitInstallState>();
  private controllers = new Map<ToolkitId, AbortController>();
  private lastProgress = new Map<ToolkitId, number>();
  /** Set while the app quits: stopped installs keep their resume marker. */
  private suspending = false;

  constructor(private readonly store: ToolkitStore) {
    super();
  }

  state(id: ToolkitId): ToolkitInstallState {
    return this.states.get(id) ?? { state: 'idle' };
  }

  busy(id: ToolkitId): boolean {
    return this.controllers.has(id);
  }

  cancel(id: ToolkitId): void {
    this.controllers.get(id)?.abort();
  }

  cancelAll(): void {
    for (const controller of this.controllers.values()) controller.abort();
  }

  /**
   * Stops every install because the app is quitting. Unlike a cancel, each
   * keeps its resume marker, so the next launch picks it up again.
   */
  suspendAll(): void {
    this.suspending = true;
    this.cancelAll();
  }

  private resumeFile(id: ToolkitId) {
    return path.join(this.store.root, `.resume-${id}`);
  }

  /**
   * Installs the app quit in the middle of, with the variant each was
   * installing, and clears away what they left half done: every staging
   * folder not in use. Call once at startup, before any install starts.
   */
  async interrupted(
    ids: readonly ToolkitId[],
  ): Promise<{ id: ToolkitId; variant: string }[]> {
    const found: { id: ToolkitId; variant: string }[] = [];
    for (const id of ids) {
      const entries = await fs.readdir(this.store.dirOf(id)).catch(() => []);
      for (const entry of entries) {
        if (!entry.startsWith('.staging-') || this.controllers.has(id))
          continue;
        await fs
          .rm(path.join(this.store.dirOf(id), entry), {
            recursive: true,
            force: true,
          })
          .catch(() => {});
      }
      const variant = await fs
        .readFile(this.resumeFile(id), 'utf8')
        .then((text) => text.trim())
        .catch(() => '');
      if (variant) found.push({ id, variant });
    }
    return found;
  }

  /** Forgets that an install was interrupted. */
  async forgetInterrupted(id: ToolkitId): Promise<void> {
    await fs.rm(this.resumeFile(id), { force: true });
  }

  /**
   * Installs `variant` of a toolkit from the first of `releases` that
   * answers; resolves with what is now installed.
   */
  async install(
    id: ToolkitId,
    variant: string,
    releases: ToolkitRelease[],
  ): Promise<InstalledToolkit> {
    if (this.controllers.has(id)) {
      throw new Error('This toolkit is already being installed.');
    }
    if (releases.length === 0) {
      throw new Error('This toolkit isn’t offered for this computer.');
    }
    const controller = new AbortController();
    this.controllers.set(id, controller);
    const staging = path.join(this.store.dirOf(id), `.staging-${randomUUID()}`);
    try {
      await fs.mkdir(staging, { recursive: true });
      // Removed again however this ends, unless the app is quitting.
      await fs.writeFile(this.resumeFile(id), variant);
      const installed = await this.installFrom(
        id,
        variant,
        releases,
        staging,
        controller.signal,
      );
      this.setState(id, { state: 'idle' });
      return installed;
    } catch (error) {
      const canceled = controller.signal.aborted;
      this.setState(
        id,
        canceled
          ? { state: 'idle' }
          : {
              state: 'error',
              message: error instanceof Error ? error.message : String(error),
            },
      );
      throw canceled ? new InstallCanceled() : error;
    } finally {
      this.controllers.delete(id);
      if (!this.suspending) await this.forgetInterrupted(id).catch(() => {});
      await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Deletes every installed build of a toolkit. */
  async remove(id: ToolkitId): Promise<void> {
    if (this.controllers.has(id)) {
      throw new Error('This toolkit is still being installed.');
    }
    await fs.rm(this.store.pointerFile(id), { force: true });
    await this.removeBuilds(id, null);
    this.setState(id, { state: 'idle' });
  }

  private async installFrom(
    id: ToolkitId,
    variant: string,
    releases: ToolkitRelease[],
    staging: string,
    signal: AbortSignal,
  ) {
    let lastError: unknown = null;
    for (const release of releases) {
      const dir = path.join(staging, randomUUID());
      try {
        const out = await this.fetchRelease(id, release, dir, signal);
        await this.check(id, release, out, signal);
        return await this.activate(id, variant, release, out);
      } catch (error) {
        if (!(error instanceof SourceGone)) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error('No download source answered.');
  }

  /** Downloads, checks and unpacks every archive of a release; resolves with
   *  the folder laid out as the toolkit will be. */
  private async fetchRelease(
    id: ToolkitId,
    release: ToolkitRelease,
    dir: string,
    signal: AbortSignal,
  ): Promise<string> {
    const downloads = path.join(dir, 'downloads');
    await fs.mkdir(downloads, { recursive: true });

    const total = release.archives.reduce((sum, item) => sum + item.size, 0);
    let received = 0;
    this.setState(id, { state: 'downloading', received, total });
    const files: string[] = [];
    for (const [index, archive] of release.archives.entries()) {
      const file = path.join(
        downloads,
        `${index}-${path.basename(new URL(archive.url).pathname)}`,
      );
      await this.download(archive.url, file, signal, (bytes) => {
        received += bytes;
        this.setState(id, { state: 'downloading', received, total });
      });
      files.push(file);
    }

    this.setState(id, { state: 'verifying' });
    for (const [index, archive] of release.archives.entries()) {
      const expected = await this.expectedHash(archive, signal);
      const actual = await sha256File(files[index]);
      if (actual !== expected) {
        throw new Error(
          `The download from ${release.host} didn’t match its checksum, so it wasn’t installed.`,
        );
      }
    }

    this.setState(id, { state: 'extracting' });
    const out = path.join(dir, 'out');
    await fs.mkdir(out);
    for (const [index, archive] of release.archives.entries()) {
      if (signal.aborted) throw new InstallCanceled();
      const unpacked = path.join(dir, 'unpacked', String(index));
      await fs.mkdir(unpacked, { recursive: true });
      await unpack(files[index], unpacked);
      await place(archive, unpacked, out);
    }

    for (const file of Object.values(release.binaries)) {
      const full = inside(out, file);
      try {
        await fs.access(full);
      } catch {
        throw new Error(`The download has no ${path.basename(file)}.`);
      }
      if (process.platform !== 'win32') await fs.chmod(full, 0o755);
    }
    if (process.platform === 'darwin') {
      // Only set when a browser saved the file, but cleared anyway: a
      // quarantined program (or library it loads) is refused when spawned.
      spawnSync('xattr', ['-dr', 'com.apple.quarantine', out]);
    }
    return out;
  }

  /** Runs each program as the release says, before anything switches. */
  private async check(
    id: ToolkitId,
    release: ToolkitRelease,
    out: string,
    signal: AbortSignal,
  ) {
    this.setState(id, { state: 'checking' });
    for (const check of release.checks) {
      if (signal.aborted) throw new InstallCanceled();
      await runCheck(check, release, out, signal);
    }
  }

  /** Moves the checked build into place and switches jobs over to it. */
  private async activate(
    id: ToolkitId,
    variant: string,
    release: ToolkitRelease,
    out: string,
  ): Promise<InstalledToolkit> {
    const folder = `${variant}-${release.version.replace(/[^\w.-]/g, '_')}-${Date.now()}`;
    const target = path.join(this.store.dirOf(id), folder);
    await fs.rename(out, target);
    const size = await sizeOf(target).catch(() => null);
    this.store.writePointer(id, {
      variant,
      version: release.version,
      dir: folder,
      binaries: release.binaries,
      size,
    });
    await this.removeBuilds(id, folder);
    const installed = this.store.installed(id);
    if (installed?.source !== 'user') {
      throw new Error('The toolkit was installed but can’t be found.');
    }
    return installed;
  }

  /** Deletes build folders other than `keep`. A running job may still hold
   *  one open on Windows; it is then left for the next removal. */
  private async removeBuilds(id: ToolkitId, keep: string | null) {
    const dir = this.store.dirOf(id);
    const entries = await fs.readdir(dir).catch(() => []);
    for (const entry of entries) {
      if (entry === keep || entry === 'current.json') continue;
      if (entry.startsWith('.staging-') && this.controllers.has(id)) continue;
      await fs
        .rm(path.join(dir, entry), { recursive: true, force: true })
        .catch(() => {});
    }
  }

  private async expectedHash(archive: ToolkitArchive, signal: AbortSignal) {
    if (typeof archive.sha256 === 'string') return archive.sha256;
    const { checksumsUrl, name } = archive.sha256;
    const response = await fetch(checksumsUrl, { signal });
    if (!response.ok) {
      throw new Error(`Couldn’t fetch checksums (HTTP ${response.status}).`);
    }
    for (const line of (await response.text()).split('\n')) {
      const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
      if (match?.[2] === name) return match[1].toLowerCase();
    }
    throw new Error(`No published checksum for ${name}.`);
  }

  private async download(
    url: string,
    file: string,
    signal: AbortSignal,
    onBytes: (bytes: number) => void,
  ) {
    const response = await fetch(url, { signal, redirect: 'follow' });
    if (response.status === 404 || response.status === 410) {
      throw new SourceGone(`${url} is no longer available.`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (HTTP ${response.status}).`);
    }
    // Streamed to disk: archives run to 200 MB.
    const count = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        onBytes(chunk.length);
        done(null, chunk);
      },
    });
    await pipeline(
      Readable.fromWeb(
        response.body as import('node:stream/web').ReadableStream,
      ),
      count,
      createWriteStream(file),
      { signal },
    );
  }

  private setState(id: ToolkitId, state: ToolkitInstallState) {
    this.states.set(id, state);
    // Byte counts arrive per network chunk; a few updates a second is enough.
    if (state.state === 'downloading') {
      const now = Date.now();
      const last = this.lastProgress.get(id) ?? 0;
      if (now - last < 150 && state.received < (state.total ?? 0)) return;
      this.lastProgress.set(id, now);
    }
    this.emit('state', id, state);
  }
}

/** Unpacks a .zip with extract-zip, anything else with the system tar
 *  (Node can't read xz; tar can on macOS, Linux and Windows 10+). */
async function unpack(file: string, into: string) {
  if (file.endsWith('.zip')) {
    await extractZip(file, { dir: into });
    return;
  }
  const result = spawnSync('tar', ['-xf', file, '-C', into]);
  if (result.status !== 0) throw new Error('Couldn’t unpack the download.');
}

/** Moves an unpacked archive's files into the toolkit's folder. */
async function place(archive: ToolkitArchive, unpacked: string, out: string) {
  const target = inside(out, archive.into ?? '');
  await fs.mkdir(target, { recursive: true });
  if (archive.pick) {
    for (const pick of archive.pick) {
      const found = await findFile(unpacked, pick.name);
      if (!found) {
        if (pick.optional) continue;
        throw new Error(`The download has no ${pick.name}.`);
      }
      const to = inside(target, pick.as ?? pick.name);
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.rename(found, to);
    }
  } else {
    for (const entry of await fs.readdir(unpacked)) {
      await fs.rename(path.join(unpacked, entry), inside(target, entry));
    }
  }
  for (const [from, to] of Object.entries(archive.rename ?? {})) {
    await fs.rename(inside(target, from), inside(target, to));
  }
}

async function runCheck(
  check: ToolkitCheck,
  release: ToolkitRelease,
  out: string,
  signal: AbortSignal,
) {
  const relative = release.binaries[check.binary];
  if (!relative) throw new Error(`The toolkit has no ${check.binary}.`);
  const program = inside(out, relative);
  const output: string[] = [];
  const result = await run(program, check.args, {
    onStdout: (line) => output.push(line),
    onStderr: (line) => output.push(line),
    // A first run of a large program can be slow (antivirus scans,
    // Gatekeeper's first check); give it time.
    timeoutMs: 120_000,
    signal,
  }).catch(() => null);
  if (signal.aborted) throw new InstallCanceled();
  const name = path.basename(relative);
  if (result?.code !== 0) {
    throw new Error(`The downloaded ${name} doesn’t run on this computer.`);
  }
  const text = output.join('\n');
  const fails =
    (check.expect && !new RegExp(check.expect, 'm').test(text)) ||
    (check.forbid && new RegExp(check.forbid, 'm').test(text));
  if (fails) {
    throw new Error(
      check.message ?? `The downloaded ${name} isn’t the expected build.`,
    );
  }
}
