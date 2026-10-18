import * as os from 'node:os';
import { ProcessResult } from './process';
import { TestCase } from './problem';

export type Verdict = 'AC' | 'WA' | 'TLE' | 'RE';

export interface TestResult {
  verdict: Verdict;
  stdout: string;
  stderr: string;
  timeMs: number;
  /** Extra detail for non-AC verdicts, e.g. "Exit code 139". */
  message?: string;
}

/** Used when a problem has no time limit (e.g. tests added by hand). */
export const DEFAULT_TIME_LIMIT_MS = 3000;

export function effectiveTimeLimit(timeLimitMs: number): number {
  return timeLimitMs > 0 ? timeLimitMs : DEFAULT_TIME_LIMIT_MS;
}

/** How long to let a test run before killing it; generous so slow-but-finishing runs show their real time. */
export function hardTimeout(timeLimitMs: number): number {
  return Math.max(timeLimitMs * 2, timeLimitMs + 1000);
}

/** Whitespace-insensitive token comparison, like most judges' default checker. */
export function outputsMatch(expected: string, actual: string): boolean {
  const a = tokens(expected);
  const b = tokens(actual);
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

function tokens(s: string): string[] {
  return s.split(/\s+/).filter(Boolean);
}

export function judgeTest(
  test: TestCase,
  run: ProcessResult,
  timeLimitMs: number,
  platform: NodeJS.Platform = process.platform,
): TestResult {
  const base = { stdout: run.stdout, stderr: run.stderr, timeMs: run.timeMs };

  if (run.timedOut || run.timeMs > timeLimitMs) {
    return { ...base, verdict: 'TLE', message: `Time limit ${timeLimitMs} ms` };
  }
  if (run.spawnError) {
    return { ...base, verdict: 'RE', message: run.spawnError };
  }
  if (run.outputTruncated) {
    return { ...base, verdict: 'RE', message: 'Output limit exceeded' };
  }
  if (run.exitCode !== 0) {
    return { ...base, verdict: 'RE', message: crashMessage(run, platform) };
  }
  return { ...base, verdict: outputsMatch(test.output, run.stdout) ? 'AC' : 'WA' };
}

function crashMessage(run: ProcessResult, platform: NodeJS.Platform): string {
  // Java's single-file launcher compiles at run time, so compile errors surface as a failed run.
  if (/^error: compilation failed$/m.test(run.stderr)) return 'Compilation failed (see stderr)';
  if (run.signal) return `Killed by ${run.signal}`;
  // The shell reports a child killed by signal N as exit code 128 + N.
  if (platform !== 'win32' && run.exitCode !== null && run.exitCode > 128) {
    const name = Object.entries(os.constants.signals).find(([, n]) => n === run.exitCode! - 128)?.[0];
    if (name) return `Killed by ${name} (exit code ${run.exitCode})`;
  }
  return `Exit code ${run.exitCode}`;
}
