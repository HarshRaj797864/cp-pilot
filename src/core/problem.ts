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
}

export class InvalidProblemError extends Error {}

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

  return {
    name: p.name.trim(),
    group: typeof p.group === 'string' ? p.group : '',
    url: typeof p.url === 'string' ? p.url : '',
    interactive: p.interactive === true,
    timeLimit: typeof p.timeLimit === 'number' ? p.timeLimit : 0,
    memoryLimit: typeof p.memoryLimit === 'number' ? p.memoryLimit : 0,
    tests,
  };
}
