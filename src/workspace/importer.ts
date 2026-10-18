import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Problem } from '../core/problem';
import { solutionFileName } from '../core/naming';
import { saveProblem } from '../core/store';
import { getSettings } from './settings';

/**
 * Creates (or reuses) the solution file for an imported problem, stores its tests,
 * and opens the file. Existing solution code is never overwritten.
 */
export async function importProblem(problem: Problem): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    vscode.window.showWarningMessage(
      `CP Pilot received "${problem.name}" but no folder is open. Open a folder and send it again.`,
    );
    return;
  }

  const { defaultLanguage, templateFile } = getSettings();
  const solutionPath = path.join(folder.uri.fsPath, solutionFileName(problem.name, defaultLanguage));

  if (!(await exists(solutionPath))) {
    await fs.writeFile(solutionPath, await readTemplate(templateFile), 'utf8');
  }
  await saveProblem(solutionPath, problem);

  const doc = await vscode.workspace.openTextDocument(solutionPath);
  await vscode.window.showTextDocument(doc, { preview: false });
  vscode.window.setStatusBarMessage(
    `CP Pilot: imported "${problem.name}" (${problem.tests.length} tests)`,
    5000,
  );
}

async function readTemplate(templateFile: string): Promise<string> {
  if (!templateFile) return '';
  try {
    return await fs.readFile(templateFile, 'utf8');
  } catch {
    vscode.window.showWarningMessage(`CP Pilot: couldn't read template file ${templateFile}`);
    return '';
  }
}

async function exists(file: string): Promise<boolean> {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}
