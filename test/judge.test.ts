import { describe, expect, it } from 'vitest';
import { effectiveTimeLimit, judgeTest, outputsMatch } from '../src/core/judge';
import { ProcessResult } from '../src/core/process';

const run = (over: Partial<ProcessResult> = {}): ProcessResult => ({
  stdout: '3 10 5\n',
  stderr: '',
  exitCode: 0,
  signal: null,
  timeMs: 10,
  timedOut: false,
  aborted: false,
  outputTruncated: false,
  ...over,
});
const test = { input: '3\n', output: '3 10 5\n' };

describe('outputsMatch', () => {
  it.each([
    ['1 2 3', '1 2 3'],
    ['1 2 3\n', '1  2\n3   \n\n'],
    ['YES\r\n', 'YES\n'],
    ['', '\n  '],
  ])('treats %j and %j as equal', (a, b) => {
    expect(outputsMatch(a, b)).toBe(true);
  });

  it.each([
    ['1 2 3', '1 2'],
    ['YES', 'yes'],
    ['1.0', '1'],
  ])('treats %j and %j as different', (a, b) => {
    expect(outputsMatch(a, b)).toBe(false);
  });
});

describe('judgeTest', () => {
  it('accepts matching output', () => {
    expect(judgeTest(test, run(), 1000).verdict).toBe('AC');
  });

  it('flags wrong output', () => {
    expect(judgeTest(test, run({ stdout: '3 10 6\n' }), 1000).verdict).toBe('WA');
  });

  it('flags slow runs and killed runs as TLE', () => {
    expect(judgeTest(test, run({ timeMs: 1500 }), 1000).verdict).toBe('TLE');
    expect(judgeTest(test, run({ timedOut: true, exitCode: null, signal: 'SIGKILL' }), 1000).verdict).toBe('TLE');
  });

  it('flags crashes as RE with a reason', () => {
    expect(judgeTest(test, run({ exitCode: 1 }), 1000)).toMatchObject({ verdict: 'RE', message: 'Exit code 1' });
    expect(judgeTest(test, run({ exitCode: 139 }), 1000, 'linux').message).toBe('Killed by SIGSEGV (exit code 139)');
    expect(judgeTest(test, run({ exitCode: 139 }), 1000, 'win32').message).toBe('Exit code 139');
    expect(judgeTest(test, run({ exitCode: null, signal: 'SIGSEGV' }), 1000)).toMatchObject({
      verdict: 'RE',
      message: 'Killed by SIGSEGV',
    });
    expect(judgeTest(test, run({ outputTruncated: true }), 1000).message).toBe('Output limit exceeded');
    expect(judgeTest(test, run({ exitCode: 1, stderr: 'A.java:1: error: x\n1 error\nerror: compilation failed\n' }), 1000).message).toBe(
      'Compilation failed (see stderr)',
    );
  });

  it('falls back to a default time limit', () => {
    expect(effectiveTimeLimit(0)).toBe(3000);
    expect(effectiveTimeLimit(2000)).toBe(2000);
  });
});
