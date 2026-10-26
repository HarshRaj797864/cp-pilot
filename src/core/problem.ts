/** A single sample test: stdin to feed and the expected stdout. */
export interface TestCase {
  input: string;
  output: string;
}

/** Judge-independent problem description. Everything else in the extension works with this. */
export interface Problem {
  name: string;
  /** Contest or category, e.g. "Codeforces - Round 950 (Div. 3)" or "CSES - CSES Problem Set". */
  group: string;
  url: string;
  interactive: boolean;
  /** Milliseconds. */
  timeLimit: number;
  /** Megabytes. */
  memoryLimit: number;
  tests: TestCase[];
  /** File names for problems that use file I/O instead of stdin/stdout (e.g. "input.txt"). */
  io?: { inputFile?: string; outputFile?: string };
}

/** Competitive Companion sends a contest as one request per problem, tagged with a shared batch. */
export interface Batch {
  id: string;
  size: number;
}

export class InvalidProblemError extends Error {}

export function parseBatch(raw: unknown): Batch | undefined {
  const batch = (raw as { batch?: { id?: unknown; size?: unknown } } | null)?.batch;
  if (typeof batch?.id !== 'string' || typeof batch.size !== 'number') return undefined;
  return { id: batch.id, size: batch.size };
}

function ioFileName(spec: unknown): string | undefined {
  const s = spec as { type?: unknown; fileName?: unknown } | undefined;
  if (s?.type !== 'file' || typeof s.fileName !== 'string') return undefined;
  // A bare file name only: never let a payload point the runner at other paths.
  const name = s.fileName.trim().split(/[\\/]/).pop();
  return name && name !== '.' && name !== '..' ? name : undefined;
}

/**
 * Validates a Competitive Companion payload and converts it into a Problem.
 * Format: https://github.com/jmerle/competitive-companion#the-format
 */
export function parseCompanionPayload(raw: unknown): Problem {
  if (typeof raw !== 'object' || raw === null) {
    throw new InvalidProblemError('Payload is not a JSON object');
  }
  const p = raw as Record<string, unknown>;

  if (typeof p.name !== 'string' || p.name.trim() === '') {
    throw new InvalidProblemError('Payload is missing "name"');
  }
  if (!Array.isArray(p.tests)) {
    throw new InvalidProblemError('Payload is missing "tests"');
  }

  const tests = p.tests.map((t, i): TestCase => {
    const test = t as Record<string, unknown> | null;
    if (typeof test?.input !== 'string' || typeof test?.output !== 'string') {
      throw new InvalidProblemError(`Test ${i + 1} must have string "input" and "output"`);
    }
    return { input: test.input, output: test.output };
  });

  const inputFile = ioFileName(p.input);
  const outputFile = ioFileName(p.output);

  return {
    name: p.name.trim(),
    group: typeof p.group === 'string' ? p.group : '',
    url: typeof p.url === 'string' ? p.url : '',
    interactive: p.interactive === true,
    timeLimit: typeof p.timeLimit === 'number' ? p.timeLimit : 0,
    memoryLimit: typeof p.memoryLimit === 'number' ? p.memoryLimit : 0,
    tests,
    ...(inputFile || outputFile ? { io: { inputFile, outputFile } } : {}),
  };
}

/** Whether two problems are the same task: same URL ignoring query/hash/trailing slash, else same name and group. */
export function isSameProblem(a: Problem, b: Problem): boolean {
  const ua = normalizeUrl(a.url);
  const ub = normalizeUrl(b.url);
  if (ua && ub) return ua === ub;
  return a.name === b.name && a.group === b.group;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase();
  } catch {
    return '';
  }
}
