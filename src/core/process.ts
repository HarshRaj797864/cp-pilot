import { ChildProcess, spawn } from 'node:child_process';

export interface ProcessOptions {
  command: string;
  cwd: string;
  input?: string;
  /** Kill the process (and its children) after this many milliseconds. */
  timeoutMs?: number;
  /** Kill the process once stdout + stderr exceed this size. */
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface ProcessResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timeMs: number;
  timedOut: boolean;
  aborted: boolean;
  outputTruncated: boolean;
  /** Set when the process couldn't be started at all. */
  spawnError?: string;
}

const DEFAULT_MAX_OUTPUT = 16 * 1024 * 1024;

/** Runs a shell command, feeding `input` on stdin, with timeout, output cap and cancellation. */
export function runProcess(opts: ProcessOptions): Promise<ProcessResult> {
  const maxOutput = opts.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;

  return new Promise((resolve) => {
    const start = performance.now();
    const child = spawn(opts.command, {
      cwd: opts.cwd,
      shell: true,
      // Own process group on POSIX so the whole tree can be killed at once.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let outputBytes = 0;
    let timedOut = false;
    let aborted = false;
    let outputTruncated = false;
    let finished = false;

    const collect = (target: Buffer[]) => (chunk: Buffer) => {
      if (outputTruncated) return;
      outputBytes += chunk.length;
      if (outputBytes > maxOutput) {
        outputTruncated = true;
        killTree(child);
        return;
      }
      target.push(chunk);
    };
    child.stdout!.on('data', collect(stdout));
    child.stderr!.on('data', collect(stderr));

    const timer =
      opts.timeoutMs !== undefined
        ? setTimeout(() => {
            timedOut = true;
            killTree(child);
          }, opts.timeoutMs)
        : undefined;

    const onAbort = () => {
      aborted = true;
      killTree(child);
    };
    opts.signal?.addEventListener('abort', onAbort, { once: true });

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null, spawnError?: string) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onAbort);
      resolve({
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
        exitCode,
        signal,
        timeMs: Math.round(performance.now() - start),
        timedOut,
        aborted,
        outputTruncated,
        spawnError,
      });
    };
    child.on('error', (err) => finish(null, null, err.message));
    child.on('close', (code, signal) => finish(code, signal));

    // The program may exit without reading all of stdin; that's not an error.
    child.stdin!.on('error', () => {});
    child.stdin!.end(opts.input ?? '');

    if (opts.signal?.aborted) onAbort();
  });
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } else {
      process.kill(-child.pid, 'SIGKILL');
    }
  } catch {
    // Already exited.
  }
}
