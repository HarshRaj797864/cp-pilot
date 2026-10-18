import * as dns from 'node:dns';
import * as http from 'node:http';
import * as https from 'node:https';
import { LookupFunction } from 'node:net';

export interface HttpRequest {
  method: 'GET' | 'POST';
  url: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface HttpResponse {
  status: number;
  text: string;
}

export type HttpTransport = (req: HttpRequest) => Promise<HttpResponse>;

export class HttpTimeoutError extends Error {}

/**
 * Resolves IPv4 addresses first. Many WSL and home networks advertise IPv6 without routing it,
 * and Node's fetch then hangs on the IPv6 address instead of falling back.
 */
const ipv4FirstLookup: LookupFunction = (hostname, options, callback) =>
  dns.lookup(hostname, { ...options, order: 'ipv4first', verbatim: false } as dns.LookupOptions, callback as never);

const MAX_REDIRECTS = 5;

/**
 * Minimal HTTP client on node:http(s) with IPv4-first resolution, a timeout, cancellation,
 * and redirect following like fetch/browsers: 301/302/303 become a GET, 307/308 repeat the request.
 * Headers (including auth) are only kept for redirects to the same origin.
 */
export const nodeTransport: HttpTransport = async (req) => {
  let current = req;
  for (let redirects = 0; ; redirects++) {
    const res = await send(current);
    if (!res.location || redirects >= MAX_REDIRECTS) return { status: res.status, text: res.text };

    const from = new URL(current.url);
    const to = new URL(res.location, from);
    const keepMethod = res.status === 307 || res.status === 308;
    current = {
      ...current,
      url: to.href,
      method: keepMethod ? current.method : 'GET',
      body: keepMethod ? current.body : undefined,
      headers: to.origin === from.origin ? withoutBodyHeaders(current.headers, keepMethod) : undefined,
    };
  }
};

function withoutBodyHeaders(headers: Record<string, string> | undefined, keepBody: boolean) {
  if (!headers || keepBody) return headers;
  const { 'Content-Type': _type, ...rest } = headers;
  return rest;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function send(req: HttpRequest): Promise<HttpResponse & { location?: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(req.url);
    const client = url.protocol === 'https:' ? https : http;
    const headers = { ...req.headers };
    if (req.body !== undefined) headers['Content-Length'] = String(Buffer.byteLength(req.body));

    // autoSelectFamily (happy eyeballs) is what stalls on broken IPv6; it's missing from older @types/node.
    const options: https.RequestOptions & { autoSelectFamily?: boolean } = {
      method: req.method,
      headers,
      lookup: ipv4FirstLookup,
      autoSelectFamily: false,
      signal: req.signal,
    };
    const request = client.request(
      url,
      options,
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            text: Buffer.concat(chunks).toString('utf8'),
            location: REDIRECT_STATUSES.has(status) ? res.headers.location : undefined,
          });
        });
        res.on('error', reject);
      },
    );
    request.setTimeout(req.timeoutMs, () => {
      request.destroy(new HttpTimeoutError(`No response from ${url.host} after ${Math.round(req.timeoutMs / 1000)}s`));
    });
    request.on('error', reject);
    request.end(req.body);
  });
}
