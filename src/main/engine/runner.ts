// Spawns a child (yt-dlp or ffmpeg) with an argv array, never a shell, and
// streams its output as whole lines. Cancelling kills the whole process
// tree: yt-dlp starts ffmpeg and others, and killing only yt-dlp would leave
// ffmpeg writing the file after the user clicked Cancel.
import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export type RunOptions = {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
  /** Aborting kills the process tree; run() then resolves with killed. */
  signal?: AbortSignal;
  /** Hard timeout in ms (probes and health checks, never downloads). */
  timeoutMs?: number;
  /** Folders to put at the front of PATH. */
  prependPath?: string[];
  cwd?: string;
};

export type RunResult = {
  code: number | null;
  /** True if we killed it, so the caller can ignore the exit code. */
  killed: boolean;
  timedOut: boolean;
  /** The last ~50 stderr lines, for errors and "Copy debug info". */
  stderrTail: string[];
};

const stderrLimit = 50;

/** Buffers a byte stream into lines, even when a chunk splits a character. */
function lineSplitter(onLine: (line: string) => void) {
  const decoder = new StringDecoder('utf8');
  let carry = '';
  return {
    push(chunk: Buffer) {
      carry += decoder.write(chunk);
      let nl: number;
      while ((nl = carry.indexOf('\n')) !== -1) {
        const line = carry.slice(0, nl).replace(/\r/g, '');
        carry = carry.slice(nl + 1);
        if (line.length > 0) onLine(line);
      }
    },
    end() {
      const line = (carry + decoder.end()).replace(/\r/g, '');
      carry = '';
      if (line.length > 0) onLine(line);
    },
  };
}

/**
 * Kills a process and everything it started. On Windows `taskkill /T` walks
 * the tree; elsewhere the child leads its own process group, so signalling
 * the negative pid reaches the group. SIGINT first, so yt-dlp stops like
 * Ctrl+C with its .part files intact; SIGKILL after 3 s.
 */
export function killTree(child: ChildProcess): void {
  const pid = child.pid;
  if (pid === undefined || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      windowsHide: true,
    });
    return;
  }
  const signalGroup = (signal: NodeJS.Signals) => {
    try {
      process.kill(-pid, signal);
    } catch {
      // Already gone.
    }
  };
  signalGroup('SIGINT');
  const force = setTimeout(() => signalGroup('SIGKILL'), 3000);
  force.unref();
  child.once('exit', () => clearTimeout(force));
}

/** Runs a program and resolves when it exits; never rejects on exit codes. */
export function run(
  executable: string,
  args: string[],
  opts: RunOptions = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      // Without these, Python on Windows uses the console code page and
      // titles with emoji or CJK come out garbled.
      PYTHONUTF8: '1',
      PYTHONIOENCODING: 'utf-8',
      // Progress lines arrive as they happen, not in bursts.
      PYTHONUNBUFFERED: '1',
    };
    if (opts.prependPath?.length) {
      const key =
        Object.keys(env).find((name) => name.toLowerCase() === 'path') ??
        'PATH';
      env[key] = [...opts.prependPath, env[key] ?? ''].join(path.delimiter);
    }

    let child: ChildProcess;
    try {
      child = spawn(executable, args, {
        env,
        cwd: opts.cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        // Own process group on POSIX, so killTree reaches ffmpeg too.
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      reject(error);
      return;
    }

    const stderrTail: string[] = [];
    let killed = false;
    let timedOut = false;

    const out = lineSplitter((line) => opts.onStdout?.(line));
    const errors = lineSplitter((line) => {
      stderrTail.push(line);
      if (stderrTail.length > stderrLimit) stderrTail.shift();
      opts.onStderr?.(line);
    });
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr?.on('data', (chunk: Buffer) => errors.push(chunk));

    const abort = () => {
      killed = true;
      killTree(child);
    };
    if (opts.signal) {
      if (opts.signal.aborted) abort();
      else opts.signal.addEventListener('abort', abort, { once: true });
    }
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            abort();
          }, opts.timeoutMs);

    const settle = () => {
      if (timer) clearTimeout(timer);
      opts.signal?.removeEventListener('abort', abort);
    };
    // The executable couldn't start at all (missing, not executable,
    // blocked by antivirus).
    child.once('error', (error) => {
      settle();
      reject(error);
    });
    // "close", not "exit": it waits until stdout is drained, so the final
    // file path line is never lost.
    child.once('close', (code) => {
      settle();
      out.end();
      errors.end();
      resolve({ code, killed, timedOut, stderrTail });
    });
  });
}

/** Runs `yt-dlp --version`, as a startup health check. */
export async function ytdlpVersion(executable: string): Promise<string> {
  let version = '';
  const result = await run(executable, ['--version'], {
    onStdout: (line) => (version = line.trim()),
    timeoutMs: 30_000,
  });
  if (result.code !== 0 || !/^\d{4}\.\d{2}\.\d{2}/.test(version)) {
    throw new Error(
      `yt-dlp health check failed (exit ${result.code}): ${result.stderrTail.join('\n')}`,
    );
  }
  return version;
}
