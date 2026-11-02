import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { findFreePort, requestHandoff, whoHasPort } from '../src/companion/portOwner';
import { CompanionServer, HANDOFF_PATH } from '../src/companion/server';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0)) await c();
});

async function rawServer(handler: http.RequestListener): Promise<number> {
  const s = http.createServer(handler);
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise<void>((r) => s.close(() => r())));
  return (s.address() as AddressInfo).port;
}

async function cpPilotWindow(folder: string) {
  const handoffs: number[] = [];
  const server = new CompanionServer(() => {}, () => {}, undefined, {
    identity: () => ({ folder }),
    onHandoff: () => handoffs.push(Date.now()),
  });
  const port = await server.start(0);
  cleanups.push(() => server.stop());
  return { server, port, handoffs };
}

describe('whoHasPort', () => {
  it('recognises another CP Pilot window and its folder', async () => {
    const { port } = await cpPilotWindow('cp-test');
    expect(await whoHasPort(port)).toEqual({ kind: 'cp-pilot', folder: 'cp-test' });
  });

  it('recognises CP Pilot 0.2.0, which answers GETs with 405', async () => {
    const port = await rawServer((_req, res) => void res.writeHead(405).end());
    expect(await whoHasPort(port)).toEqual({ kind: 'cp-pilot' });
  });

  it('recognises CPH, which answers every request with its submit payload', async () => {
    const port = await rawServer((_req, res) => void res.end(JSON.stringify({ empty: true })));
    expect(await whoHasPort(port)).toEqual({ kind: 'cph' });
  });

  it('reports anything else as another program', async () => {
    const port = await rawServer((_req, res) => void res.writeHead(200).end('<html>hi</html>'));
    expect(await whoHasPort(port)).toEqual({ kind: 'other' });
  });

  it('reports a free port', async () => {
    const port = await rawServer(() => {});
    await cleanups.pop()!(); // close it again
    expect(await whoHasPort(port)).toEqual({ kind: 'free' });
  });
});

describe('handoff between windows', () => {
  it('stops the other window and lets this one take the port', async () => {
    const other = await cpPilotWindow('old window');
    expect(await requestHandoff(other.port)).toBe(true);
    await new Promise((r) => setTimeout(r, 100));
    expect(other.handoffs).toHaveLength(1);
    expect(other.server.port).toBeUndefined();

    const mine = new CompanionServer(() => {});
    cleanups.push(() => mine.stop());
    await expect(mine.start(other.port)).resolves.toBe(other.port);
  });

  it('refuses handoffs without the CP Pilot header, so web pages cannot trigger one', async () => {
    const other = await cpPilotWindow('w');
    const url = `http://127.0.0.1:${other.port}${HANDOFF_PATH}`;
    expect((await fetch(url, { method: 'POST' })).status).toBe(403);
    expect((await fetch(url)).status).toBe(403);
    expect(other.handoffs).toHaveLength(0);
    expect(other.server.port).toBe(other.port);
  });

  it('does not answer identity or handoff when no window control is given', async () => {
    const plain = new CompanionServer(() => {});
    const port = await plain.start(0);
    cleanups.push(() => plain.stop());
    expect(await whoHasPort(port)).toEqual({ kind: 'cp-pilot' }); // 405, like 0.2.0
    expect(await requestHandoff(port)).toBe(false);
  });
});

describe('findFreePort', () => {
  it('skips ports that are taken', async () => {
    const taken = await rawServer(() => {});
    const free = await findFreePort(taken, 5);
    expect(free).toBeDefined();
    expect(free).not.toBe(taken);
  });
});
