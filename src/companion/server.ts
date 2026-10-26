import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Batch, InvalidProblemError, Problem, parseBatch, parseCompanionPayload } from '../core/problem';
import { CphSubmitQueue } from './cphSubmit';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export type ProblemHandler = (problem: Problem, batch: Batch | undefined) => void | Promise<void>;

/**
 * Receives problems from the Competitive Companion browser extension, which POSTs
 * one JSON payload per problem to http://localhost:<port>/.
 */
export class CompanionServer {
  private server: http.Server | undefined;

  constructor(
    private readonly onProblem: ProblemHandler,
    private readonly onError: (err: unknown) => void = () => {},
    /** Serves GET /getSubmit for the cph-submit add-on when given. */
    private readonly submitQueue?: CphSubmitQueue,
  ) {}

  get port(): number | undefined {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? (addr as AddressInfo).port : undefined;
  }

  /** Starts listening. Rejects with an `EADDRINUSE` error if the port is taken (e.g. by CPH). */
  start(port: number): Promise<number> {
    if (this.server) return Promise.reject(new Error('CompanionServer is already listening; stop it first'));
    const server = http.createServer((req, res) => this.handle(req, res));
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      // Loopback only: problems come from the user's own browser, never the network.
      server.listen(port, '127.0.0.1', () => {
        server.off('error', reject);
        this.server = server;
        resolve(this.port!);
      });
    });
  }

  stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    if (!server) return Promise.resolve();
    return new Promise((resolve) => server.close(() => resolve()));
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    if (req.method === 'GET' && req.url?.split('?')[0] === '/getSubmit' && this.submitQueue) {
      const payload = this.submitQueue.take(req.headers['cph-submit'] === 'true');
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload ?? { empty: true }));
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.writeHead(413).end();
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', async () => {
      if (res.writableEnded) return;
      let problem: Problem;
      let batch: Batch | undefined;
      try {
        const payload: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        problem = parseCompanionPayload(payload);
        batch = parseBatch(payload);
      } catch (err) {
        res.writeHead(400).end(err instanceof InvalidProblemError ? err.message : 'Invalid JSON');
        this.onError(err);
        return;
      }
      // Respond before handling so the browser extension isn't kept waiting on file I/O.
      res.writeHead(200).end();
      try {
        await this.onProblem(problem, batch);
      } catch (err) {
        this.onError(err);
      }
    });
  }
}
