import * as net from 'node:net';
import { HttpTransport, nodeTransport } from '../core/http';
import { HANDOFF_HEADER, HANDOFF_PATH, IDENTITY_PATH } from './server';

export type PortOwner =
  /** Another VS Code window running CP Pilot; `folder` is unknown for versions before 0.2.1. */
  | { kind: 'cp-pilot'; folder?: string }
  /** Competitive Programming Helper, which also defaults to 27121. */
  | { kind: 'cph' }
  | { kind: 'other' }
  | { kind: 'free' };

/** Asks whatever listens on `port` who it is, so a busy port can be explained (or ignored). */
export async function whoHasPort(port: number, transport: HttpTransport = nodeTransport): Promise<PortOwner> {
  let res;
  try {
    res = await transport({ method: 'GET', url: `http://127.0.0.1:${port}${IDENTITY_PATH}`, timeoutMs: 1500 });
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ECONNREFUSED' ? { kind: 'free' } : { kind: 'other' };
  }
  let body: unknown;
  try {
    body = JSON.parse(res.text);
  } catch {
    // CP Pilot before 0.2.1 had no identity endpoint and turned away GETs with 405.
    return res.status === 405 ? { kind: 'cp-pilot' } : { kind: 'other' };
  }
  const b = body as { app?: unknown; folder?: unknown; empty?: unknown } | null;
  if (b?.app === 'cp-pilot') return { kind: 'cp-pilot', folder: typeof b.folder === 'string' ? b.folder : undefined };
  // CPH answers every request with its pending cph-submit payload, e.g. {"empty":true}.
  if (b && typeof b.empty === 'boolean') return { kind: 'cph' };
  return { kind: 'other' };
}

/** Asks the CP Pilot window on `port` to stop listening so this one can take over. */
export async function requestHandoff(port: number, transport: HttpTransport = nodeTransport): Promise<boolean> {
  try {
    const res = await transport({
      method: 'POST',
      url: `http://127.0.0.1:${port}${HANDOFF_PATH}`,
      headers: { [HANDOFF_HEADER]: '1' },
      body: '',
      timeoutMs: 2000,
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/** First port from `start` that nothing listens on (checked by binding to it briefly). */
export async function findFreePort(start: number, attempts = 20): Promise<number | undefined> {
  for (let port = start; port < start + attempts; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(true)));
    });
    if (free) return port;
  }
  return undefined;
}
