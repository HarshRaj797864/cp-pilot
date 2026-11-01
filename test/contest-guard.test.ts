import { beforeEach, describe, expect, it } from 'vitest';
import { contestStatus, parseAtcoderTimes, resetContestCache } from '../src/core/contestGuard';
import { HttpRequest, HttpTransport } from '../src/core/http';
import { csesStatementText } from '../src/cses/statement';

const NOW = Date.parse('2026-11-01T12:00:00Z');
const sec = (iso: string) => Date.parse(iso) / 1000;

function transport(routes: Record<string, { status?: number; text: string } | Error>): HttpTransport & { calls: string[] } {
  const calls: string[] = [];
  const t = (async (req: HttpRequest) => {
    calls.push(req.url);
    const r = routes[req.url];
    if (!r) return { status: 404, text: '' };
    if (r instanceof Error) throw r;
    return { status: r.status ?? 200, text: r.text };
  }) as HttpTransport & { calls: string[] };
  t.calls = calls;
  return t;
}

const CF_LIST = 'https://codeforces.com/api/contest.list?gym=false';
const cfList = JSON.stringify({
  status: 'OK',
  result: [
    { id: 2200, name: 'Codeforces Round 1000 (Div. 2)', phase: 'CODING', startTimeSeconds: sec('2026-11-01T11:00:00Z'), durationSeconds: 7200 },
    { id: 4, name: 'Codeforces Beta Round 4', phase: 'FINISHED', startTimeSeconds: 1270000000, durationSeconds: 7200 },
  ],
});

const atcoderPage = (start: string, end: string) =>
  `<title>AtCoder Beginner Contest 999 - AtCoder</title><script>var startTime = moment("${start}");\nvar endTime = moment("${end}");</script>`;

beforeEach(() => resetContestCache());

describe('contestStatus', () => {
  it('blocks a Codeforces contest in its coding phase, with its end time', async () => {
    const t = transport({ [CF_LIST]: { text: cfList } });
    const s = await contestStatus('https://codeforces.com/contest/2200/problem/B', t, NOW);
    expect(s).toEqual({ status: 'live', contest: 'Codeforces Round 1000 (Div. 2)', endsAt: new Date('2026-11-01T13:00:00Z') });
  });

  it('allows finished Codeforces contests, problemset links and gym', async () => {
    const t = transport({ [CF_LIST]: { text: cfList } });
    expect(await contestStatus('https://codeforces.com/problemset/problem/4/A', t, NOW)).toEqual({ status: 'practice' });
    expect(await contestStatus('https://codeforces.com/gym/104114/problem/B', t, NOW)).toEqual({ status: 'practice' });
    expect(t.calls).toEqual([CF_LIST]); // cached, gym needs no lookup
  });

  it('asks when the Codeforces list is unreachable', async () => {
    const t = transport({ [CF_LIST]: new Error('ECONNRESET') });
    expect((await contestStatus('https://codeforces.com/contest/2200/problem/A', t, NOW)).status).toBe('unknown');
  });

  it('checks AtCoder contest times', async () => {
    const url = 'https://atcoder.jp/contests/abc999';
    const live = transport({ [url]: { text: atcoderPage('2026-11-01T20:30:00+09:00', '2026-11-01T22:10:00+09:00') } });
    expect(await contestStatus(`${url}/tasks/abc999_a`, live, NOW)).toEqual({
      status: 'live',
      contest: 'AtCoder Beginner Contest 999',
      endsAt: new Date('2026-11-01T13:10:00Z'),
    });
    const past = transport({ [url]: { text: atcoderPage('2026-10-01T21:00:00+09:00', '2026-10-01T22:40:00+09:00') } });
    expect(await contestStatus(`${url}/tasks/abc999_a`, past, NOW)).toEqual({ status: 'practice' });
  });

  it('treats CSES and USACO as practice and other judges as unknown', async () => {
    const t = transport({});
    expect(await contestStatus('https://cses.fi/problemset/task/1068', t, NOW)).toEqual({ status: 'practice' });
    expect(await contestStatus('https://usaco.org/index.php?page=viewproblem2&cpid=834', t, NOW)).toEqual({ status: 'practice' });
    expect(await contestStatus('https://www.codechef.com/START100A/problems/ADDONE', t, NOW)).toMatchObject({ status: 'unknown', judge: 'codechef.com' });
    expect(await contestStatus('', t, NOW)).toMatchObject({ status: 'unknown' });
  });

  it('parses AtCoder times and rejects pages without them', () => {
    expect(parseAtcoderTimes(atcoderPage('2023-04-29T21:00:00+09:00', '2023-04-29T22:40:00+09:00'))).toEqual({
      start: new Date('2023-04-29T12:00:00Z'),
      end: new Date('2023-04-29T13:40:00Z'),
    });
    expect(parseAtcoderTimes('<html></html>')).toBeUndefined();
  });
});

describe('csesStatementText', () => {
  // Trimmed from the real https://cses.fi/problemset/task/1083 page.
  const html = `<div class="content"><div class="md"><p>You are given all numbers between <span class="math math-inline">1,2,\\ldots,n</span> except one.</p>
<h1 id="input">Input</h1>
<p>The first input line contains an integer <span class="math math-inline">n</span>.</p>
<h1 id="constraints">Constraints</h1>
<ul>
<li><span class="math math-inline">2 \\le n \\le 2 \\cdot 10^5</span></li>
</ul>
<p>Input:</p>
<pre>5
2 3 1 5
</pre></div>
</div>`;

  it('keeps headings, list items, TeX and sample blocks', () => {
    expect(csesStatementText(html)).toBe(
      'You are given all numbers between 1,2,\\ldots,n except one.\n\n## Input\n\nThe first input line contains an integer n.\n\n## Constraints\n\n- 2 \\le n \\le 2 \\cdot 10^5\n\nInput:\n\n5\n2 3 1 5',
    );
  });

  it('returns undefined when there is no statement block', () => {
    expect(csesStatementText('<html></html>')).toBeUndefined();
  });
});
