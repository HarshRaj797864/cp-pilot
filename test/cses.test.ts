import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CsesApi, CsesApiError, CsesSubmission, csesTaskId, describeSubmission } from '../src/cses/api';
import { submitAndWait } from '../src/cses/submitter';

interface Recorded {
  method: string;
  url: string;
  token?: string;
  body?: any;
}

type Handler = (req: Recorded) => { status?: number; body: unknown };

let server: http.Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

/** Starts a fake CSES API; returns a client pointed at it and the requests it received. */
async function mockCses(handler: Handler) {
  const requests: Recorded[] = [];
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const rec: Recorded = {
        method: req.method!,
        url: req.url!,
        token: req.headers['x-auth-token'] as string | undefined,
        body: raw ? JSON.parse(raw) : undefined,
      };
      requests.push(rec);
      const { status = 200, body } = handler(rec);
      res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return { api: new CsesApi(`http://127.0.0.1:${port}/api`), requests };
}

const submission = (over: Partial<CsesSubmission> = {}): CsesSubmission => ({
  id: 42,
  task: { id: '1068', name: 'Weird Algorithm' },
  language: { name: 'C++', option: 'C++17' },
  status: 'PENDING',
  pending: true,
  ...over,
});

describe('CsesApi', () => {
  it('starts a login', async () => {
    const { api } = await mockCses(() => ({
      body: { 'X-Auth-Token': 'tok', authentication_url: 'https://cses.fi/api/auth/abc' },
    }));
    expect(await api.startLogin()).toEqual({ token: 'tok', authenticationUrl: 'https://cses.fi/api/auth/abc' });
  });

  it('maps login status responses', async () => {
    const { api, requests } = await mockCses((r) => {
      if (r.token === 'good') return { body: { id: 7, username: 'harsh' } };
      if (r.token === 'pending') return { status: 401, body: { message: 'Pending', code: 'pending_api_key' } };
      return { status: 401, body: { message: 'Invalid API key', code: 'invalid_api_key' } };
    });
    expect(await api.loginStatus('good')).toEqual({ state: 'valid', user: { id: 7, username: 'harsh' } });
    expect(await api.loginStatus('pending')).toEqual({ state: 'pending' });
    expect(await api.loginStatus('bad')).toEqual({ state: 'invalid' });
    expect(requests[0]).toMatchObject({ method: 'GET', url: '/api/login', token: 'good' });
  });

  it('submits base64 source to the problemset course', async () => {
    const { api, requests } = await mockCses(() => ({ body: submission() }));
    await api.submit('tok', '1068', { name: 'Weird_Algorithm.cpp', content: 'int main(){}' }, { name: null, option: null });
    expect(requests[0]).toEqual({
      method: 'POST',
      url: '/api/courses/problemset/submissions?task=1068',
      token: 'tok',
      body: {
        language: { name: null, option: null },
        filename: 'Weird_Algorithm.cpp',
        content: Buffer.from('int main(){}').toString('base64'),
      },
    });
  });

  it('surfaces CSES error messages and codes', async () => {
    const { api } = await mockCses(() => ({ status: 429, body: { message: 'Too many requests', code: 'client_error' } }));
    const err = await api.submit('tok', '1', { name: 'a.cpp', content: 'x' }, { name: null, option: null }).catch((e) => e);
    expect(err).toBeInstanceOf(CsesApiError);
    expect(err).toMatchObject({ message: 'Too many requests', status: 429, code: 'client_error', isAuthError: false });
  });

  it('treats an already-invalid token as logged out', async () => {
    const { api } = await mockCses(() => ({ status: 401, body: { message: 'Invalid API key', code: 'invalid_api_key' } }));
    await expect(api.logout('old')).resolves.toBeUndefined();
  });
});

describe('submitAndWait', () => {
  it('long-polls until the verdict is final, reporting progress', async () => {
    const states = [
      submission({ status: 'TESTING', test_progress: { finished_tests: 3, total_tests: 10 } }),
      submission({ status: 'READY', pending: false, result: 'ACCEPTED' }),
    ];
    const { api, requests } = await mockCses((r) => (r.method === 'POST' ? { body: submission() } : { body: states.shift() }));
    const seen: string[] = [];
    const final = await submitAndWait({
      api,
      token: 'tok',
      taskId: '1068',
      file: { name: 'a.cpp', content: 'x' },
      language: { name: null, option: null },
      onUpdate: (s) => seen.push(describeSubmission(s)),
      minPollIntervalMs: 0,
    });
    expect(final.result).toBe('ACCEPTED');
    expect(seen).toEqual(['Pending', 'Testing 3/10', 'ACCEPTED']);
    expect(requests[1].url).toBe('/api/courses/problemset/submissions/42?poll=true');
  });

  it('gives up after the max wait', async () => {
    const { api } = await mockCses(() => ({ body: submission() }));
    await expect(
      submitAndWait({
        api,
        token: 'tok',
        taskId: '1068',
        file: { name: 'a.cpp', content: 'x' },
        language: { name: null, option: null },
        onUpdate: () => {},
        maxWaitMs: 50,
        minPollIntervalMs: 20,
      }),
    ).rejects.toThrow(/unusually long/);
  });
});

describe('helpers', () => {
  it.each([
    ['https://cses.fi/problemset/task/1068', '1068'],
    ['https://cses.fi/problemset/task/1068/', '1068'],
    ['https://cses.fi/problemset/submit/1083/', '1083'],
    ['https://codeforces.com/problemset/problem/4/A', undefined],
    ['', undefined],
  ])('csesTaskId(%j) = %j', (url, id) => {
    expect(csesTaskId(url)).toBe(id);
  });

  it('describes the first failing test', () => {
    const s = submission({
      pending: false,
      status: 'READY',
      result: 'WRONG ANSWER',
      tests: [
        { number: 1, verdict: 'ACCEPTED', time: 10 },
        { number: 2, verdict: 'WRONG ANSWER', time: 12 },
      ],
    });
    expect(describeSubmission(s)).toBe('WRONG ANSWER on test 2');
  });
});
