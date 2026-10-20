import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { Language, solutionFileName } from './naming';
import { Problem, isSameProblem } from './problem';
import { loadProblem, saveProblem } from './store';

const MAX_COPIES = 50;

export interface Placement {
  path: string;
  /** False when an existing file for the same problem was reused. */
  created: boolean;
}

/**
 * Finds the solution file for a problem and stores its tests next to it. Reuses the file of a
 * previous import of the same problem (keeping the code), and never takes over a file that
 * belongs to a different problem with the same name: that gets "Name_2.cpp" and so on.
 */
export async function placeSolution(dir: string, problem: Problem, language: Language, template: string): Promise<Placement> {
  for (let copy = 1; copy <= MAX_COPIES; copy++) {
    const file = path.join(dir, solutionFileName(problem, language, copy));
    // 'wx' fails if the file exists, so parallel imports of a contest can't claim the same name.
    const created = await fs.writeFile(file, template, { encoding: 'utf8', flag: 'wx' }).then(
      () => true,
      (err: NodeJS.ErrnoException) => {
        if (err.code === 'EEXIST') return false;
        throw err;
      },
    );
    if (!created) {
      const stored = await loadProblem(file).catch(() => undefined);
      // A file without stored tests is the user's own; adopt it as before.
      if (stored && !isSameProblem(stored, problem)) continue;
    }
    await saveProblem(file, problem);
    return { path: file, created };
  }
  throw new Error(`Too many files named like ${solutionFileName(problem, language)}`);
}
