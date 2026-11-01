import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { transportFetch } from '../src/core/http';
import { LanguageCommands } from '../src/core/languages';
import { stressTest } from '../src/core/stress';

// Programs are JavaScript run with this Node, so the test needs no compilers.
const run: LanguageCommands = { run: `"${process.execPath}" \${file}` };

let dir: string;
beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cp-pilot-stress-'));
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const readAll = "const s=require('fs').readFileSync(0,'utf8');";
// "Missing Number": n, then n-1 distinct numbers from 1..n.
const GENERATOR = `${readAll}
let seed=Number(s)||1; const rnd=()=>{seed=(seed*1103515245+12345)%2147483648;return seed;};
const n=2+rnd()%6; const miss=1+rnd()%n; const xs=[];
for(let i=1;i<=n;i++) if(i!==miss) xs.push(i);
console.log(n); console.log(xs.join(' '));`;
const BRUTE = `${readAll} const [n,...xs]=s.trim().split(/\\s+/).map(Number);
for(let i=1;i<=n;i++) if(!xs.includes(i)) console.log(i);`;
const CORRECT = `${readAll} const [n,...xs]=s.trim().split(/\\s+/).map(Number); console.log(n*(n+1)/2-xs.reduce((a,b)=>a+b,0));`;
// Wrong whenever the missing number is n.
const BUGGY = `${readAll} const [n,...xs]=s.trim().split(/\\s+/).map(Number); for(let i=1;i<n;i++) if(!xs.includes(i)){console.log(i);process.exit(0);} console.log(1);`;

async function program(name: string, code: string) {
  const file = path.join(dir, name);
  await fs.writeFile(file, code);
  return { file, commands: run };
}

describe('stressTest', () => {
  it('passes a correct solution', async () => {
    const result = await stressTest({
      solution: await program('sol.js', CORRECT),
      brute: await program('brute.js', BRUTE),
      generator: await program('gen.js', GENERATOR),
      timeLimitMs: 2000,
      iterations: 15,
    });
    expect(result).toEqual({ kind: 'passed', iterations: 15 });
  });

  it('finds a counterexample for a buggy solution', async () => {
    const progress: number[] = [];
    const result = await stressTest({
      solution: await program('sol.js', BUGGY),
      brute: await program('brute.js', BRUTE),
      generator: await program('gen.js', GENERATOR),
      timeLimitMs: 2000,
      iterations: 100,
      onProgress: (done) => progress.push(done),
    });
    expect(result.kind).toBe('found');
    if (result.kind !== 'found') return;
    const [n] = result.input.trim().split(/\s+/).map(Number);
    expect(result.expected.trim()).toBe(String(n)); // the case the bug misses
    expect(result.received.trim()).toBe('1');
    expect(result.verdict).toBe('WA');
    expect(progress).toEqual(progress.map((_, i) => i + 1));
  });

  it('reports a broken brute force with the input that broke it', async () => {
    const result = await stressTest({
      solution: await program('sol.js', CORRECT),
      brute: await program('brute.js', 'process.exit(3)'),
      generator: await program('gen.js', GENERATOR),
      timeLimitMs: 2000,
      iterations: 5,
    });
    expect(result).toMatchObject({ kind: 'broken', program: 'brute' });
    if (result.kind === 'broken') expect(result.input).toMatch(/^\d+\n/);
  });

  it('reports a generator that prints nothing', async () => {
    const result = await stressTest({
      solution: await program('sol.js', CORRECT),
      brute: await program('brute.js', BRUTE),
      generator: await program('gen.js', ''),
      timeLimitMs: 2000,
      iterations: 5,
    });
    expect(result).toMatchObject({ kind: 'broken', program: 'generator', message: expect.stringMatching(/Printed nothing/) });
  });

  it('can be stopped', async () => {
    const controller = new AbortController();
    const pending = stressTest({
      solution: await program('sol.js', CORRECT),
      brute: await program('brute.js', BRUTE),
      generator: await program('gen.js', GENERATOR),
      timeLimitMs: 2000,
      iterations: 10_000,
      signal: controller.signal,
      onProgress: (done) => done === 3 && controller.abort(),
    });
    expect((await pending).kind).toBe('stopped');
  });
});

describe('transportFetch', () => {
  let server: http.Server | undefined;
  afterEach(() => server?.close());

  it('behaves like fetch for JSON requests, including headers and empty bodies', async () => {
    server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (req.url === '/empty') return void res.writeHead(204).end();
        res.writeHead(201, { 'Content-Type': 'application/json', 'X-Request-Id': 'r1' }).end(JSON.stringify({ got: JSON.parse(body), key: req.headers['x-api-key'] }));
      });
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const base = `http://localhost:${(server.address() as AddressInfo).port}`;
    const f = transportFetch();

    const res = await f(`${base}/v1`, { method: 'POST', headers: { 'x-api-key': 'k', 'content-type': 'application/json' }, body: '{"a":1}' });
    expect(res.status).toBe(201);
    expect(res.headers.get('x-request-id')).toBe('r1');
    expect(await res.json()).toEqual({ got: { a: 1 }, key: 'k' });
    expect((await f(`${base}/empty`, { method: 'POST', body: '' })).status).toBe(204);
  });
});
