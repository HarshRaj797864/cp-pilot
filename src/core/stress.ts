import * as path from 'node:path';
import { Verdict, effectiveTimeLimit, hardTimeout, judgeTest } from './judge';
import { LanguageCommands, resolveCommands } from './languages';
import { runProcess } from './process';
import { compile } from './runner';

export interface StressProgram {
  file: string;
  commands: LanguageCommands;
}

export interface StressOptions {
  solution: StressProgram;
  brute: StressProgram;
  /** Reads a seed on stdin, prints one test. */
  generator: StressProgram;
  timeLimitMs: number;
  /** Stop after this many passing tests… */
  iterations: number;
  /** …or after this long, whichever comes first. */
  timeBudgetMs?: number;
  firstSeed?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export type StressResult =
  | { kind: 'found'; seed: number; input: string; expected: string; received: string; verdict: Verdict; message?: string }
  | { kind: 'passed'; iterations: number }
  | { kind: 'stopped'; iterations: number }
  | { kind: 'broken'; program: 'solution' | 'brute' | 'generator'; message: string; input?: string };

const DEFAULT_BUDGET_MS = 60_000;
const GENERATOR_TIMEOUT_MS = 5000;

/**
 * Classic stress testing: generate random small tests, compare the solution with a brute force,
 * and report the first test where they disagree (or where the solution crashes or times out).
 */
export async function stressTest(opts: StressOptions): Promise<StressResult> {
  const programs = { solution: opts.solution, brute: opts.brute, generator: opts.generator } as const;
  const resolved = {} as Record<keyof typeof programs, ReturnType<typeof resolveCommands>>;

  for (const name of ['generator', 'brute', 'solution'] as const) {
    const program = programs[name];
    resolved[name] = resolveCommands(program.file, program.commands);
    const compiled = await compile(program.file, resolved[name], opts.signal);
    if (opts.signal?.aborted) return { kind: 'stopped', iterations: 0 };
    if (!compiled.ok) return { kind: 'broken', program: name, message: `Compilation failed:\n${compiled.output}` };
  }

  const timeLimit = effectiveTimeLimit(opts.timeLimitMs);
  const bruteTimeout = Math.max(timeLimit * 10, 10_000);
  const deadline = Date.now() + (opts.timeBudgetMs ?? DEFAULT_BUDGET_MS);
  const firstSeed = opts.firstSeed ?? 1;
  const run = (name: keyof typeof programs, input: string, timeoutMs: number) =>
    runProcess({ command: resolved[name].run, cwd: path.dirname(programs[name].file), input, timeoutMs, signal: opts.signal });

  for (let i = 0; i < opts.iterations; i++) {
    if (Date.now() > deadline) return { kind: 'passed', iterations: i };
    const seed = firstSeed + i;

    const gen = await run('generator', `${seed}\n`, GENERATOR_TIMEOUT_MS);
    if (gen.aborted) return { kind: 'stopped', iterations: i };
    if (gen.exitCode !== 0 || gen.timedOut || !gen.stdout.trim()) {
      return { kind: 'broken', program: 'generator', message: describeFailure(gen, `seed ${seed}`) };
    }
    const input = gen.stdout;

    const brute = await run('brute', input, bruteTimeout);
    if (brute.aborted) return { kind: 'stopped', iterations: i };
    if (brute.exitCode !== 0 || brute.timedOut) {
      return { kind: 'broken', program: 'brute', message: describeFailure(brute, 'this input'), input };
    }

    const solution = await run('solution', input, hardTimeout(timeLimit));
    if (solution.aborted) return { kind: 'stopped', iterations: i };
    const result = judgeTest({ input, output: brute.stdout }, solution, timeLimit);
    if (result.verdict !== 'AC') {
      return {
        kind: 'found',
        seed,
        input,
        expected: brute.stdout,
        received: solution.stdout,
        verdict: result.verdict,
        message: result.message,
      };
    }
    opts.onProgress?.(i + 1, opts.iterations);
  }
  return { kind: 'passed', iterations: opts.iterations };
}

function describeFailure(r: Awaited<ReturnType<typeof runProcess>>, on: string): string {
  if (r.timedOut) return `Timed out on ${on}.`;
  if (r.spawnError) return r.spawnError;
  const why = r.exitCode !== 0 ? `Exited with code ${r.exitCode} on ${on}.` : `Printed nothing on ${on}.`;
  return r.stderr.trim() ? `${why}\n${r.stderr.trim().slice(0, 2000)}` : why;
}
