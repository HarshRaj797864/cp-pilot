import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { HttpTimeoutError, nodeTransport } from '../src/core/http';

let server: http.Server | undefined;

afterEach(() => {
  server?.closeAllConnections();
  server?.close();
  server = undefined;
});

async function serve(handler: http.RequestListener): Promise<string> {
  server = http.createServer(handler);
  await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
  return `http://localhost:${(server.address() as AddressInfo).port}`;
}

describe('nodeTransport', () => {
  it('sends method, headers and body and returns status and text', async () => {
    const base = await serve((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => res.writeHead(201).end(`${req.method} ${req.headers['x-test']} ${body}`));
    });
    // "localhost" must resolve to the IPv4 listener even where it also maps to ::1.
    const res = await nodeTransport({
      method: 'POST',
      url: `${base}/x`,
      headers: { 'X-Test': 'yes' },
      body: 'héllo',
      timeoutMs: 5000,
    });
    expect(res).toEqual({ status: 201, text: 'POST yes héllo' });
  });

  it('follows a POST redirect as a GET, keeping same-origin headers', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/submit') return void res.writeHead(302, { Location: '/result/42' }).end();
      res.writeHead(200).end(`${req.method} ${req.url} token=${req.headers['x-auth-token']}`);
    });
    const res = await nodeTransport({
      method: 'POST',
      url: `${base}/submit`,
      headers: { 'X-Auth-Token': 't', 'Content-Type': 'application/json' },
      body: '{}',
      timeoutMs: 5000,
    });
    expect(res).toEqual({ status: 200, text: 'GET /result/42 token=t' });
  });

  it('repeats the method and body on 307', async () => {
    const base = await serve((req, res) => {
      if (req.url === '/a') return void res.writeHead(307, { Location: '/b' }).end();
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => res.writeHead(200).end(`${req.method} ${body}`));
    });
    const res = await nodeTransport({ method: 'POST', url: `${base}/a`, body: 'data', timeoutMs: 5000 });
    expect(res.text).toBe('POST data');
  });

  it('stops after too many redirects', async () => {
    const base = await serve((_req, res) => void res.writeHead(302, { Location: '/loop' }).end());
    const res = await nodeTransport({ method: 'GET', url: base, timeoutMs: 5000 });
    expect(res.status).toBe(302);
  });

  it('times out when the server never answers', async () => {
    const base = await serve(() => {});
    await expect(nodeTransport({ method: 'GET', url: base, timeoutMs: 200 })).rejects.toBeInstanceOf(HttpTimeoutError);
  });

  it('can be aborted', async () => {
    const base = await serve(() => {});
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(
      nodeTransport({ method: 'GET', url: base, timeoutMs: 10_000, signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
