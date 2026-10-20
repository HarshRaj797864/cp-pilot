import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { CsesApi } from '../src/cses/api';
import { RawCourseContent, countSolved, filterProblems, parseProblemList, withStatus } from '../src/cses/problemList';

// Trimmed copy of a real GET /api/courses/problemset/list response (statuses as for a logged-in user).
const raw: RawCourseContent = {
  sections: [
    {
      header: 'General',
      list: [
        { item_type: 'text', name: 'Introduction', id: '2433', link: 'https://cses.fi/problemset/text/2433' },
        { item_type: 'link', name: 'Statistics', link: 'https://cses.fi/problemset/stats/' },
      ],
    },
    {
      header: 'Introductory Problems',
      list: [
        { item_type: 'task', name: 'Weird Algorithm', id: '1068', link: 'https://cses.fi/problemset/task/1068', status: 'pass' },
        { item_type: 'task', name: 'Missing Number', id: '1083', link: 'https://cses.fi/problemset/task/1083', status: 'fail' },
        { item_type: 'task', name: 'Repetitions', id: '1069', link: 'https://cses.fi/problemset/task/1069', status: 'none' },
      ],
    },
    {
      header: 'Sorting and Searching',
      list: [
        { item_type: 'task', name: 'Distinct Numbers', id: '1621', link: 'https://cses.fi/problemset/task/1621', status: 'pass' },
      ],
    },
  ],
};

describe('parseProblemList', () => {
  const categories = parseProblemList(raw);

  it('keeps only task sections and maps statuses', () => {
    expect(categories.map((c) => c.name)).toEqual(['Introductory Problems', 'Sorting and Searching']);
    expect(categories[0].problems).toEqual([
      { id: '1068', name: 'Weird Algorithm', url: 'https://cses.fi/problemset/task/1068', status: 'solved' },
      { id: '1083', name: 'Missing Number', url: 'https://cses.fi/problemset/task/1083', status: 'attempted' },
      { id: '1069', name: 'Repetitions', url: 'https://cses.fi/problemset/task/1069', status: 'none' },
    ]);
  });

  it('treats a missing status as none', () => {
    const [c] = parseProblemList({ sections: [{ header: 'X', list: [{ item_type: 'task', name: 'A', id: '1', link: 'l' }] }] });
    expect(c.problems[0].status).toBe('none');
  });

  it('counts solved problems', () => {
    expect(countSolved(categories[0].problems)).toBe(1);
  });
});

describe('filterProblems', () => {
  const categories = parseProblemList(raw);
  const names = (cs: ReturnType<typeof filterProblems>) => cs.flatMap((c) => c.problems.map((p) => p.name));

  it('returns everything with an empty filter', () => {
    expect(names(filterProblems(categories, { query: '', hideSolved: false }))).toHaveLength(4);
  });

  it('searches names case-insensitively and by exact id', () => {
    expect(names(filterProblems(categories, { query: 'NUMBER', hideSolved: false }))).toEqual(['Missing Number', 'Distinct Numbers']);
    expect(names(filterProblems(categories, { query: ' 1069 ', hideSolved: false }))).toEqual(['Repetitions']);
  });

  it('hides solved problems and drops emptied categories', () => {
    const result = filterProblems(categories, { query: '', hideSolved: true });
    expect(result.map((c) => c.name)).toEqual(['Introductory Problems']);
    expect(names(result)).toEqual(['Missing Number', 'Repetitions']);
  });

  it('combines search and hide-solved', () => {
    expect(names(filterProblems(categories, { query: 'number', hideSolved: true }))).toEqual(['Missing Number']);
  });
});

describe('withStatus', () => {
  it('updates one problem without mutating the input', () => {
    const categories = parseProblemList(raw);
    const updated = withStatus(categories, '1083', 'solved');
    expect(updated[0].problems[1].status).toBe('solved');
    expect(categories[0].problems[1].status).toBe('attempted');
  });
});

describe('CsesApi.getProblemList', () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it('fetches the problemset list, sending the token when given', async () => {
    const seen: { url?: string; token?: string }[] = [];
    server = http.createServer((req, res) => {
      seen.push({ url: req.url, token: req.headers['x-auth-token'] as string | undefined });
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(raw));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const api = new CsesApi(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);

    const anonymous = await api.getProblemList();
    await api.getProblemList('tok');
    expect(anonymous).toHaveLength(2);
    expect(seen).toEqual([
      { url: '/api/courses/problemset/list', token: undefined },
      { url: '/api/courses/problemset/list', token: 'tok' },
    ]);
  });
});
