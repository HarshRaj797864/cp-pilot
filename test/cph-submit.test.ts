import { afterEach, describe, expect, it } from 'vitest';
import { CphSubmitPayload, CphSubmitQueue, codeforcesProblemName } from '../src/companion/cphSubmit';
import { CompanionServer } from '../src/companion/server';

const payload: CphSubmitPayload = {
  empty: false,
  problemName: '4A',
  url: 'https://codeforces.com/contest/4/problem/A',
  sourceCode: 'int main(){}',
  languageId: 91,
};

describe('codeforcesProblemName', () => {
  it.each([
    ['https://codeforces.com/contest/4/problem/A', '4A'],
    ['https://codeforces.com/problemset/problem/234/a?locale=en', '234A'],
    ['https://codeforces.com/contest/1950/problem/F2', '1950F2'],
    ['https://codeforces.com/gym/104114/problem/B', '104114B'],
    ['https://atcoder.jp/contests/abc300/tasks/abc300_a', undefined],
  ])('%s -> %s', (url, name) => expect(codeforcesProblemName(url)).toBe(name));
});

describe('CphSubmitQueue', () => {
  it('hands the submission to the add-on once and reports it taken', async () => {
    const q = new CphSubmitQueue();
    const taken = q.offer(payload, 5000);
    expect(q.take(false)).toEqual(payload); // a plain GET only peeks, like CPH
    expect(q.take(true)).toEqual(payload);
    expect(q.take(true)).toBeUndefined();
    await expect(taken).resolves.toBe(true);
  });

  it('times out when nobody collects it', async () => {
    const q = new CphSubmitQueue();
    await expect(q.offer(payload, 30)).resolves.toBe(false);
    expect(q.take(true)).toBeUndefined();
  });

  it('a new submission replaces the old one', async () => {
    const q = new CphSubmitQueue();
    const first = q.offer(payload, 5000);
    const second = q.offer({ ...payload, problemName: '4B' }, 5000);
    await expect(first).resolves.toBe(false);
    expect(q.take(true)?.problemName).toBe('4B');
    await expect(second).resolves.toBe(true);
  });
});

describe('GET /getSubmit', () => {
  let server: CompanionServer | undefined;
  afterEach(() => server?.stop());

  it('speaks the cph-submit protocol', async () => {
    const q = new CphSubmitQueue();
    server = new CompanionServer(() => {}, () => {}, q);
    const port = await server.start(0);
    const poll = () => fetch(`http://127.0.0.1:${port}/getSubmit`, { headers: { 'cph-submit': 'true' } }).then((r) => r.json());

    expect(await poll()).toEqual({ empty: true });
    const taken = q.offer(payload, 5000);
    expect(await poll()).toEqual(payload);
    await expect(taken).resolves.toBe(true);
    expect(await poll()).toEqual({ empty: true });
  });

  it('still rejects other GETs', async () => {
    server = new CompanionServer(() => {}, () => {}, new CphSubmitQueue());
    const port = await server.start(0);
    expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(405);
  });
});
