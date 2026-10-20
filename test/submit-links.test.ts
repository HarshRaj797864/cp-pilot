import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { browserSubmitTarget } from '../src/core/submitLinks';

describe('browserSubmitTarget', () => {
  it.each([
    ['https://codeforces.com/contest/4/problem/A', 'https://codeforces.com/contest/4/submit?submittedProblemIndex=A'],
    ['https://codeforces.com/problemset/problem/234/A?locale=en', 'https://codeforces.com/contest/234/submit?submittedProblemIndex=A'],
    ['https://codeforces.com/contest/1950/problem/F2', 'https://codeforces.com/contest/1950/submit?submittedProblemIndex=F2'],
    ['https://codeforces.com/gym/104114/problem/B', 'https://codeforces.com/gym/104114/submit?submittedProblemIndex=B'],
    ['https://m1.codeforces.com/contest/4/problem/a', 'https://codeforces.com/contest/4/submit?submittedProblemIndex=A'],
    ['https://atcoder.jp/contests/abc300/tasks/abc300_a', 'https://atcoder.jp/contests/abc300/submit?taskScreenName=abc300_a'],
    ['https://www.codechef.com/problems/FLOW001', 'https://www.codechef.com/submit/FLOW001'],
    ['https://www.codechef.com/START100A/problems/ADDONE', 'https://www.codechef.com/START100A/submit/ADDONE'],
  ])('%s', (problem, submit) => {
    expect(browserSubmitTarget(problem)?.submitUrl).toBe(submit);
  });

  it.each([
    'https://cses.fi/problemset/task/1068',
    'https://codeforces.com/contest/4',
    'https://codeforces.com/blog/entry/1',
    'https://atcoder.jp/contests/abc300',
    'https://usaco.org/index.php?page=viewproblem2&cpid=834',
    'not a url',
    '',
  ])('has no submit page for %s', (url) => {
    expect(browserSubmitTarget(url)).toBeUndefined();
  });

  it('covers every Codeforces, AtCoder and CodeChef fixture', () => {
    const dir = path.join(__dirname, 'fixtures', 'companion');
    for (const name of fs.readdirSync(dir).filter((f) => /^(codeforces|atcoder|codechef)_/.test(f))) {
      const { result } = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      for (const problem of Array.isArray(result) ? result : [result]) {
        expect(browserSubmitTarget(problem.url), `${name}: ${problem.url}`).toBeDefined();
      }
    }
  });
});
