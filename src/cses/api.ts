/**
 * Client for the official CSES API (the one cses-cli uses).
 * Spec: https://github.com/csesfi/cses-cli/tree/main/api
 * Login happens in the browser, so we never see the user's password.
 */

import { HttpTransport, nodeTransport } from '../core/http';
import { CsesCategory, RawCourseContent, parseProblemList } from './problemList';

export const CSES_API_URL = 'https://cses.fi/api';
export const PROBLEMSET = 'problemset';

const REQUEST_TIMEOUT_MS = 20_000;
/** CSES holds long-poll requests open for a while; allow well beyond that. */
const LONG_POLL_TIMEOUT_MS = 90_000;

export interface CsesUser {
  id: number;
  username: string;
  displayname?: string;
}

export interface CsesLanguage {
  /** e.g. "C++", "Python3". null lets CSES deduce it from the file extension. */
  name: string | null;
  /** e.g. "C++17", "PyPy3". null uses CSES's default. */
  option: string | null;
}

export interface CsesSubmission {
  id: number;
  task: { id: string; name: string };
  language: CsesLanguage;
  /** e.g. "PENDING", "TESTING", "READY". */
  status: string;
  pending: boolean;
  test_progress?: { finished_tests: number; total_tests: number };
  /** e.g. "ACCEPTED", "WRONG ANSWER", "COMPILE ERROR". Present once graded. */
  result?: string;
  tests?: { number: number; verdict: string; time: number | null }[];
  compiler?: string;
}

export type LoginStatus = { state: 'valid'; user: CsesUser } | { state: 'pending' } | { state: 'invalid' };

export class CsesApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** CSES error code, e.g. "invalid_api_key", "task_deduction_error", "client_error". */
    readonly code: string | undefined,
  ) {
    super(message);
  }

  get isAuthError(): boolean {
    return this.code === 'invalid_api_key' || this.code === 'pending_api_key';
  }
}

export class CsesApi {
  constructor(
    private readonly baseUrl = CSES_API_URL,
    private readonly transport: HttpTransport = nodeTransport,
  ) {}

  /** Starts the browser login flow. The token becomes usable once the user approves the URL. */
  async startLogin(): Promise<{ token: string; authenticationUrl: string }> {
    const res = await this.request<{ 'X-Auth-Token': string; authentication_url: string }>('POST', '/login');
    return { token: res['X-Auth-Token'], authenticationUrl: res.authentication_url };
  }

  async loginStatus(token: string): Promise<LoginStatus> {
    try {
      return { state: 'valid', user: await this.request<CsesUser>('GET', '/login', { token }) };
    } catch (err) {
      if (err instanceof CsesApiError && err.code === 'pending_api_key') return { state: 'pending' };
      if (err instanceof CsesApiError && err.code === 'invalid_api_key') return { state: 'invalid' };
      throw err;
    }
  }

  async logout(token: string): Promise<void> {
    try {
      await this.request('POST', '/logout', { token });
    } catch (err) {
      // Already invalid is fine: the goal is for the token to stop working.
      if (!(err instanceof CsesApiError && err.isAuthError)) throw err;
    }
  }

  submit(
    token: string,
    taskId: string,
    file: { name: string; content: string },
    language: CsesLanguage,
  ): Promise<CsesSubmission> {
    return this.request('POST', `/courses/${PROBLEMSET}/submissions?task=${encodeURIComponent(taskId)}`, {
      token,
      body: {
        language,
        filename: file.name,
        content: Buffer.from(file.content, 'utf8').toString('base64'),
      },
    });
  }

  /** All problem set tasks by category. With a token, each task carries the user's status. */
  async getProblemList(token?: string): Promise<CsesCategory[]> {
    return parseProblemList(await this.request<RawCourseContent>('GET', `/courses/${PROBLEMSET}/list`, { token }));
  }

  /** With `poll`, CSES holds the request open until grading progresses or a server timeout passes. */
  getSubmission(token: string, id: number, poll: boolean, signal?: AbortSignal): Promise<CsesSubmission> {
    return this.request('GET', `/courses/${PROBLEMSET}/submissions/${id}?poll=${poll}`, {
      token,
      signal,
      timeoutMs: poll ? LONG_POLL_TIMEOUT_MS : REQUEST_TIMEOUT_MS,
    });
  }

  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    opts: { token?: string; body?: unknown; signal?: AbortSignal; timeoutMs?: number } = {},
  ): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (opts.token) headers['X-Auth-Token'] = opts.token;
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

    const res = await this.transport({
      method,
      url: this.baseUrl + path,
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      timeoutMs: opts.timeoutMs ?? REQUEST_TIMEOUT_MS,
      signal: opts.signal,
    });
    let data: unknown;
    try {
      data = res.text ? JSON.parse(res.text) : undefined;
    } catch {
      throw new CsesApiError(`CSES returned an unexpected response (HTTP ${res.status})`, res.status, undefined);
    }
    if (res.status < 200 || res.status >= 300) {
      const err = (data ?? {}) as { message?: string; code?: string };
      throw new CsesApiError(err.message ?? `CSES request failed (HTTP ${res.status})`, res.status, err.code);
    }
    return data as T;
  }
}

/** Extracts the task id from a CSES problem URL like https://cses.fi/problemset/task/1068. */
export function csesTaskId(url: string): string | undefined {
  return /^https?:\/\/(?:www\.)?cses\.fi\/problemset\/(?:task|submit|view|stats)\/(\d+)/.exec(url)?.[1];
}

export function submissionUrl(id: number): string {
  return `https://cses.fi/problemset/result/${id}/`;
}

/** One-line summary, e.g. "Testing 12/20", "ACCEPTED", "WRONG ANSWER on test 4". */
export function describeSubmission(s: CsesSubmission): string {
  if (s.pending) {
    const p = s.test_progress;
    return p && p.total_tests > 0 ? `Testing ${p.finished_tests}/${p.total_tests}` : capitalize(s.status);
  }
  const result = s.result ?? s.status;
  const firstFailed = s.tests?.find((t) => t.verdict !== 'ACCEPTED');
  return firstFailed && result !== 'ACCEPTED' ? `${result} on test ${firstFailed.number}` : result;
}

function capitalize(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}
