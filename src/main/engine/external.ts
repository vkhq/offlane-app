// yt-dlp as the person installed it: the app never ships or downloads it
// (see src/shared/externalTools.ts). This finds it, checks it runs, and
// keeps whether Download Video is turned on, which is the person's choice
// and off until they make it.
//
// Whatever yt-dlp itself needs is the person's to install, as for using it
// in a terminal; the app only makes sure yt-dlp runs as it would there. A
// Mac app opened from the Finder gets only /usr/bin:/bin:/usr/sbin:/sbin as
// its PATH, so the PATH of the person's login shell is read and used, both
// to find yt-dlp and to run it, with the folders package managers install
// into as a fallback. The person can also pick the file themselves.
//
// No Electron import, so the integration tests can use it with plain Node.
import { execFile } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { accessSync, constants, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type {
  ExternalToolId,
  ExternalToolsStatus,
} from '../../shared/externalTools';
import { exeName, isFile } from '../files';
import { JsonFile } from '../storage/json-file';
import { run } from './runner';

/** What external-tools.json keeps. */
type Saved = {
  /** yt-dlp's file as the person picked it; empty to find it. */
  ytdlpPath?: string;
  /** Download Video is turned on. */
  ytdlpEnabled?: boolean;
};

/** Download Video was used while turned off, or with no yt-dlp found. */
export class ExternalToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExternalToolError';
  }
}

/** The Python user folders pip installs scripts into on a Mac. */
function pythonUserBins(home: string): string[] {
  const root = path.join(home, 'Library', 'Python');
  try {
    return readdirSync(root).map((version) => path.join(root, version, 'bin'));
  } catch {
    return [];
  }
}

/**
 * Where to look, in order: PATH, then the folders Homebrew, MacPorts, pip,
 * pipx, pyenv, asdf, mise, winget, Scoop, Chocolatey and Snap put programs
 * in, which a Finder-opened app's PATH leaves out.
 */
export function searchDirs(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string[] {
  const pathVar =
    Object.entries(env).find(([name]) => name.toLowerCase() === 'path')?.[1] ??
    '';
  const fromPath = pathVar.split(path.delimiter);
  const extra =
    platform === 'win32'
      ? [
          env.LOCALAPPDATA &&
            path.join(env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links'),
          path.join(home, 'scoop', 'shims'),
          env.ProgramData && path.join(env.ProgramData, 'chocolatey', 'bin'),
        ]
      : [
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/opt/local/bin',
          path.join(home, '.local', 'bin'),
          path.join(home, 'bin'),
          // Version managers' shims: pyenv, asdf, mise.
          path.join(home, '.pyenv', 'shims'),
          path.join(home, '.asdf', 'shims'),
          path.join(home, '.local', 'share', 'mise', 'shims'),
          ...(platform === 'darwin' ? pythonUserBins(home) : []),
          '/usr/bin',
          '/snap/bin',
        ];
  const dirs = [...fromPath, ...extra].filter(
    (dir): dir is string => !!dir && path.isAbsolute(dir),
  );
  return [...new Set(dirs)];
}

let shellPath: Promise<string[]> | null = null;

/**
 * The PATH a terminal gets, read once from the person's login shell, so
 * yt-dlp finds what it needs as it would there. Empty on Windows, where
 * apps get the full PATH anyway, or if the shell doesn't answer in time.
 */
export function loginShellPath(): Promise<string[]> {
  if (process.platform === 'win32') return Promise.resolve([]);
  shellPath ??= new Promise((resolve) => {
    // Marked, so whatever the shell's start-up files print is ignored.
    const mark = '__OFFLANE_PATH__';
    execFile(
      process.env.SHELL || '/bin/zsh',
      ['-ilc', `printf '${mark}%s${mark}' "$PATH"`],
      { timeout: 5000, encoding: 'utf8' },
      (_error, stdout) => {
        const found = new RegExp(`${mark}(.*)${mark}`).exec(stdout ?? '')?.[1];
        resolve((found ?? '').split(':').filter((dir) => path.isAbsolute(dir)));
      },
    );
  });
  return shellPath;
}

const isExecutable = (file: string) => {
  if (!isFile(file)) return false;
  if (process.platform === 'win32') return true;
  try {
    accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** The first `name` in `dirs` that is a program, or null. */
export function findProgram(name: string, dirs: string[]): string | null {
  for (const dir of dirs) {
    const file = path.join(dir, exeName(name));
    if (isExecutable(file)) return file;
  }
  return null;
}

/**
 * Runs `<file> --version` and returns the version `pattern` finds in its
 * first line, or throws why it can't be used.
 */
async function versionOf(file: string, pattern: RegExp): Promise<string> {
  const lines: string[] = [];
  let result;
  try {
    result = await run(file, ['--version'], {
      onStdout: (line) => lines.push(line),
      // A Python yt-dlp found by `#!/usr/bin/env python3` needs its own
      // folder on PATH; the first run of a bundled one unpacks itself.
      prependPath: [path.dirname(file)],
      timeoutMs: 30_000,
    });
  } catch (error) {
    throw new Error(
      `It didn’t start (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  const version = pattern.exec(lines[0]?.trim() ?? '')?.[1];
  if (result.code !== 0 || !version) {
    throw new Error(
      result.timedOut
        ? 'It didn’t answer within 30 seconds.'
        : 'It didn’t answer as expected when asked its version.',
    );
  }
  return version;
}

const ytdlpVersion = /^(\d{4}\.\d{2}\.\d{2}[\w.]*)/;

export class ExternalTools extends EventEmitter<{
  changed: [ExternalToolsStatus];
}> {
  private readonly file: JsonFile<Saved>;
  private saved: Saved;
  private state: ExternalToolsStatus;
  private scanning: Promise<ExternalToolsStatus> | null = null;
  /** Where programs were looked for, which yt-dlp also gets as its PATH. */
  private dirs: string[] = [];

  constructor(
    private readonly opts: {
      /** <userData>/external-tools.json */
      file: string;
      /** Folders searched before all others: a development checkout's
       *  vendor/, or the offline tests' fake yt-dlp. */
      firstDirs?: string[];
    },
  ) {
    super();
    this.file = new JsonFile(opts.file, 0);
    const saved = this.file.read({});
    this.saved = {
      ytdlpPath:
        typeof saved.ytdlpPath === 'string' && path.isAbsolute(saved.ytdlpPath)
          ? saved.ytdlpPath
          : '',
      ytdlpEnabled: saved.ytdlpEnabled === true,
    };
    this.state = {
      ytdlp: { found: null, problem: null, enabled: false },
      scanning: true,
    };
  }

  status(): ExternalToolsStatus {
    const { ytdlp } = this.state;
    return {
      ...this.state,
      // On only while there is a yt-dlp to run.
      ytdlp: { ...ytdlp, enabled: !!this.saved.ytdlpEnabled && !!ytdlp.found },
    };
  }

  /** Looks for yt-dlp and checks it runs. One look at a time. */
  scan(): Promise<ExternalToolsStatus> {
    this.scanning ??= this.look().finally(() => {
      this.scanning = null;
    });
    return this.scanning;
  }

  private async look(): Promise<ExternalToolsStatus> {
    this.state = { ...this.state, scanning: true };
    this.emitChanged();
    const dirs = [
      ...new Set([
        ...(this.opts.firstDirs ?? []),
        ...(await loginShellPath()),
        ...searchDirs(),
      ]),
    ];
    this.dirs = dirs;
    const chosen = this.saved.ytdlpPath || '';
    const ytdlpFile = chosen || findProgram('yt-dlp', dirs);

    let ytdlp: ExternalToolsStatus['ytdlp'] = {
      found: null,
      problem: null,
      enabled: false,
    };
    if (ytdlpFile && !isExecutable(ytdlpFile)) {
      ytdlp.problem = `${ytdlpFile} is gone, or isn’t a program.`;
    } else if (ytdlpFile) {
      try {
        const version = await versionOf(ytdlpFile, ytdlpVersion);
        ytdlp.found = { path: ytdlpFile, version, chosen: !!chosen };
      } catch (error) {
        ytdlp = { ...ytdlp, problem: (error as Error).message };
      }
    }
    this.state = { ytdlp, scanning: false };
    this.emitChanged();
    return this.status();
  }

  /** Uses `file` as yt-dlp, if it runs as one; otherwise keeps the last. */
  async choose(file: string): Promise<ExternalToolsStatus> {
    if (!path.isAbsolute(file)) throw new Error('Not a file on this computer');
    try {
      await versionOf(file, ytdlpVersion);
    } catch (error) {
      throw new Error(
        `${path.basename(file)} doesn’t look like yt-dlp. ${(error as Error).message}`,
      );
    }
    this.save({ ytdlpPath: file });
    return this.scan();
  }

  forgetChosen(): Promise<ExternalToolsStatus> {
    this.save({ ytdlpPath: '' });
    return this.scan();
  }

  setEnabled(id: ExternalToolId, on: boolean): ExternalToolsStatus {
    if (id !== 'ytdlp') throw new Error('Unknown program');
    if (on && !this.state.ytdlp.found) {
      throw new Error('yt-dlp isn’t on this computer, so this can’t be on.');
    }
    this.save({ ytdlpEnabled: on });
    this.emitChanged();
    return this.status();
  }

  /** Back to off, finding everything on its own (Erase Everything). */
  reset() {
    this.save({ ytdlpPath: '', ytdlpEnabled: false });
    this.emitChanged();
  }

  /**
   * yt-dlp for a job, and the folders for its PATH: its own, then the
   * person's terminal's. Throws ExternalToolError while Download Video is
   * off or yt-dlp is gone, so no job runs without it.
   */
  forJob(): { ytdlp: string; pathDirs: string[] } {
    const { ytdlp } = this.status();
    if (!ytdlp.enabled) {
      throw new ExternalToolError(
        ytdlp.found
          ? 'Download Video is turned off. Turn it on in Settings › Toolkits.'
          : 'yt-dlp isn’t on this computer. Install it, then turn Download Video on in Settings › Toolkits.',
      );
    }
    const file = ytdlp.found?.path ?? '';
    if (!isExecutable(file)) {
      void this.scan();
      throw new ExternalToolError(
        'yt-dlp is no longer where it was. Look for it again in Settings › Toolkits.',
      );
    }
    return {
      ytdlp: file,
      pathDirs: [...new Set([path.dirname(file), ...this.dirs])],
    };
  }

  private save(patch: Saved) {
    this.saved = { ...this.saved, ...patch };
    this.file.write(this.saved);
    this.file.flush();
  }

  private emitChanged() {
    this.emit('changed', this.status());
  }
}
