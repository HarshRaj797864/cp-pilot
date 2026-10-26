import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { problemFileStem, solutionFileName } from '../src/core/naming';
import { placeSolution } from '../src/core/placement';
import { Problem, isSameProblem, parseBatch, parseCompanionPayload } from '../src/core/problem';
import { TestResult } from '../src/core/judge';
import { TestRunner } from '../src/core/runner';
import { loadProblem } from '../src/core/store';

/** Payloads Competitive Companion produces for real pages (see fixtures/companion/README.md). */
function fixture(name: string): unknown[] {
  const { result } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'companion', `${name}.json`), 'utf8'));
  return Array.isArray(result) ? result : [result];
}
const parse = (name: string) => fixture(name).map(parseCompanionPayload);

describe('real Competitive Companion payloads', () => {
  it.each([
    ['codeforces_problem_normal', 'stdin'],
    ['codechef_problem_new-copy-button', 'stdin'],
    ['cses_problem_normal', 'stdin'],
    ['atcoder_problem_normal_ja', 'stdin'],
    ['codeforces_problem_file-input-output', 'input.txt -> output.txt'],
    ['usaco_problem_normal', 'sort.in -> sort.out'],
  ])('%s parses with %s', (name, io) => {
    const [p] = parse(name);
    expect(p.tests.length).toBeGreaterThan(0);
    expect(p.timeLimit).toBeGreaterThan(0);
    expect(p.io ? `${p.io.inputFile} -> ${p.io.outputFile}` : 'stdin').toBe(io);
  });

  it('flags interactive problems', () => {
    expect(parse('codeforces_problem_interactive')[0].interactive).toBe(true);
  });

  it('gives every problem in a contest its own file name', () => {
    for (const contest of ['codeforces_contest_normal', 'atcoder_contest_normal']) {
      const names = parse(contest).map((p) => solutionFileName(p, 'cpp'));
      expect(new Set(names).size).toBe(names.length);
    }
  });

  it('keeps Japanese-titled AtCoder problems distinct via the task id', () => {
    const [p] = parse('atcoder_problem_normal_ja');
    expect(p.name).toBe('A - ファイティング・タカハシ');
    expect(problemFileStem(p)).toBe('A_colopl2018_final_a');
  });

  it('leaves plain and accented names alone', () => {
    expect(problemFileStem({ name: 'A. Watermelon', url: 'https://codeforces.com/problemset/problem/4/A' })).toBe('A_Watermelon');
    expect(problemFileStem({ name: 'Résumé', url: 'https://x.com/r' })).toBe('Resume');
    expect(problemFileStem({ name: 'ファイティング', url: '' })).toBe('problem');
    // Symbols aren't letters, so no task id gets added (a real Codeforces title).
    expect(problemFileStem({ name: 'E. Good Substrings☆Favorite', url: 'https://codeforces.com/contest/2200/problem/E' })).toBe(
      'E_Good_Substrings_Favorite',
    );
  });
});

describe('parse details', () => {
  it('reads contest batch info', () => {
    expect(parseBatch({ batch: { id: 'abc', size: 5 } })).toEqual({ id: 'abc', size: 5 });
    expect(parseBatch({})).toBeUndefined();
  });

  it('never lets an I/O file name escape the run folder', () => {
    const p = parseCompanionPayload({
      name: 'X',
      tests: [],
      input: { type: 'file', fileName: '../../etc/passwd' },
      output: { type: 'file', fileName: '..' },
    });
    expect(p.io).toEqual({ inputFile: 'passwd', outputFile: undefined });
  });

  it('matches problems by URL, ignoring query strings and trailing slashes', () => {
    const base = { name: 'A', group: 'g', interactive: false, timeLimit: 1, memoryLimit: 1, tests: [] };
    const a = { ...base, url: 'https://codeforces.com/problemset/problem/234/A?locale=en' };
    const b = { ...base, url: 'https://codeforces.com/problemset/problem/234/A/' };
    const c = { ...base, url: 'https://codeforces.com/problemset/problem/235/A' };
    expect(isSameProblem(a, b)).toBe(true);
    expect(isSameProblem(a, c)).toBe(false);
  });
});

describe('placeSolution', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-place-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  const problem = (url: string, input = '1'): Problem => ({
    name: 'A - Echo',
    group: 'AtCoder',
    url,
    interactive: false,
    timeLimit: 2000,
    memoryLimit: 1024,
    tests: [{ input, output: input }],
  });

  it('creates the file from the template and stores tests', async () => {
    const placed = await placeSolution(dir, problem('https://atcoder.jp/contests/abc1/tasks/abc1_a'), 'cpp', '// tmpl\n');
    expect(placed).toEqual({ path: path.join(dir, 'A_Echo.cpp'), created: true });
    expect(await fsp.readFile(placed.path, 'utf8')).toBe('// tmpl\n');
    expect((await loadProblem(placed.path))?.tests).toHaveLength(1);
  });

  it('reuses the file when the same problem is imported again, keeping the code', async () => {
    const url = 'https://atcoder.jp/contests/abc1/tasks/abc1_a';
    const first = await placeSolution(dir, problem(url), 'cpp', '');
    await fsp.writeFile(first.path, 'my solution');
    const again = await placeSolution(dir, problem(`${url}?lang=en`, '2'), 'cpp', '');
    expect(again).toEqual({ path: first.path, created: false });
    expect(await fsp.readFile(first.path, 'utf8')).toBe('my solution');
    expect((await loadProblem(first.path))?.tests[0].input).toBe('2');
  });

  it('does not take over a different problem with the same name', async () => {
    const first = await placeSolution(dir, problem('https://atcoder.jp/contests/abc1/tasks/abc1_a'), 'cpp', '');
    const other = await placeSolution(dir, problem('https://atcoder.jp/contests/abc2/tasks/abc2_a', '9'), 'cpp', '');
    expect(path.basename(other.path)).toBe('A_Echo_2.cpp');
    expect((await loadProblem(first.path))?.tests[0].input).toBe('1');
  });

  it("adopts the user's own file with that name", async () => {
    await fsp.writeFile(path.join(dir, 'A_Echo.cpp'), 'started early');
    const placed = await placeSolution(dir, problem('https://atcoder.jp/contests/abc1/tasks/abc1_a'), 'cpp', '');
    expect(placed).toEqual({ path: path.join(dir, 'A_Echo.cpp'), created: false });
  });

  it('places a whole contest in parallel without clashes', async () => {
    const problems = parse('codeforces_contest_normal');
    const placed = await Promise.all(problems.map((p) => placeSolution(dir, p, 'cpp', '')));
    expect(new Set(placed.map((p) => p.path)).size).toBe(problems.length);
  });
});

describe('file I/O problems', () => {
  const node = `"${process.execPath}"`;
  let dir: string;
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-fio-'));
  });
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function judge(code: string, io: Problem['io']): Promise<TestResult> {
    const file = path.join(dir, 'sol.js');
    await fsp.writeFile(file, code);
    let result: TestResult | undefined;
    await new TestRunner().run({
      file,
      tests: [{ input: '6\nLLRLLL\n', output: '6\nLLRLLL\n' }],
      timeLimitMs: 3000,
      commands: { run: `${node} \${file}` },
      io,
      onTestEnd: (_i, r) => (result = r),
    });
    return result!;
  }

  const usaco = parse('usaco_problem_normal')[0].io;

  it('provides the input file and reads the output file', async () => {
    const code = `const fs=require('fs');fs.writeFileSync('${usaco!.outputFile}',fs.readFileSync('${usaco!.inputFile}'))`;
    expect((await judge(code, usaco)).verdict).toBe('AC');
  });

  it('explains a missing output file', async () => {
    const r = await judge(`process.stdout.write(require('fs').readFileSync(0))`, usaco);
    expect(r).toMatchObject({ verdict: 'WA', message: 'No sort.out was written (this problem uses file output)' });
  });

  it('still feeds stdin when only the output is a file', async () => {
    const code = `require('fs').writeFileSync('out.txt', require('fs').readFileSync(0))`;
    expect((await judge(code, { outputFile: 'out.txt' })).verdict).toBe('AC');
  });

  it("keeps the solution's folder clean", async () => {
    const code = `const fs=require('fs');fs.writeFileSync('${usaco!.outputFile}',fs.readFileSync('${usaco!.inputFile}'))`;
    await judge(code, usaco);
    expect((await fsp.readdir(dir)).filter((f) => !f.startsWith('.'))).toEqual(['sol.js']);
  });
});
