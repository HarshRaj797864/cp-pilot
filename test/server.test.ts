import { afterEach, describe, expect, it } from 'vitest';
import { CompanionServer } from '../src/companion/server';
import { Problem } from '../src/core/problem';

let server: CompanionServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function startServer() {
  const received: Problem[] = [];
  const errors: unknown[] = [];
  server = new CompanionServer((p) => void received.push(p), (e) => void errors.push(e));
  const port = await server.start(0);
  return { port, received, errors };
}

const post = (port: number, body: string) =>
  fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body });

describe('CompanionServer', () => {
  it('accepts a problem and hands it to the handler', async () => {
    const { port, received } = await startServer();
    const res = await post(port, JSON.stringify({ name: 'A. Test', tests: [{ input: '1', output: '2' }] }));
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('A. Test');
  });

  it('rejects malformed JSON with 400', async () => {
    const { port, received, errors } = await startServer();
    const res = await post(port, '{not json');
    expect(res.status).toBe(400);
    expect(received).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('rejects non-POST requests', async () => {
    const { port } = await startServer();
    const res = await fetch(`http://127.0.0.1:${port}/`);
    expect(res.status).toBe(405);
  });

  it('fails with EADDRINUSE when the port is taken', async () => {
    const { port } = await startServer();
    const second = new CompanionServer(() => {});
    await expect(second.start(port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
  });
});
