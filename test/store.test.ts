import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Problem } from '../src/core/problem';
import { loadProblem, problemFilePath, saveProblem } from '../src/core/store';

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const problem: Problem = {
  name: 'Weird Algorithm',
  group: 'CSES - CSES Problem Set',
  url: 'https://cses.fi/problemset/task/1068',
  interactive: false,
  timeLimit: 1000,
  memoryLimit: 512,
  tests: [{ input: '3\n', output: '3 10 5 16 8 4 2 1\n' }],
};

describe('store', () => {
  it('stores the problem in a hidden folder next to the solution', () => {
    expect(problemFilePath(path.join('a', 'b', 'Weird_Algorithm.cpp'))).toBe(
      path.join('a', 'b', '.cp-pilot', 'Weird_Algorithm.cpp.json'),
    );
  });

  it('round-trips a problem', async () => {
    const solution = path.join(dir, 'Weird_Algorithm.cpp');
    await saveProblem(solution, problem);
    expect(await loadProblem(solution)).toEqual(problem);
  });

  it('returns undefined when nothing is stored', async () => {
    expect(await loadProblem(path.join(dir, 'missing.cpp'))).toBeUndefined();
  });
});
