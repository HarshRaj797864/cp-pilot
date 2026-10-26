import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TestResult, effectiveTimeLimit, hardTimeout, judgeTest } from './judge';
import { LanguageCommands, ResolvedCommands, resolveCommands } from './languages';
import { runProcess } from './process';
import { Problem, TestCase } from './problem';

const COMPILE_TIMEOUT_MS = 60_000;

export type CompileResult = { ok: true; skipped: boolean } | { ok: false; output: string };

export interface RunOptions {
  file: string;
  tests: TestCase[];
  /** Which tests to run; all when omitted. */
  indices?: number[];
  timeLimitMs: number;
  commands: LanguageCommands;
  io?: Problem['io'];
  onCompileStart?: () => void;
  onCompileEnd?: (result: CompileResult) => void;
  onTestStart?: (index: number) => void;
  onTestEnd?: (index: number, result: TestResult) => void;
}

/** Compiles a solution (if needed) and runs it against tests, one at a time. One run at a time. */
export class TestRunner {
  private controller: AbortController | undefined;

  get running(): boolean {
    return this.controller !== undefined;
  }

  async run(opts: RunOptions): Promise<void> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    const { signal } = controller;

    try {
      const resolved = resolveCommands(opts.file, opts.commands);
      opts.onCompileStart?.();
      const compiled = await compile(opts.file, resolved, signal);
      if (signal.aborted) return;
      opts.onCompileEnd?.(compiled);
      if (!compiled.ok) return;

      const timeLimit = effectiveTimeLimit(opts.timeLimitMs);
      const indices = opts.indices ?? opts.tests.map((_, i) => i);
      for (const i of indices) {
        const test = opts.tests[i];
        if (!test) continue;
        opts.onTestStart?.(i);
        const result = await runTest(resolved.run, opts.file, test, timeLimit, opts.io, signal);
        if (!result) return;
        opts.onTestEnd?.(i, result);
      }
    } finally {
      if (this.controller === controller) this.controller = undefined;
    }
  }

  stop(): void {
    this.controller?.abort();
    this.controller = undefined;
  }
}

/**
 * Runs one test; undefined if cancelled. File I/O problems run in a fresh temporary folder
 * holding the input file, like on the judge, so the solution's folder isn't littered.
 */
async function runTest(
  command: string,
  file: string,
  test: TestCase,
  timeLimit: number,
  io: Problem['io'],
  signal: AbortSignal,
): Promise<TestResult | undefined> {
  const usesFiles = Boolean(io?.inputFile || io?.outputFile);
  const cwd = usesFiles ? await fs.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-run-')) : path.dirname(file);
  try {
    if (io?.inputFile) await fs.writeFile(path.join(cwd, io.inputFile), test.input);
    // stdin gets the input too, so solutions that ignore the file still run.
    const run = await runProcess({ command, cwd, input: test.input, timeoutMs: hardTimeout(timeLimit), signal });
    if (run.aborted) return undefined;
    if (!io?.outputFile) return judgeTest(test, run, timeLimit);

    let output: string;
    try {
      output = await fs.readFile(path.join(cwd, io.outputFile), 'utf8');
    } catch {
      const result = judgeTest(test, run, timeLimit);
      if (result.verdict === 'TLE' || result.verdict === 'RE') return result;
      return { ...result, verdict: 'WA', message: `No ${io.outputFile} was written (this problem uses file output)` };
    }
    return judgeTest(test, { ...run, stdout: output }, timeLimit);
  } finally {
    if (usesFiles) await fs.rm(cwd, { recursive: true, force: true });
  }
}

/**
 * Compiles unless the existing binary is newer than the source and was built with the
 * same command (stored next to the binary), so re-running tests is instant.
 */
export async function compile(file: string, resolved: ResolvedCommands, signal?: AbortSignal): Promise<CompileResult> {
  if (!resolved.compile) return { ok: true, skipped: true };

  const stampFile = `${resolved.exe}.cmd`;
  if (await isUpToDate(file, resolved.exe, stampFile, resolved.compile)) return { ok: true, skipped: true };

  await fs.mkdir(path.dirname(resolved.exe), { recursive: true });
  await fs.rm(stampFile, { force: true });
  const result = await runProcess({
    command: resolved.compile,
    cwd: path.dirname(file),
    timeoutMs: COMPILE_TIMEOUT_MS,
    signal,
  });

  if (result.timedOut) return { ok: false, output: `Compilation timed out after ${COMPILE_TIMEOUT_MS / 1000}s` };
  if (result.spawnError) return { ok: false, output: result.spawnError };
  if (result.exitCode !== 0) {
    return { ok: false, output: (result.stderr + result.stdout).trim() || `Compiler exited with code ${result.exitCode}` };
  }
  await fs.writeFile(stampFile, resolved.compile, 'utf8');
  return { ok: true, skipped: false };
}

async function isUpToDate(file: string, exe: string, stampFile: string, command: string): Promise<boolean> {
  try {
    const [src, bin, stamp] = await Promise.all([fs.stat(file), fs.stat(exe), fs.readFile(stampFile, 'utf8')]);
    return bin.mtimeMs >= src.mtimeMs && stamp === command;
  } catch {
    return false;
  }
}
