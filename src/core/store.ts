import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Problem } from './problem';

/** Problem metadata and tests live next to the solution, in a hidden folder. */
export const STORE_DIR = '.cp-pilot';

const STORE_VERSION = 1;

interface StoredProblem extends Problem {
  version: number;
}

export function problemFilePath(solutionPath: string): string {
  const dir = path.dirname(solutionPath);
  const base = path.basename(solutionPath);
  return path.join(dir, STORE_DIR, `${base}.json`);
}

export async function saveProblem(solutionPath: string, problem: Problem): Promise<string> {
  const file = problemFilePath(solutionPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const stored: StoredProblem = { version: STORE_VERSION, ...problem };
  await fs.writeFile(file, JSON.stringify(stored, null, 2) + '\n', 'utf8');
  return file;
}

/** Returns the stored problem for a solution file, or undefined if none exists. */
export async function loadProblem(solutionPath: string): Promise<Problem | undefined> {
  let text: string;
  try {
    text = await fs.readFile(problemFilePath(solutionPath), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
  const { version: _version, ...problem } = JSON.parse(text) as StoredProblem;
  return problem;
}
