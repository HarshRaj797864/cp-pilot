import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { InvalidProblemError, Problem, parseCompanionPayload } from '../core/problem';

const MAX_BODY_BYTES = 10 * 1024 * 1024;

export type ProblemHandler = (problem: Problem) => void | Promise<void>;

/**
 * Receives problems from the Competitive Companion browser extension, which POSTs
 * one JSON payload per problem to http://localhost:<port>/.
 */
export class CompanionServer {
  private server: http.Server | undefined;

  constructor(
    private readonly onProblem: ProblemHandler,
    private readonly onError: (err: unknown) => void = () => {},
  ) {}

  get port(): number | undefined {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? (addr as AddressInfo).port : undefined;
  }

  /** Starts listening. Rejects with an `EADDRINUSE` error if the port is taken (e.g. by CPH). */
  start(port: number): Promise<number> {
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
      try {
        problem = parseCompanionPayload(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (err) {
        res.writeHead(400).end(err instanceof InvalidProblemError ? err.message : 'Invalid JSON');
        this.onError(err);
        return;
      }
      // Respond before handling so the browser extension isn't kept waiting on file I/O.
      res.writeHead(200).end();
      try {
        await this.onProblem(problem);
      } catch (err) {
        this.onError(err);
      }
    });
  }
}
