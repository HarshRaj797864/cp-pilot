import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TestResult } from '../src/core/judge';
import { LanguageCommands, resolveCommands } from '../src/core/languages';
import { runProcess } from '../src/core/process';
import { TestRunner, compile } from '../src/core/runner';

// Node stands in for a compiler so these tests run anywhere: "compiling" copies the source to ${exe}.
const node = JSON.stringify(process.execPath);
const COPY_COMPILE: LanguageCommands = {
  compile: `${node} -e "require('fs').copyFileSync(process.argv[1], process.argv[2])" \${file} \${exe}`,
  run: `${node} \${exe}`,
};

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-run-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

async function solution(code: string): Promise<string> {
  const file = path.join(dir, 'sol.js');
  await fs.writeFile(file, code);
  return file;
}

describe('runProcess', () => {
  it('feeds stdin and captures stdout, stderr and exit code', async () => {
    const r = await runProcess({
      command: `${node} -e "process.stdin.pipe(process.stdout); console.error('err'); process.exitCode = 3"`,
      cwd: dir,
      input: 'hello',
    });
    expect(r).toMatchObject({ stdout: 'hello', stderr: 'err\n', exitCode: 3, timedOut: false });
  });

  it('kills runaway processes on timeout', async () => {
    const r = await runProcess({ command: `${node} -e "for(;;){}"`, cwd: dir, timeoutMs: 300 });
    expect(r.timedOut).toBe(true);
    expect(r.timeMs).toBeLessThan(3000);
  });

  it('stops collecting at the output limit', async () => {
    const r = await runProcess({
      command: `${node} -e "for(;;) process.stdout.write('x'.repeat(1e4))"`,
      cwd: dir,
      maxOutputBytes: 100_000,
    });
    expect(r.outputTruncated).toBe(true);
    expect(r.stdout.length).toBeLessThanOrEqual(100_000);
  });

  it('can be cancelled', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const r = await runProcess({ command: `${node} -e "setInterval(()=>{},1000)"`, cwd: dir, signal: controller.signal });
    expect(r.aborted).toBe(true);
  });
});

describe('compile', () => {
  it('compiles once and skips while the source is unchanged', async () => {
    const file = await solution('console.log(1)');
    const resolved = resolveCommands(file, COPY_COMPILE);
    expect(await compile(file, resolved)).toEqual({ ok: true, skipped: false });
    expect(await compile(file, resolved)).toEqual({ ok: true, skipped: true });

    // Touch the source into the future: must rebuild.
    const future = new Date(Date.now() + 5000);
    await fs.utimes(file, future, future);
    expect(await compile(file, resolved)).toEqual({ ok: true, skipped: false });
  });

  it('reports compiler output on failure', async () => {
    const file = await solution('');
    const resolved = resolveCommands(file, { compile: `${node} -e "console.error('boom'); process.exit(1)"`, run: '' });
    expect(await compile(file, resolved)).toEqual({ ok: false, output: 'boom' });
  });
});

describe('TestRunner', () => {
  const readAll = "const s=require('fs').readFileSync(0,'utf8');";

  it('judges each test', async () => {
    const file = await solution(`${readAll} const n=+s; console.log(n===2 ? 5 : n*2)`);
    const results: TestResult[] = [];
    await new TestRunner().run({
      file,
      tests: [
        { input: '1', output: '2' },
        { input: '2', output: '4' },
      ],
      timeLimitMs: 2000,
      commands: COPY_COMPILE,
      onTestEnd: (i, r) => (results[i] = r),
    });
    expect(results.map((r) => r.verdict)).toEqual(['AC', 'WA']);
    expect(results[1].stdout).toBe('5\n');
  });

  it('runs only the requested tests', async () => {
    const file = await solution(`${readAll} console.log(s)`);
    const ran: number[] = [];
    await new TestRunner().run({
      file,
      tests: [{ input: 'a', output: 'a' }, { input: 'b', output: 'b' }],
      indices: [1],
      timeLimitMs: 2000,
      commands: COPY_COMPILE,
      onTestEnd: (i) => ran.push(i),
    });
    expect(ran).toEqual([1]);
  });

  it('stops after a compilation error', async () => {
    const file = await solution('');
    let compileResult: unknown;
    let started = false;
    await new TestRunner().run({
      file,
      tests: [{ input: '', output: '' }],
      timeLimitMs: 2000,
      commands: { compile: `${node} -e "process.exit(1)"`, run: '' },
      onCompileEnd: (r) => (compileResult = r),
      onTestStart: () => (started = true),
    });
    expect(compileResult).toMatchObject({ ok: false });
    expect(started).toBe(false);
  });

  it('detects TLE and can be stopped', async () => {
    const file = await solution('for(;;){}');
    const runner = new TestRunner();
    const results: TestResult[] = [];
    await runner.run({
      file,
      tests: [{ input: '', output: '' }],
      timeLimitMs: 200,
      commands: COPY_COMPILE,
      onTestEnd: (i, r) => (results[i] = r),
    });
    expect(results[0].verdict).toBe('TLE');

    const pending = runner.run({ file, tests: [{ input: '', output: '' }], timeLimitMs: 10_000, commands: COPY_COMPILE });
    setTimeout(() => runner.stop(), 300);
    await pending;
    expect(runner.running).toBe(false);
  });
});
